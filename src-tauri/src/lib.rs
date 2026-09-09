use std::fs::{create_dir_all, OpenOptions};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Manager, RunEvent, State};

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

/// A GUI app has no terminal, so the sidecar's stderr goes to a log file the user can open.
fn sidecar_log(app: &tauri::AppHandle) -> Stdio {
    let path = app
        .path()
        .app_log_dir()
        .map(|dir| dir.join("sidecar.log"))
        .unwrap_or_else(|_| PathBuf::from("/tmp/ccdesk-sidecar.log"));
    let _ = path.parent().map(create_dir_all);
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::inherit())
}

/// Locate node through the user's login shell. A GUI app launched from Finder carries
/// almost no PATH, so `node` on PATH alone finds nothing under fnm, nvm or Homebrew.
fn find_node() -> String {
    if let Ok(explicit) = std::env::var("CCDESK_NODE") {
        return explicit;
    }
    let from_shell = Command::new("/bin/zsh")
        .args(["-lc", "command -v node"])
        .output()
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    from_shell.unwrap_or_else(|| "node".to_string())
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

fn bundled_claude(app: &tauri::AppHandle) -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }
    let candidate = app.path().resource_dir().ok()?.join("sidecar/claude");
    candidate.exists().then_some(candidate)
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(Child, SidecarInfo), String> {
    let script = sidecar_script(app);
    let mut command = Command::new(find_node());
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Sidecar { child: Mutex::new(None), info: Mutex::new(None), failure: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![sidecar_info])
        .setup(|app| {
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
