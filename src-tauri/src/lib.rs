use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::sync::atomic::{AtomicBool, Ordering};

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
        a, b, c, d, e, f & 0xFFFFFFFFFFFF
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
    #[serde(default)]
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
}

fn tasks_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Cannot find home directory");
    home.join(".claude").join("tasks")
}

fn is_uuid(name: &str) -> bool {
    // UUID format: 8-4-4-4-12 hex chars
    let parts: Vec<&str> = name.split('-').collect();
    if parts.len() != 5 {
        return false;
    }
    let expected_lens = [8, 4, 4, 4, 12];
    parts
        .iter()
        .zip(expected_lens.iter())
        .all(|(part, &len)| part.len() == len && part.chars().all(|c| c.is_ascii_hexdigit()))
}

fn read_task_from_file(path: &PathBuf) -> Option<Task> {
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
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
            // Filter UUID directories
            if is_uuid(&name) {
                continue;
            }

            let mut tasks = vec![];
            if let Ok(files) = fs::read_dir(&path) {
                for file in files.flatten() {
                    let file_path = file.path();
                    if file_path.extension().map_or(false, |e| e == "json") {
                        let file_name = file_path.file_stem().unwrap().to_string_lossy();
                        // Skip guard task (0.json)
                        if file_name == "0" {
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
            lists.push(TaskList {
                name,
                tasks,
                total,
                completed,
            });
        }
    }

    lists.sort_by(|a, b| a.name.cmp(&b.name));
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
                if file_name == "0" || file_name == "999" {
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
fn update_task_status(list_name: String, task_id: String, new_status: String) -> Result<(), String> {
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
fn create_task(list_name: String, subject: String) -> Result<Task, String> {
    let dir = tasks_dir().join(&list_name);
    if !dir.exists() {
        return Err("List not found".to_string());
    }

    // Find max ID
    let mut max_id: u64 = 0;
    if let Ok(files) = fs::read_dir(&dir) {
        for file in files.flatten() {
            let file_path = file.path();
            if file_path.extension().map_or(false, |e| e == "json") {
                if let Some(stem) = file_path.file_stem() {
                    if let Ok(id) = stem.to_string_lossy().parse::<u64>() {
                        if id > max_id {
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
    let file_path = tasks_dir().join(&list_name).join(format!("{}.json", task_id));
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn create_list(list_name: String) -> Result<(), String> {
    let dir = tasks_dir().join(&list_name);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Create guard task (0.json) - compatible with tasklist plugin
    // Status "completed" so it doesn't show as "next" in Ctrl+T
    let guard = serde_json::json!({
        "id": "0",
        "subject": "Do Not Complete This Task",
        "description": "Guard task to prevent auto-deletion. Do NOT mark as pending.",
        "status": "completed",
        "blocks": [],
        "blockedBy": []
    });

    let guard_path = dir.join("0.json");
    if !guard_path.exists() {
        let content = serde_json::to_string_pretty(&guard).map_err(|e| e.to_string())?;
        fs::write(&guard_path, content).map_err(|e| e.to_string())?;
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
            Ok(())
        }
        _ => {
            let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");
            let script = format!(
                r#"tell application "iTerm2"
    activate
    if (count of windows) = 0 then
        create window with default profile
        delay 0.5
    else
        tell current window to create tab with default profile
    end if
    tell current window
        tell current session
            write text "{}"
        end tell
    end tell
end tell"#,
                escaped
            );
            std::process::Command::new("osascript")
                .arg("-e")
                .arg(&script)
                .spawn()
                .map_err(|e| format!("Failed to spawn osascript: {}", e))?;
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
    serde_json::json!({"terminal": "iterm"})
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
fn spawn_list(list_name: String) -> Result<(), String> {
    let command = format!(
        "CLAUDE_CODE_TASK_LIST_ID={} claude 'ToolSearch로 TaskList를 조회해서 우선순위를 파악하고 먼저 작업할 태스크를 제안해줘. tasklist 스킬은 사용하지 마.'",
        list_name
    );
    spawn_in_terminal(&command)
}

#[tauri::command]
fn spawn_task(list_name: String, task_id: String) -> Result<(), String> {
    // Read task JSON
    let task_path = tasks_dir().join(&list_name).join(format!("{}.json", task_id));
    let mut task: serde_json::Value = if task_path.exists() {
        let content = fs::read_to_string(&task_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        return Err("Task file not found".to_string());
    };

    let status = task["status"].as_str().unwrap_or("pending");
    let existing_session_id = task
        .get("metadata")
        .and_then(|m| m.get("session_id"))
        .and_then(|s| s.as_str())
        .map(|s| s.to_string());

    if status == "in_progress" && existing_session_id.is_some() {
        // Resume existing session
        let session_id = existing_session_id.unwrap();
        let command = format!(
            "CLAUDE_CODE_TASK_LIST_ID={} claude --resume {}",
            list_name, session_id
        );
        spawn_in_terminal(&command)
    } else {
        // Start new session
        let session_id = uuid_v4();

        // Save session_id to task metadata
        if task.get("metadata").is_none() {
            task["metadata"] = serde_json::json!({});
        }
        task["metadata"]["session_id"] = serde_json::Value::String(session_id.clone());
        task["status"] = serde_json::Value::String("in_progress".to_string());
        let updated = serde_json::to_string_pretty(&task).map_err(|e| e.to_string())?;
        fs::write(&task_path, updated).map_err(|e| e.to_string())?;

        let subject = task["subject"].as_str().unwrap_or("");
        let description = task["description"].as_str().unwrap_or("");

        let mut prompt = format!("[태스크 #{} - {}]", task_id, subject);
        if !description.is_empty() {
            prompt.push_str(&format!("\\n설명: {}", description));
        }
        prompt.push_str("\\n\\n이 태스크를 바로 작업해줘. 별도 탐색 없이 위 정보만으로 시작해.");
        prompt.push_str(&format!("\\n작업 완료 후 TaskUpdate(taskId: \\\"{}\\\", status: \\\"completed\\\")로 완료 처리해줘.", task_id));

        let escaped = prompt.replace('\'', "'\\''");
        let command = format!(
            "CLAUDE_CODE_TASK_LIST_ID={} claude --session-id {} $'{}'",
            list_name, session_id, escaped
        );
        spawn_in_terminal(&command)
    }
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
        .invoke_handler(tauri::generate_handler![
            get_task_lists,
            get_tasks,
            update_task_status,
            create_task,
            delete_task,
            create_list,
            delete_list,
            spawn_list,
            spawn_task,
            get_config,
            set_terminal,
        ])
        .setup(|app| {
            // Setup system tray
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).item(&quit).build()?;

            // Track the last time the window was shown to prevent premature hiding
            let last_shown = std::sync::Arc::new(std::sync::Mutex::new(Instant::now() - Duration::from_secs(10)));
            let last_shown_clone = last_shown.clone();
            // Track whether we're in the process of toggling to avoid race conditions
            let toggling = std::sync::Arc::new(AtomicBool::new(false));
            let toggling_clone = toggling.clone();

            // Load tray-specific icon (checkbox design for menu bar)
            let tray_icon_bytes = include_bytes!("../icons/tray-icon.png");
            let icon = tauri::image::Image::from_bytes(tray_icon_bytes)
                .expect("failed to load tray icon");
            let _tray = TrayIconBuilder::new()
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
                                let _ = window.hide();
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
                                let win_width = window
                                    .outer_size()
                                    .map(|s| s.width as f64)
                                    .unwrap_or(380.0);

                                // Center window horizontally under tray icon
                                let x = tray_x + (tray_width / 2.0) - (win_width / 2.0);
                                // Place directly below tray icon
                                let y = tray_y + tray_height;

                                let _ = window.set_position(
                                    tauri::PhysicalPosition::new(x as i32, y as i32),
                                );
                                let _ = window.show();
                                let _ = window.set_focus();
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
                            if let Some(win) = app_ref.get_webview_window("main") {
                                let _ = win.hide();
                            }
                        });
                    }
                });
            }

            // Start file watcher
            start_file_watcher(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
