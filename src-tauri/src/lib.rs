use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

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
        .stderr(Stdio::inherit());
    if let Some(claude) = bundled_claude(app) {
        command.env("CCDESK_CLAUDE_BIN", claude);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("cannot start sidecar {}: {e}", script.display()))?;
    let stdout = child.stdout.take().ok_or("sidecar has no stdout")?;
    let mut first_line = String::new();
    BufReader::new(stdout)
        .read_line(&mut first_line)
        .map_err(|e| format!("cannot read sidecar banner: {e}"))?;
    let info: SidecarInfo = serde_json::from_str(first_line.trim())
        .map_err(|e| format!("bad sidecar banner {first_line:?}: {e}"))?;
    Ok((child, info))
}

#[tauri::command]
fn sidecar_info(state: State<Sidecar>) -> Result<SidecarInfo, String> {
    state
        .info
        .lock()
        .map_err(|_| "sidecar state poisoned".to_string())?
        .clone()
        .ok_or_else(|| "sidecar not running".to_string())
}

fn stop_sidecar(state: &Sidecar) {
    let Ok(mut guard) = state.child.lock() else { return };
    let Some(mut child) = guard.take() else { return };
    // Dropping stdin closes the pipe; the sidecar exits on stdin end. Kill as a backstop.
    drop(child.stdin.take());
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Sidecar { child: Mutex::new(None), info: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![sidecar_info])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let (child, info) = spawn_sidecar(app.handle()).map_err(std::io::Error::other)?;
            let state = app.state::<Sidecar>();
            *state.child.lock().unwrap() = Some(child);
            *state.info.lock().unwrap() = Some(info);
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
