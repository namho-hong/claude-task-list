import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface Task {
  id: string;
  subject: string;
  description: string;
  status: "pending" | "in_progress" | "completed";
  blocks: string[];
  blockedBy: string[];
  metadata?: Record<string, unknown>;
}

interface TaskList {
  name: string;
  tasks: Task[];
  total: number;
  completed: number;
}

type Screen = { type: "lists" } | { type: "detail"; listName: string };

const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

const NEXT_STATUS: Record<string, string> = {
  pending: "in_progress",
  in_progress: "completed",
  completed: "pending",
};

const TERMINAL_OPTIONS = [
  { value: "iterm", label: "iTerm2" },
  { value: "terminal", label: "Terminal.app" },
  { value: "warp", label: "Warp" },
];

function App() {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [screen, setScreen] = useState<Screen>({ type: "lists" });
  const [newListName, setNewListName] = useState("");
  const [showNewListInput, setShowNewListInput] = useState(false);
  const [newTaskSubject, setNewTaskSubject] = useState("");
  const [terminal, setTerminal] = useState("iterm");
  const [showSettings, setShowSettings] = useState(false);
  const [tooltip, setTooltip] = useState<{
    id: string;
    text: string;
    x: number;
    y: number;
  } | null>(null);

  const loadLists = useCallback(async () => {
    try {
      const result = await invoke<TaskList[]>("get_task_lists");
      setLists(result);
    } catch (err) {
      console.error("[frontend] Failed to load lists:", err);
    }
  }, []);

  useEffect(() => {
    loadLists();
    invoke<{ terminal?: string }>("get_config")
      .then((config) => {
        if (config.terminal) setTerminal(config.terminal);
      })
      .catch(() => {});
    const unlisten = listen("tasks-changed", () => {
      loadLists();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [loadLists]);

  const handleSetTerminal = async (value: string) => {
    setTerminal(value);
    try {
      await invoke("set_terminal", { terminal: value });
    } catch (err) {
      console.error("Failed to set terminal:", err);
    }
  };

  const handleCreateList = async () => {
    const name = newListName.trim();
    if (!name) return;
    try {
      await invoke("create_list", { listName: name });
      setNewListName("");
      setShowNewListInput(false);
      await loadLists();
    } catch (err) {
      console.error("Failed to create list:", err);
    }
  };

  const handleToggleStatus = async (listName: string, task: Task) => {
    const newStatus = NEXT_STATUS[task.status] || "pending";
    try {
      await invoke("update_task_status", {
        listName,
        taskId: task.id,
        newStatus,
      });
      await loadLists();
    } catch (err) {
      console.error("Failed to toggle status:", err);
    }
  };

  const handleAddTask = async (listName: string) => {
    const subject = newTaskSubject.trim();
    if (!subject) return;
    try {
      await invoke("create_task", { listName, subject });
      setNewTaskSubject("");
      await loadLists();
    } catch (err) {
      console.error("Failed to create task:", err);
    }
  };

  const handleDeleteTask = async (
    e: React.MouseEvent,
    listName: string,
    taskId: string
  ) => {
    e.preventDefault();
    try {
      await invoke("delete_task", { listName, taskId });
      await loadLists();
    } catch (err) {
      console.error("Failed to delete task:", err);
    }
  };

  const handleSpawnAll = async (listName: string) => {
    try {
      await invoke("spawn_list", { listName });
    } catch (err) {
      console.error("Failed to spawn list:", err);
    }
  };

  const handleSpawnTask = async (listName: string, taskSubject: string) => {
    try {
      await invoke("spawn_task", { listName, taskSubject });
    } catch (err) {
      console.error("Failed to spawn task:", err);
    }
  };

  const showTooltip = (task: Task, e: React.MouseEvent) => {
    if (!task.description) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTooltip({
      id: task.id,
      text: task.description,
      x: rect.left,
      y: rect.top - 4,
    });
  };

  const hideTooltip = () => setTooltip(null);

  const progressPercent = (list: TaskList) => {
    if (list.total === 0) return 0;
    return Math.round((list.completed / list.total) * 100);
  };

  // Screen 1: List selection
  if (screen.type === "lists") {
    return (
      <div className="app-container" data-testid="app-root">
        <div className="header">
          <span className="header-icon">✓</span>
          <span className="header-title">Claude Task List</span>
          <button
            className="btn-settings"
            onClick={() => setShowSettings(!showSettings)}
          >
            ⚙
          </button>
        </div>
        {showSettings && (
          <>
            <div className="settings-row">
              <span className="settings-label">Terminal</span>
              <select
                className="settings-select"
                value={terminal}
                onChange={(e) => handleSetTerminal(e.target.value)}
              >
                {TERMINAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
        <div className="divider" />
        <div className="content">
          {lists.map((list) => (
            <div
              key={list.name}
              className="list-card"
              data-testid={`list-card-${list.name}`}
              onClick={() => setScreen({ type: "detail", listName: list.name })}
            >
              <div className="list-card-header">
                <span className="list-name">{list.name}</span>
                <span className="list-count">
                  {list.completed} / {list.total}
                </span>
              </div>
              <div
                className="progress-bar-bg"
                data-testid={`list-progress-${list.name}`}
              >
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progressPercent(list)}%` }}
                />
              </div>
              <div className="progress-label">{progressPercent(list)}%</div>
            </div>
          ))}

          {showNewListInput ? (
            <div className="list-card new-list-input-card">
              <input
                data-testid="input-new-list-name"
                className="text-input"
                type="text"
                placeholder="List name..."
                value={newListName}
                onChange={(e) => setNewListName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateList();
                  if (e.key === "Escape") {
                    setShowNewListInput(false);
                    setNewListName("");
                  }
                }}
                autoFocus
              />
              <button className="btn-create" onClick={handleCreateList}>
                Create
              </button>
            </div>
          ) : (
            <div
              className="list-card new-list-card"
              data-testid="btn-new-list"
              onClick={() => setShowNewListInput(true)}
            >
              <span className="new-list-text">+ New List</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Screen 2: Task detail
  const currentList = lists.find((l) => l.name === screen.listName);
  const sortedTasks = [...(currentList?.tasks || [])].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1)
  );

  // Group tasks by status for section headers
  const groups: { label: string; status: string; tasks: Task[] }[] = [];
  const inProgress = sortedTasks.filter((t) => t.status === "in_progress");
  const pending = sortedTasks.filter((t) => t.status === "pending");
  const completed = sortedTasks.filter((t) => t.status === "completed");
  if (inProgress.length > 0)
    groups.push({ label: "In Progress", status: "in_progress", tasks: inProgress });
  if (pending.length > 0)
    groups.push({ label: "Pending", status: "pending", tasks: pending });
  if (completed.length > 0)
    groups.push({ label: "Completed", status: "completed", tasks: completed });

  return (
    <div className="app-container" data-testid="app-root">
      <div className="header">
        <button
          className="btn-back"
          data-testid="btn-back"
          onClick={() => setScreen({ type: "lists" })}
        >
          ←
        </button>
        <span className="header-title">{screen.listName}</span>
        <button
          className="btn-spawn"
          data-testid="btn-spawn-all"
          onClick={() => handleSpawnAll(screen.listName)}
        >
          ⚡ Spawn
        </button>
      </div>
      <div className="divider" />
      <div className="content">
        {sortedTasks.length === 0 && (
          <div className="empty-state" data-testid="empty-state">
            No tasks yet
          </div>
        )}

        {groups.map((group) => (
          <div key={group.status}>
            <div className="section-header">{group.label}</div>
            {group.tasks.map((task) => (
              <div
                key={task.id}
                className={`task-item ${task.status === "completed" ? "task-completed" : ""}`}
                data-testid={`task-item-${task.id}`}
                onContextMenu={(e) =>
                  handleDeleteTask(e, screen.listName, task.id)
                }
              >
                <span
                  className={`task-status ${task.status === "in_progress" ? "status-active" : ""}`}
                  data-testid={`task-status-${task.id}`}
                >
                  {task.status === "completed"
                    ? "✓"
                    : task.status === "in_progress"
                      ? "◉"
                      : "○"}
                </span>
                <span
                  className="task-text"
                  data-testid={`task-text-${task.id}`}
                  onClick={() => handleToggleStatus(screen.listName, task)}
                  onMouseEnter={(e) => showTooltip(task, e)}
                  onMouseLeave={hideTooltip}
                >
                  {task.subject}
                </span>
                {task.status !== "completed" && (
                  <button
                    className="btn-spawn-task"
                    data-testid={`btn-spawn-${task.id}`}
                    onClick={() =>
                      handleSpawnTask(screen.listName, task.subject)
                    }
                  >
                    ▶
                  </button>
                )}
              </div>
            ))}
          </div>
        ))}

        {/* Add Task */}
        <div className="add-task-row">
          <input
            data-testid="input-new-task"
            className="text-input"
            type="text"
            placeholder="New task subject..."
            value={newTaskSubject}
            onChange={(e) => setNewTaskSubject(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddTask(screen.listName);
            }}
          />
          <button
            className="btn-add-task"
            data-testid="btn-add-task"
            onClick={() => handleAddTask(screen.listName)}
          >
            Add
          </button>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="tooltip"
          data-testid={`task-tooltip-${tooltip.id}`}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

export default App;
