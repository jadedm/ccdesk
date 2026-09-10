use std::fs::{create_dir_all, OpenOptions};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager, RunEvent, State};

#[derive(Clone, Serialize, Deserialize)]
pub struct SidecarInfo {
    pub port: u16,
    pub token: String,
}

struct Sidecar {
    child: Mutex<Option<Child>>,
    info: Mutex<Option<SidecarInfo>>,
    failure: Mutex<Option<String>>,
}

/// A GUI app has no terminal, so the sidecar's stderr and any spawn failure go to a log
/// file the user can open.
fn sidecar_log_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_log_dir()
        .map(|dir| dir.join("sidecar.log"))
        .unwrap_or_else(|_| PathBuf::from("/tmp/ccdesk-sidecar.log"))
}

fn sidecar_log_file(app: &tauri::AppHandle) -> Box<dyn std::io::Write> {
    let path = sidecar_log_path(app);
    let _ = path.parent().map(create_dir_all);
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(file) => Box::new(file),
        Err(_) => Box::new(std::io::stderr()),
    }
}

fn sidecar_log(app: &tauri::AppHandle) -> Stdio {
    let path = sidecar_log_path(app);
    let _ = path.parent().map(create_dir_all);
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::inherit())
}

/// What the user's login shell knows that a Finder launch does not: where node is, and the
/// full PATH. A GUI app starts with `/usr/bin:/bin:/usr/sbin:/sbin`, under which `node` is
/// missing and the Claude CLI reports "Not logged in" because it cannot reach the tools it
/// uses to read its credentials.
struct ShellEnv {
    node: String,
    path: Option<String>,
}

fn login_shell_env() -> ShellEnv {
    // Interactive as well as login (-lic): version managers such as fnm and nvm put node
    // on PATH from .zshrc, which a plain login shell never reads. stdin is /dev/null so an
    // interactive shell cannot wait on the terminal it does not have.
    let output = Command::new("/bin/zsh")
        .args(["-lic", "printf '\n%s\n%s\n' \"$(command -v node)\" \"$PATH\""])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .unwrap_or_default();
    // Take the last two lines: rc files may print before the printf runs.
    let lines: Vec<&str> = output.lines().map(str::trim).collect();
    let node = lines.get(lines.len().wrapping_sub(2)).filter(|s| !s.is_empty()).map(|s| s.to_string());
    let path = lines.last().filter(|s| !s.is_empty()).map(|s| s.to_string());
    ShellEnv {
        node: std::env::var("CCDESK_NODE").ok().or(node).unwrap_or_else(|| "node".to_string()),
        path,
    }
}

fn sidecar_script(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(explicit) = std::env::var("CCDESK_SIDECAR") {
        return PathBuf::from(explicit);
    }
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/dist/sidecar.cjs");
    }
    app.path()
        .resource_dir()
        .map(|dir| dir.join("sidecar/sidecar.cjs"))
        .unwrap_or_else(|_| PathBuf::from("sidecar.cjs"))
}

/// The CLI binary the SDK was built against. In a release build it is a bundled resource;
/// in dev it is the copy `scripts/prepare-resources.sh` puts under `src-tauri/resources`.
fn bundled_claude(app: &tauri::AppHandle) -> Option<PathBuf> {
    let candidate = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/claude")
    } else {
        app.path().resource_dir().ok()?.join("sidecar/claude")
    };
    candidate.exists().then_some(candidate)
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(Child, SidecarInfo), String> {
    let script = sidecar_script(app);
    let shell = login_shell_env();
    let mut command = Command::new(&shell.node);
    if let Some(path) = &shell.path {
        command.env("PATH", path);
    }
    command
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(sidecar_log(app));
    if let Some(claude) = bundled_claude(app) {
        command.env("CCDESK_CLAUDE_BIN", claude);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("cannot start sidecar {}: {e}", script.display()))?;
    let stdout = child.stdout.take().ok_or("sidecar has no stdout")?;
    let mut reader = BufReader::new(stdout);
    let mut first_line = String::new();
    reader
        .read_line(&mut first_line)
        .map_err(|e| format!("cannot read sidecar banner: {e}"))?;
    // Keep draining stdout for the life of the sidecar. Dropping the pipe would turn any
    // later write into EPIPE and end the sidecar.
    std::thread::spawn(move || {
        let mut sink = String::new();
        while let Ok(n) = reader.read_line(&mut sink) {
            if n == 0 {
                break;
            }
            sink.clear();
        }
    });
    let info: SidecarInfo = serde_json::from_str(first_line.trim()).map_err(|e| {
        let _ = child.kill();
        format!("sidecar exited before announcing a port ({e}); see the sidecar log")
    })?;
    Ok((child, info))
}

#[tauri::command]
fn sidecar_info(state: State<Sidecar>) -> Result<SidecarInfo, String> {
    let info = state.info.lock().map_err(|_| "sidecar state poisoned".to_string())?.clone();
    if let Some(info) = info {
        return Ok(info);
    }
    let failure = state.failure.lock().ok().and_then(|f| f.clone());
    Err(failure.unwrap_or_else(|| "sidecar not running".to_string()))
}

/// Closing stdin is the quit signal. The sidecar then closes its sessions, which is what
/// terminates the CLI child processes underneath it. Only if it has not exited within the
/// grace period is it killed.
fn stop_sidecar(state: &Sidecar) {
    let Ok(mut guard) = state.child.lock() else { return };
    let Some(mut child) = guard.take() else { return };
    drop(child.stdin.take());
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// The default macOS menu binds Cmd+W to Close Window, which would beat the webview and
/// close every live session. This menu carries Close Tab on Cmd+W instead; the webview
/// closes the active tab when it hears the event.
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let close_tab = MenuItem::with_id(app, "close-tab", "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let app_menu = Submenu::with_items(
        app,
        "ccdesk",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[&close_tab, &PredefinedMenuItem::minimize(app, None)?, &PredefinedMenuItem::fullscreen(app, None)?],
    )?;
    Menu::with_items(app, &[&app_menu, &edit, &window])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Sidecar { child: Mutex::new(None), info: Mutex::new(None), failure: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![sidecar_info])
        .on_menu_event(|app, event| {
            if event.id() == "close-tab" {
                let _ = app.emit("close-tab", ());
            }
        })
        .setup(|app| {
            app.set_menu(build_menu(app.handle())?)?;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // A sidecar failure must not abort the app. The window opens and the UI shows
            // the failure text from `sidecar_info`, which is what a user can act on.
            let state = app.state::<Sidecar>();
            match spawn_sidecar(app.handle()) {
                Ok((child, info)) => {
                    *state.child.lock().unwrap() = Some(child);
                    *state.info.lock().unwrap() = Some(info);
                }
                Err(message) => {
                    log::error!("{message}");
                    let _ = std::io::Write::write_all(&mut sidecar_log_file(app.handle()), format!("{message}\n").as_bytes());
                    *state.failure.lock().unwrap() = Some(message);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_sidecar(&app.state::<Sidecar>());
            }
        });
}
