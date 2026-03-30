use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// Global: last window position for Dock reopen
static LAST_WINDOW_POS: std::sync::LazyLock<std::sync::Mutex<(i32, i32)>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new((0, 0)));

// Global: tray icon ID for position lookups
static TRAY_ID: std::sync::LazyLock<std::sync::Mutex<Option<tauri::tray::TrayIconId>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(None));

fn calc_window_pos_from_tray(app: &tauri::AppHandle) -> Option<(i32, i32)> {
    let tray_id = TRAY_ID.lock().ok()?.clone()?;
    let tray = app.tray_by_id(&tray_id)?;
    let rect = tray.rect().ok()??;
    let (tx, ty) = match rect.position {
        tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
        tauri::Position::Logical(p) => (p.x, p.y),
    };
    let (tw, th) = match rect.size {
        tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
        tauri::Size::Logical(s) => (s.width, s.height),
    };
    let win_width = 380.0;
    let x = (tx + (tw / 2.0) - (win_width / 2.0)) as i32;
    let y = (ty + th + 4.0) as i32;
    Some((x, y))
}

fn uuid_v4() -> String {
    // Simple UUID v4 generation using system time + random-ish bits
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seed = now.as_nanos();
    let a = (seed & 0xFFFFFFFF) as u32;
    let b = ((seed >> 32) & 0xFFFF) as u16;
    let c = (((seed >> 48) & 0x0FFF) | 0x4000) as u16; // version 4
    let d = (((seed >> 60) & 0x3F) | 0x80) as u8; // variant
    let e = ((seed >> 66) & 0xFF) as u8;
    let f = (seed.wrapping_mul(6364136223846793005).wrapping_add(1)) as u64;
    format!(
        "{:08x}-{:04x}-{:04x}-{:02x}{:02x}-{:012x}",
        a,
        b,
        c,
        d,
        e,
        f & 0xFFFFFFFFFFFF
    )
}
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder},
    Emitter, Manager, WindowEvent,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: String,
    pub subject: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub blocks: Vec<String>,
    #[serde(default, rename = "blockedBy")]
    pub blocked_by: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

fn default_status() -> String {
    "pending".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TaskList {
    pub name: String,
    pub tasks: Vec<Task>,
    pub total: usize,
    pub completed: usize,
    #[serde(rename = "lastUpdated")]
    pub last_updated: u64,
    #[serde(rename = "projectDir")]
    pub project_dir: Option<String>,
}

fn tasks_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Cannot find home directory");
    home.join(".claude").join("tasks")
}

fn read_task_from_file(path: &PathBuf) -> Option<Task> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn workspace_dir(list_name: &str) -> PathBuf {
    let home = dirs::home_dir().expect("Cannot find home directory");
    home.join("claude-task-list").join(list_name)
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct ListMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    project_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    channel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tmux_session: Option<String>,
}

fn read_meta(list_name: &str) -> Option<ListMeta> {
    let meta_path = tasks_dir().join(list_name).join("_meta.json");
    let content = fs::read_to_string(&meta_path).ok()?;
    serde_json::from_str(&content).ok()
}

fn write_meta(list_name: &str, meta: &ListMeta) -> Result<(), String> {
    let meta_path = tasks_dir().join(list_name).join("_meta.json");
    let content = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(&meta_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_project_dir(list_name: &str) -> Option<String> {
    read_meta(list_name).and_then(|m| m.project_dir)
}

fn write_project_dir(list_name: &str, project_dir: &str) -> Result<(), String> {
    let mut meta = read_meta(list_name).unwrap_or_default();
    meta.project_dir = Some(project_dir.to_string());
    write_meta(list_name, &meta)
}

#[tauri::command]
fn get_task_lists() -> Vec<TaskList> {
    let dir = tasks_dir();
    if !dir.exists() {
        return vec![];
    }

    let mut lists = vec![];
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path.file_name().unwrap().to_string_lossy().to_string();

            let mut tasks = vec![];
            let mut max_mtime: u64 = 0;

            // Get directory mtime as fallback
            if let Ok(meta) = fs::metadata(&path) {
                if let Ok(modified) = meta.modified() {
                    if let Ok(dur) = modified.duration_since(UNIX_EPOCH) {
                        max_mtime = dur.as_secs();
                    }
                }
            }

            if let Ok(files) = fs::read_dir(&path) {
                for file in files.flatten() {
                    let file_path = file.path();
                    if file_path.extension().map_or(false, |e| e == "json") {
                        // Track most recent file mtime
                        if let Ok(meta) = fs::metadata(&file_path) {
                            if let Ok(modified) = meta.modified() {
                                if let Ok(dur) = modified.duration_since(UNIX_EPOCH) {
                                    max_mtime = max_mtime.max(dur.as_secs());
                                }
                            }
                        }

                        let file_name = file_path.file_stem().unwrap().to_string_lossy();
                        // Skip guard task and metadata
                        if file_name == "0" || file_name == "999" || file_name == "_meta" {
                            continue;
                        }
                        if let Some(task) = read_task_from_file(&file_path) {
                            tasks.push(task);
                        }
                    }
                }
            }

            let total = tasks.len();
            let completed = tasks.iter().filter(|t| t.status == "completed").count();
            let project_dir = read_project_dir(&name).or_else(|| {
                if is_uuid(&name) {
                    let dir = find_session_project_dir(&name)
                        .or_else(|| find_list_project_dir_from_tasks(&name));
                    if let Some(ref d) = dir {
                        let _ = write_project_dir(&name, d);
                    }
                    return dir;
                }
                None
            });
            lists.push(TaskList {
                name,
                tasks,
                total,
                completed,
                last_updated: max_mtime,
                project_dir,
            });
        }
    }

    // Sort by last_updated descending (most recent first)
    lists.sort_by(|a, b| b.last_updated.cmp(&a.last_updated));
    lists
}

#[tauri::command]
fn get_tasks(list_name: String) -> Vec<Task> {
    let dir = tasks_dir().join(&list_name);
    if !dir.exists() {
        return vec![];
    }

    let mut tasks = vec![];
    if let Ok(files) = fs::read_dir(&dir) {
        for file in files.flatten() {
            let file_path = file.path();
            if file_path.extension().map_or(false, |e| e == "json") {
                let file_name = file_path.file_stem().unwrap().to_string_lossy();
                if file_name == "0" || file_name == "999" || file_name == "_meta" {
                    continue;
                }
                if let Some(task) = read_task_from_file(&file_path) {
                    tasks.push(task);
                }
            }
        }
    }

    tasks
}

#[tauri::command]
fn update_task_status(
    list_name: String,
    task_id: String,
    new_status: String,
) -> Result<(), String> {
    let dir = tasks_dir().join(&list_name);
    let file_path = dir.join(format!("{}.json", task_id));

    if !file_path.exists() {
        return Err("Task file not found".to_string());
    }

    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let mut task: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    task["status"] = serde_json::Value::String(new_status);
    let updated = serde_json::to_string_pretty(&task).map_err(|e| e.to_string())?;
    fs::write(&file_path, updated).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn update_task_subject(
    list_name: String,
    task_id: String,
    new_subject: String,
) -> Result<(), String> {
    let dir = tasks_dir().join(&list_name);
    let file_path = dir.join(format!("{}.json", task_id));

    if !file_path.exists() {
        return Err("Task file not found".to_string());
    }

    let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let mut task: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    task["subject"] = serde_json::Value::String(new_subject);
    let updated = serde_json::to_string_pretty(&task).map_err(|e| e.to_string())?;
    fs::write(&file_path, updated).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn create_task(list_name: String, subject: String) -> Result<Task, String> {
    let dir = tasks_dir().join(&list_name);
    if !dir.exists() {
        return Err("List not found".to_string());
    }

    // Ensure guard task (999.json) exists
    let guard_path = dir.join("999.json");
    if !guard_path.exists() {
        let guard = serde_json::json!({
            "id": "999",
            "subject": "Do Not Complete This Task",
            "description": "This is a guard task to prevent the task list from being auto-deleted when all other tasks are completed. Do NOT mark this task as completed.",
            "status": "pending",
            "blocks": [],
            "blockedBy": []
        });
        let _ = fs::write(
            &guard_path,
            serde_json::to_string_pretty(&guard).unwrap_or_default(),
        );
    }

    // Find max ID (exclude 999 guard)
    let mut max_id: u64 = 0;
    if let Ok(files) = fs::read_dir(&dir) {
        for file in files.flatten() {
            let file_path = file.path();
            if file_path.extension().map_or(false, |e| e == "json") {
                if let Some(stem) = file_path.file_stem() {
                    if let Ok(id) = stem.to_string_lossy().parse::<u64>() {
                        if id != 999 && id > max_id {
                            max_id = id;
                        }
                    }
                }
            }
        }
    }

    let new_id = max_id + 1;
    let task = Task {
        id: new_id.to_string(),
        subject,
        description: String::new(),
        status: "pending".to_string(),
        blocks: vec![],
        blocked_by: vec![],
        metadata: None,
    };

    let file_path = dir.join(format!("{}.json", new_id));
    let content = serde_json::to_string_pretty(&task).map_err(|e| e.to_string())?;
    fs::write(&file_path, content).map_err(|e| e.to_string())?;

    Ok(task)
}

#[tauri::command]
fn delete_task(list_name: String, task_id: String) -> Result<(), String> {
    let file_path = tasks_dir()
        .join(&list_name)
        .join(format!("{}.json", task_id));
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn create_list(list_name: String) -> Result<(), String> {
    let dir = tasks_dir().join(&list_name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Create workspace directory + _meta.json for named lists
    if !is_uuid(&list_name) {
        let ws = workspace_dir(&list_name);
        fs::create_dir_all(&ws).map_err(|e| e.to_string())?;
        write_project_dir(&list_name, &ws.to_string_lossy())?;
    }

    Ok(())
}

#[tauri::command]
fn delete_list(list_name: String) -> Result<(), String> {
    let dir = tasks_dir().join(&list_name);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn rename_list(old_name: String, new_name: String) -> Result<(), String> {
    let sanitized = new_name.trim().replace(' ', "-");
    if sanitized.is_empty() {
        return Err("Name cannot be empty".to_string());
    }
    let old_dir = tasks_dir().join(&old_name);
    let new_dir = tasks_dir().join(&sanitized);
    if !old_dir.exists() {
        return Err("List not found".to_string());
    }
    if new_dir.exists() {
        return Err("A list with that name already exists".to_string());
    }

    // Capture existing meta before rename
    let mut meta = read_meta(&old_name).unwrap_or_default();

    // Fill project_dir if missing
    if meta.project_dir.is_none() {
        if is_uuid(&old_name) {
            meta.project_dir = find_session_project_dir(&old_name);
        }
    }

    // Auto-detect channel info for UUID → Named rename
    if is_uuid(&old_name) && meta.channel.is_none() {
        if let Some(channel) = find_session_channel(&old_name) {
            meta.channel = Some(channel);
            meta.tmux_session = find_tmux_session_for_uuid(&old_name);
        }
    }

    fs::rename(&old_dir, &new_dir).map_err(|e| e.to_string())?;

    // Ensure project_dir has a value
    if meta.project_dir.is_none() {
        let ws = workspace_dir(&sanitized);
        fs::create_dir_all(&ws).map_err(|e| e.to_string())?;
        meta.project_dir = Some(ws.to_string_lossy().to_string());
    }

    write_meta(&sanitized, &meta)?;

    Ok(())
}

fn config_path() -> PathBuf {
    let home = dirs::home_dir().expect("Cannot find home directory");
    home.join(".claude").join("task-list-config.json")
}

fn get_terminal_app() -> String {
    if let Ok(content) = fs::read_to_string(config_path()) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(terminal) = config.get("terminal").and_then(|v| v.as_str()) {
                return terminal.to_string();
            }
        }
    }
    "iterm".to_string()
}

fn send_ctrl_t(app_name: &str) {
    let app = app_name.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(2000));
        let _ = std::process::Command::new("osascript")
            .arg("-e")
            .arg(format!(
                r#"tell application "{}" to activate
delay 0.5
tell application "System Events" to keystroke "t" using control down"#,
                app
            ))
            .output();
    });
}

fn spawn_in_terminal(command: &str) -> Result<(), String> {
    let terminal = get_terminal_app();
    println!("[spawn] terminal={}, command={}", terminal, command);

    match terminal.as_str() {
        "warp" => {
            let home = dirs::home_dir().unwrap_or_default();
            let spawn_path = home.join(".spawn-claude.command");
            let script = format!("#!/bin/zsh\n{}\n", command);
            fs::write(&spawn_path, &script).map_err(|e| e.to_string())?;
            std::process::Command::new("chmod")
                .arg("+x")
                .arg(&spawn_path)
                .output()
                .map_err(|e| e.to_string())?;
            std::process::Command::new("open")
                .arg("-a")
                .arg("Warp")
                .arg(&spawn_path)
                .spawn()
                .map_err(|e| format!("Failed to open in Warp: {}", e))?;
            send_ctrl_t("Warp");
            Ok(())
        }
        "terminal" => {
            let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
            let script = format!(
                r#"tell application "Terminal"
    do script "{}"
    activate
end tell"#,
                escaped
            );
            std::process::Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .spawn()
                .map_err(|e| format!("Failed to spawn osascript: {}", e))?;
            send_ctrl_t("Terminal");
            Ok(())
        }
        _ => {
            let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
            let script = format!(
                r#"tell application id "com.googlecode.iterm2"
    activate
    create window with default profile
    tell current session of current window
        write text "{}"
    end tell
end tell"#,
                escaped
            );
            std::process::Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .spawn()
                .map_err(|e| format!("Failed to spawn osascript: {}", e))?;
            send_ctrl_t("iTerm");
            Ok(())
        }
    }
}

#[tauri::command]
fn get_config() -> serde_json::Value {
    if let Ok(content) = fs::read_to_string(config_path()) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
            return config;
        }
    }
    serde_json::json!({"terminal": "terminal"})
}

#[tauri::command]
fn set_terminal(terminal: String) -> Result<String, String> {
    let path = config_path();
    let mut config = if let Ok(content) = fs::read_to_string(&path) {
        serde_json::from_str::<serde_json::Value>(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    config["terminal"] = serde_json::Value::String(terminal);
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

#[tauri::command]
fn set_spawn_mode(mode: String) -> Result<String, String> {
    let path = config_path();
    let mut config = if let Ok(content) = fs::read_to_string(&path) {
        serde_json::from_str::<serde_json::Value>(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    config["spawnMode"] = serde_json::Value::String(mode);
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

fn get_spawn_mode_flag() -> String {
    if let Ok(content) = fs::read_to_string(config_path()) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) {
            if config.get("spawnMode").and_then(|v| v.as_str()) == Some("dangerously-skip-permissions") {
                return " --dangerously-skip-permissions".to_string();
            }
        }
    }
    String::new()
}

fn hide_all_windows(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    if let Some(w) = app.get_webview_window("tooltip") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) -> Result<(), String> {
    hide_all_windows(&app);
    Ok(())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct TooltipItem {
    subject: String,
    status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
enum TooltipPayload {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "list")]
    List {
        items: Vec<TooltipItem>,
        #[serde(rename = "moreCount")]
        more_count: usize,
    },
}

#[tauri::command]
fn show_tooltip(
    app: tauri::AppHandle,
    payload: TooltipPayload,
    item_y: f64,
    _item_height: f64,
) -> Result<(), String> {
    let tooltip_win = app
        .get_webview_window("tooltip")
        .ok_or("tooltip window not found")?;
    let main_win = app
        .get_webview_window("main")
        .ok_or("main window not found")?;

    // Don't show tooltip if main window is hidden
    if !main_win.is_visible().unwrap_or(false) {
        return Ok(());
    }

    let main_pos = main_win.outer_position().map_err(|e| e.to_string())?;
    let scale = main_win.scale_factor().unwrap_or(2.0);

    // Calculate tooltip size based on content type
    let tooltip_w: f64 = 300.0;
    let tooltip_h: f64 = match &payload {
        TooltipPayload::Text { text } => {
            let lines = (text.len() as f64 / 30.0).ceil().max(1.0);
            (lines * 20.0 + 24.0).min(240.0)
        }
        TooltipPayload::List { items, more_count } => {
            let item_count = items.len() as f64;
            let more_line = if *more_count > 0 { 24.0 } else { 0.0 };
            item_count * 28.0 + 20.0 + more_line
        }
    };

    // Position: left of main window, vertically aligned with hovered item
    let gap = 8.0;
    let main_x = main_pos.x as f64 / scale;
    let main_y = main_pos.y as f64 / scale;
    let tooltip_x = main_x - tooltip_w - gap;
    let tooltip_y = main_y + item_y;

    tooltip_win
        .set_size(tauri::LogicalSize::new(tooltip_w, tooltip_h))
        .map_err(|e| e.to_string())?;
    tooltip_win
        .set_position(tauri::LogicalPosition::new(tooltip_x, tooltip_y))
        .map_err(|e| e.to_string())?;

    app.emit_to("tooltip", "tooltip-update", &payload)
        .map_err(|e| e.to_string())?;

    tooltip_win.show().map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn hide_tooltip(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(tooltip_win) = app.get_webview_window("tooltip") {
        let _ = tooltip_win.hide();
    }
    Ok(())
}

#[tauri::command]
fn set_project_dir(list_name: String, project_dir: String) -> Result<(), String> {
    write_project_dir(&list_name, &project_dir)
}

#[tauri::command]
fn init_project_dir(list_name: String) -> Result<String, String> {
    let ws = workspace_dir(&list_name);
    fs::create_dir_all(&ws).map_err(|e| e.to_string())?;
    let dir_str = ws.to_string_lossy().to_string();
    write_project_dir(&list_name, &dir_str)?;
    Ok(dir_str)
}

#[tauri::command]
fn pick_directory(default_path: Option<String>) -> Option<String> {
    let mut builder = rfd::FileDialog::new();
    if let Some(ref p) = default_path {
        builder = builder.set_directory(p);
    }
    builder.pick_folder().map(|p: std::path::PathBuf| p.to_string_lossy().to_string())
}

fn is_uuid(name: &str) -> bool {
    let parts: Vec<&str> = name.split('-').collect();
    parts.len() == 5
        && [8, 4, 4, 4, 12]
            .iter()
            .zip(parts.iter())
            .all(|(&len, part)| part.len() == len && part.chars().all(|c| c.is_ascii_hexdigit()))
}

fn read_cwd_from_jsonl(path: &std::path::Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    for line in content.lines().take(10) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            if let Some(cwd) = val.get("cwd").and_then(|v| v.as_str()) {
                if !cwd.is_empty() {
                    return Some(cwd.to_string());
                }
            }
        }
    }
    None
}

/// Find project dir for a UUID list by scanning its tasks' session_ids
fn find_list_project_dir_from_tasks(list_name: &str) -> Option<String> {
    let dir = tasks_dir().join(list_name);
    if !dir.is_dir() {
        return None;
    }
    if let Ok(files) = fs::read_dir(&dir) {
        for file in files.flatten() {
            let path = file.path();
            if path.extension().map_or(false, |e| e == "json") {
                let stem = path.file_stem().unwrap_or_default().to_string_lossy();
                if stem == "0" || stem == "999" || stem == "_meta" {
                    continue;
                }
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(sid) = val.pointer("/metadata/session_id").and_then(|v| v.as_str()) {
                            if let Some(pdir) = find_session_project_dir(sid) {
                                return Some(pdir);
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

/// Find the project directory where a session was originally run
/// by reading the cwd field from the session JSONL file
fn find_session_project_dir(session_id: &str) -> Option<String> {
    let home = dirs::home_dir()?;
    let projects_dir = home.join(".claude").join("projects");
    if !projects_dir.exists() {
        return None;
    }
    for entry in fs::read_dir(&projects_dir).ok()?.flatten() {
        let project_path = entry.path();
        if !project_path.is_dir() {
            continue;
        }
        // Check for flat session file: <project>/<session_id>.jsonl
        let jsonl = project_path.join(format!("{}.jsonl", session_id));
        if jsonl.exists() {
            if let Some(cwd) = read_cwd_from_jsonl(&jsonl) {
                return Some(cwd);
            }
        }
        // Check for directory-type session: <project>/<session_id>/
        let dir = project_path.join(session_id);
        if dir.is_dir() {
            if let Ok(files) = fs::read_dir(&dir) {
                for file in files.flatten() {
                    if file.path().extension().map_or(false, |e| e == "jsonl") {
                        if let Some(cwd) = read_cwd_from_jsonl(&file.path()) {
                            return Some(cwd);
                        }
                    }
                }
            }
            // Fallback: derive directory from the project folder name (e.g. "-Users-alice-Foo" → "/Users/alice/Foo")
            if let Some(dir_name) = project_path.file_name().and_then(|n| n.to_str()) {
                if dir_name.starts_with('-') {
                    let derived = dir_name.replace('-', "/");
                    if std::path::Path::new(&derived).is_dir() {
                        return Some(derived);
                    }
                }
            }
        }
    }
    None
}

/// Check if a session JSONL contains channel-origin messages (e.g. telegram)
fn find_session_channel(session_id: &str) -> Option<String> {
    let home = dirs::home_dir()?;
    let projects_dir = home.join(".claude").join("projects");
    if !projects_dir.exists() {
        return None;
    }
    for entry in fs::read_dir(&projects_dir).ok()?.flatten() {
        let project_path = entry.path();
        if !project_path.is_dir() {
            continue;
        }
        let jsonl = project_path.join(format!("{}.jsonl", session_id));
        if jsonl.exists() {
            if let Ok(content) = fs::read_to_string(&jsonl) {
                for line in content.lines().take(30) {
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
                        if let Some(kind) = val.pointer("/origin/kind").and_then(|v| v.as_str()) {
                            if kind == "channel" {
                                // Extract channel type from server field (e.g. "plugin:telegram:telegram")
                                if let Some(server) = val.pointer("/origin/server").and_then(|v| v.as_str()) {
                                    if server.contains("telegram") {
                                        return Some("telegram".to_string());
                                    }
                                }
                                return Some("channel".to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

/// Find tmux session name for a given CLAUDE_SESSION UUID by scanning ~/.claude/*.sh
fn find_tmux_session_for_uuid(session_id: &str) -> Option<String> {
    let home = dirs::home_dir()?;
    let claude_dir = home.join(".claude");
    for entry in fs::read_dir(&claude_dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().map_or(false, |e| e == "sh") {
            if let Ok(content) = fs::read_to_string(&path) {
                if content.contains(&format!("CLAUDE_SESSION=\"{}\"", session_id)) {
                    // Extract SESSION="..." from the script
                    for line in content.lines() {
                        let trimmed = line.trim();
                        if trimmed.starts_with("SESSION=") && !trimmed.starts_with("CLAUDE_SESSION=") {
                            return trimmed
                                .trim_start_matches("SESSION=")
                                .trim_matches('"')
                                .to_string()
                                .into();
                        }
                    }
                }
            }
        }
    }
    None
}

/// Ensure a channel's tmux session is running, start it if not
fn ensure_channel_session(tmux_session: &str) -> Result<(), String> {
    let check = std::process::Command::new("tmux")
        .args(["has-session", "-t", tmux_session])
        .output()
        .map_err(|e| e.to_string())?;
    if !check.status.success() {
        // Session not running — start via ~/.claude/{name}.sh
        let home = dirs::home_dir().ok_or("Cannot find home directory")?;
        let script = home.join(".claude").join(format!("{}.sh", tmux_session));
        if script.exists() {
            std::process::Command::new("bash")
                .arg(&script)
                .arg("start")
                .output()
                .map_err(|e| format!("Failed to start {}: {}", tmux_session, e))?;
            // Wait for session to be ready
            std::thread::sleep(Duration::from_secs(5));
        } else {
            return Err(format!("Start script not found: {}", script.display()));
        }
    }
    Ok(())
}

/// Bring a tmux session to foreground in Terminal.app
fn foreground_tmux_session(tmux_session: &str) -> Result<(), String> {
    let script = format!(
        r#"tell application "Terminal"
    do script "tmux attach -t {}"
    activate
end tell"#,
        tmux_session
    );
    std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .spawn()
        .map_err(|e| format!("Failed to open terminal: {}", e))?;
    Ok(())
}

#[tauri::command]
fn spawn_list(list_name: String) -> Result<(), String> {
    // Check for channel list
    if let Some(meta) = read_meta(&list_name) {
        if meta.channel.is_some() {
            if let Some(ref tmux) = meta.tmux_session {
                ensure_channel_session(tmux)?;
                return foreground_tmux_session(tmux);
            }
        }
    }

    if is_uuid(&list_name) {
        // Unnamed session: use task list ID with project directory if available
        let project_dir = read_project_dir(&list_name)
            .or_else(|| find_session_project_dir(&list_name))
            .or_else(|| find_list_project_dir_from_tasks(&list_name));
        if let Some(ref dir) = project_dir {
            // Cache to _meta.json for future spawns
            let _ = write_project_dir(&list_name, dir);
        }
        let flag = get_spawn_mode_flag();
        let command = if let Some(dir) = project_dir {
            format!("cd \"{}\" && CLAUDE_CODE_TASK_LIST_ID={} claude{}", dir, list_name, flag)
        } else {
            format!("CLAUDE_CODE_TASK_LIST_ID={} claude{}", list_name, flag)
        };
        return spawn_in_terminal(&command);
    }

    // Named list: use _meta.json project_dir
    let flag = get_spawn_mode_flag();
    if let Some(project_dir) = read_project_dir(&list_name) {
        // Re-create directory if it was deleted
        let _ = fs::create_dir_all(&project_dir);
        let command = format!(
            "cd \"{}\" && CLAUDE_CODE_TASK_LIST_ID={} claude{}",
            project_dir, list_name, flag
        );
        spawn_in_terminal(&command)
    } else {
        // Fallback: no _meta.json (legacy list)
        let command = format!("CLAUDE_CODE_TASK_LIST_ID={} claude{}", list_name, flag);
        spawn_in_terminal(&command)
    }
}

#[tauri::command]
fn spawn_task(list_name: String, task_id: String) -> Result<(), String> {
    // Read task JSON
    let task_path = tasks_dir()
        .join(&list_name)
        .join(format!("{}.json", task_id));
    let mut task: serde_json::Value = if task_path.exists() {
        let content = fs::read_to_string(&task_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err("Task file not found".to_string());
    };

    // Check for channel list — inject prompt into running tmux session
    if let Some(meta) = read_meta(&list_name) {
        if meta.channel.is_some() {
            if let Some(ref tmux) = meta.tmux_session {
                ensure_channel_session(tmux)?;
                foreground_tmux_session(tmux)?;

                // Build prompt and inject via tmux send-keys
                let subject = task["subject"].as_str().unwrap_or("");
                let description = task["description"].as_str().unwrap_or("");

                let mut prompt = format!("[Task #{} - {}]", task_id, subject);
                if !description.is_empty() {
                    prompt.push_str(&format!("\nDescription: {}", description));
                }
                prompt.push_str("\n\nStart working on this task immediately. Use only the information above.");
                prompt.push_str(&format!("\nWhen done, mark it complete with TaskUpdate(taskId: \"{}\", status: \"completed\").", task_id));

                // Small delay to let terminal window appear first
                std::thread::sleep(Duration::from_millis(500));

                std::process::Command::new("tmux")
                    .args(["send-keys", "-t", tmux, &prompt, "Enter"])
                    .output()
                    .map_err(|e| format!("Failed to send keys: {}", e))?;

                return Ok(());
            }
        }
    }

    let status = task["status"].as_str().unwrap_or("pending");
    let existing_session_id = task
        .get("metadata")
        .and_then(|m| m.get("session_id"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    // Resolve project directory for cd prefix (both named and UUID lists)
    let cd_prefix = {
        let project_dir = read_project_dir(&list_name).or_else(|| {
            if is_uuid(&list_name) {
                find_session_project_dir(&list_name)
                    .or_else(|| find_list_project_dir_from_tasks(&list_name))
            } else {
                None
            }
        });
        if let Some(ref dir) = project_dir {
            let _ = fs::create_dir_all(dir);
            // Cache to _meta.json for future spawns
            if is_uuid(&list_name) {
                let _ = write_project_dir(&list_name, dir);
            }
            format!("cd \"{}\" && ", dir)
        } else {
            String::new()
        }
    };

    // Build prompt for task context
    let subject = task["subject"].as_str().unwrap_or("");
    let description = task["description"].as_str().unwrap_or("");

    let mut prompt = format!("[Task #{}: {}]", task_id, subject);
    if !description.is_empty() {
        prompt.push_str(&format!("\\nDescription: {}", description));
    }
    prompt.push_str(&format!(
        "\\n\\nRead task #{} via TaskGet for full details, then start working on it immediately. When done, mark complete via TaskUpdate.",
        task_id
    ));
    let escaped_prompt = prompt.replace('\'', "'\\''");

    let flag = get_spawn_mode_flag();

    // Check if session file actually exists before attempting resume
    if status == "in_progress" && existing_session_id.is_some() {
        // Resume existing session
        let session_id = existing_session_id.unwrap();
        let resume_cd = find_session_project_dir(&session_id)
            .map(|dir| format!("cd \"{}\" && ", dir))
            .unwrap_or_else(|| cd_prefix.clone());
        let command = format!(
            "{}CLAUDE_CODE_TASK_LIST_ID={} claude{} --resume {} $'{}'",
            resume_cd, list_name, flag, session_id, escaped_prompt
        );
        spawn_in_terminal(&command)
    } else {
        // Start new session
        let session_id = uuid_v4();

        // Save session_id to task metadata
        if task.get("metadata").is_none() || task["metadata"].is_null() {
            task["metadata"] = serde_json::json!({});
        }
        task["metadata"]["session_id"] = serde_json::Value::String(session_id.clone());
        task["status"] = serde_json::Value::String("in_progress".to_string());
        let updated = serde_json::to_string_pretty(&task).map_err(|e| e.to_string())?;
        fs::write(&task_path, updated).map_err(|e| e.to_string())?;

        let command = format!(
            "{}CLAUDE_CODE_TASK_LIST_ID={} claude{} --session-id {} $'{}'",
            cd_prefix, list_name, flag, session_id, escaped_prompt
        );
        spawn_in_terminal(&command)
    }
}

/// Deploy bundled tasklist plugin to ~/.claude/plugins/ on first run.
/// Copies plugin files to cache, registers in installed_plugins.json,
/// and enables in settings.json.
fn deploy_bundled_plugin(resource_dir: &Path) {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    let claude_dir = home.join(".claude");
    let cache_dir = claude_dir.join("plugins/cache/claude-task-list-app/tasklist/1.1.0");
    let plugin_source = resource_dir.join("resources/plugins/tasklist");

    // Skip if source doesn't exist (dev mode without bundled resources)
    if !plugin_source.exists() {
        println!("[plugin-deploy] No bundled plugin found at {:?}, skipping", plugin_source);
        return;
    }

    // Skip if already deployed at this version
    let marker = cache_dir.join(".claude-plugin/plugin.json");
    if marker.exists() {
        // Check version matches
        if let Ok(content) = fs::read_to_string(&marker) {
            if content.contains("\"version\": \"1.1.0\"") {
                println!("[plugin-deploy] Plugin already deployed at 1.1.0, skipping");
                return;
            }
        }
    }

    println!("[plugin-deploy] Deploying bundled tasklist plugin...");

    // Copy plugin files recursively
    if let Err(e) = copy_dir_recursive(&plugin_source, &cache_dir) {
        eprintln!("[plugin-deploy] Failed to copy plugin files: {}", e);
        return;
    }

    // Register in installed_plugins.json
    let registry_path = claude_dir.join("plugins/installed_plugins.json");
    if let Ok(content) = fs::read_to_string(&registry_path) {
        if let Ok(mut registry) = serde_json::from_str::<serde_json::Value>(&content) {
            let key = "tasklist@claude-task-list-app";
            if let Some(plugins) = registry.get_mut("plugins").and_then(|p| p.as_object_mut()) {
                if !plugins.contains_key(key) {
                    let now = chrono_now_iso();
                    let entry = serde_json::json!([{
                        "scope": "user",
                        "installPath": cache_dir.to_string_lossy(),
                        "version": "1.1.0",
                        "installedAt": now,
                        "lastUpdated": now
                    }]);
                    plugins.insert(key.to_string(), entry);
                    if let Ok(json) = serde_json::to_string_pretty(&registry) {
                        let _ = fs::write(&registry_path, json);
                        println!("[plugin-deploy] Registered in installed_plugins.json");
                    }
                }
            }
        }
    }

    // Enable in settings.json
    let settings_path = claude_dir.join("settings.json");
    if let Ok(content) = fs::read_to_string(&settings_path) {
        if let Ok(mut settings) = serde_json::from_str::<serde_json::Value>(&content) {
            let key = "tasklist@claude-task-list-app";
            if let Some(enabled) = settings.get_mut("enabledPlugins").and_then(|p| p.as_object_mut()) {
                if !enabled.contains_key(key) {
                    enabled.insert(key.to_string(), serde_json::json!(true));
                    if let Ok(json) = serde_json::to_string_pretty(&settings) {
                        let _ = fs::write(&settings_path, json);
                        println!("[plugin-deploy] Enabled in settings.json");
                    }
                }
            }
        }
    }

    println!("[plugin-deploy] Bundled tasklist plugin deployed successfully");
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

fn chrono_now_iso() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    // Simple ISO 8601 without chrono crate
    let days_since_epoch = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // Calculate year/month/day from days since epoch (1970-01-01)
    let mut y = 1970i64;
    let mut remaining = days_since_epoch as i64;
    loop {
        let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
        if remaining < days_in_year { break; }
        remaining -= days_in_year;
        y += 1;
    }
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let month_days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    for (i, &d) in month_days.iter().enumerate() {
        if remaining < d as i64 { m = i; break; }
        remaining -= d as i64;
    }

    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", y, m + 1, remaining + 1, hours, minutes, seconds)
}

fn start_file_watcher(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let dir = tasks_dir();
        if !dir.exists() {
            let _ = fs::create_dir_all(&dir);
        }

        let (tx, rx) = mpsc::channel::<Event>();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    let _ = tx.send(event);
                }
            },
            notify::Config::default(),
        )
        .expect("Failed to create file watcher");

        watcher
            .watch(&dir, RecursiveMode::Recursive)
            .expect("Failed to watch tasks directory");

        println!("[file-watcher] Watching: {:?}", dir);

        let debounce_duration = Duration::from_millis(300);
        let mut last_event_time = Instant::now() - debounce_duration;

        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(event) => {
                    let now = Instant::now();
                    // Log the event
                    println!("[file-watcher] Event: {:?}", event.kind);
                    for path in &event.paths {
                        println!("[file-watcher] Path: {:?}", path);
                    }

                    // Debounce: only emit if enough time has passed
                    if now.duration_since(last_event_time) >= debounce_duration {
                        last_event_time = now;
                        // Drain any remaining events within debounce window
                        std::thread::sleep(debounce_duration);
                        while rx.try_recv().is_ok() {}

                        // Emit event to frontend
                        let _ = app_handle.emit("tasks-changed", ());
                        println!("[file-watcher] Emitted tasks-changed event");
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            get_task_lists,
            get_tasks,
            update_task_status,
            update_task_subject,
            create_task,
            delete_task,
            create_list,
            delete_list,
            rename_list,
            spawn_list,
            spawn_task,
            get_config,
            set_terminal,
            set_project_dir,
            init_project_dir,
            pick_directory,
            hide_window,
            show_tooltip,
            hide_tooltip,
            set_spawn_mode,
        ])
        .setup(|app| {
            // Enable autostart on first launch
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::ManagerExt;
                let autostart = app.autolaunch();
                if !autostart.is_enabled().unwrap_or(false) {
                    let _ = autostart.enable();
                }
            }

            // Register global shortcut Command+Y to toggle window
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, Modifiers, ShortcutState};

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcuts(["super+y"])?
                        .with_handler(|app, shortcut, event| {
                            if event.state == ShortcutState::Pressed
                                && shortcut.matches(Modifiers::SUPER, Code::KeyY)
                            {
                                if let Some(window) = app.get_webview_window("main") {
                                    if window.is_visible().unwrap_or(false) {
                                        hide_all_windows(app);
                                    } else {
                                        let pos = LAST_WINDOW_POS.lock().ok()
                                            .and_then(|p| if p.0 != 0 || p.1 != 0 { Some((p.0, p.1)) } else { None })
                                            .or_else(|| calc_window_pos_from_tray(app));
                                        if let Some((x, y)) = pos {
                                            let _ = window.set_position(
                                                tauri::PhysicalPosition::new(x, y),
                                            );
                                            if let Ok(mut p) = LAST_WINDOW_POS.lock() {
                                                *p = (x, y);
                                            }
                                        }
                                        let _ = window.show();
                                        let _ = window.set_focus();
                                    }
                                }
                            }
                        })
                        .build(),
                )?;
            }

            // Note: macOS Tahoe dark icon style darkens the Dock icon.
            // Icon has white checkmark on orange bg so it's still visible in dark mode.

            // Setup system tray
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).item(&quit).build()?;

            // Track the last time the window was shown to prevent premature hiding
            let last_shown = std::sync::Arc::new(std::sync::Mutex::new(
                Instant::now() - Duration::from_secs(10),
            ));
            let last_shown_clone = last_shown.clone();
            // Track whether we're in the process of toggling to avoid race conditions
            let toggling = std::sync::Arc::new(AtomicBool::new(false));
            let toggling_clone = toggling.clone();
            // (window position tracked via LAST_WINDOW_POS global)

            // Load tray-specific icon (checkbox design for menu bar)
            let tray_icon_bytes = include_bytes!("../icons/tray-icon.png");
            let icon =
                tauri::image::Image::from_bytes(tray_icon_bytes).expect("failed to load tray icon");
            let tray = TrayIconBuilder::new()
                .icon(icon)
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false) // Left-click should NOT show menu
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(move |tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        rect,
                        ..
                    } = event
                    {
                        // Prevent race condition with rapid clicks
                        if toggling_clone.swap(true, Ordering::SeqCst) {
                            return;
                        }

                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                hide_all_windows(app);
                            } else {
                                // Extract tray icon position and size
                                let (tray_x, tray_y) = match rect.position {
                                    tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
                                    tauri::Position::Logical(p) => (p.x, p.y),
                                };
                                let (tray_width, tray_height) = match rect.size {
                                    tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
                                    tauri::Size::Logical(s) => (s.width, s.height),
                                };

                                // Get window size
                                let win_width =
                                    window.outer_size().map(|s| s.width as f64).unwrap_or(380.0);

                                // Center window horizontally under tray icon
                                let x = tray_x + (tray_width / 2.0) - (win_width / 2.0);
                                // Place below tray icon with small gap
                                let y = tray_y + tray_height + 4.0;

                                let pos_x = x as i32;
                                let pos_y = y as i32;
                                let _ =
                                    window.set_position(tauri::PhysicalPosition::new(pos_x, pos_y));
                                let _ = window.show();
                                let _ = window.set_focus();
                                // Save position for Dock reopen
                                if let Ok(mut pos) = LAST_WINDOW_POS.lock() {
                                    *pos = (pos_x, pos_y);
                                }
                                // Record when window was shown
                                if let Ok(mut t) = last_shown_clone.lock() {
                                    *t = Instant::now();
                                }
                            }
                        }

                        // Release toggle lock after a short delay
                        let toggling_inner = toggling_clone.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(300));
                            toggling_inner.store(false, Ordering::SeqCst);
                        });
                    }
                    // Right-click is handled automatically by the menu
                })
                .build(app)?;

            // Save tray ID for later position lookups
            if let Ok(mut id) = TRAY_ID.lock() {
                *id = Some(tray.id().clone());
            }

            // Show window on first launch after a short delay (tray needs time to settle)
            let app_handle_for_init = app.handle().clone();
            let last_shown_for_init = last_shown.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(500));
                if let Some(pos) = calc_window_pos_from_tray(&app_handle_for_init) {
                    if let Ok(mut p) = LAST_WINDOW_POS.lock() {
                        *p = pos;
                    }
                    if let Some(window) = app_handle_for_init.get_webview_window("main") {
                        let _ = window.set_position(tauri::PhysicalPosition::new(pos.0, pos.1));
                        let _ = window.show();
                        let _ = window.set_focus();
                        if let Ok(mut t) = last_shown_for_init.lock() {
                            *t = Instant::now();
                        }
                    }
                }
            });

            // Listen for window focus lost → auto-hide
            let app_handle_for_focus = app.handle().clone();
            let toggling_for_focus = toggling.clone();
            let last_shown_for_focus = last_shown.clone();
            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let WindowEvent::Focused(false) = event {
                        // Window lost focus, hide it (like a popover)
                        // But don't hide if window was just shown (grace period)
                        let app_ref = app_handle_for_focus.clone();
                        let toggling_ref = toggling_for_focus.clone();
                        let last_shown_ref = last_shown_for_focus.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_millis(150));
                            // Don't hide during tray toggle
                            if toggling_ref.load(Ordering::SeqCst) {
                                return;
                            }
                            // Don't hide if window was shown less than 500ms ago
                            if let Ok(t) = last_shown_ref.lock() {
                                if t.elapsed() < Duration::from_millis(500) {
                                    return;
                                }
                            }
                            hide_all_windows(&app_ref);
                        });
                    }
                });
            }

            // Deploy bundled plugin on first run
            if let Ok(resource_dir) = app.path().resource_dir() {
                deploy_bundled_plugin(&resource_dir);
            }

            // Start file watcher
            start_file_watcher(app.handle().clone());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Handle Dock icon click (reopen)
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    // Use saved tray position
                    if let Ok(pos) = LAST_WINDOW_POS.lock() {
                        if pos.0 != 0 || pos.1 != 0 {
                            let _ = window.set_position(tauri::PhysicalPosition::new(pos.0, pos.1));
                        }
                    }
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
