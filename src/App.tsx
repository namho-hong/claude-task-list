import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

// Clawd - Claude Code's 8-bit pixel art robot mascot
import clawdImg from "./assets/clawd.png";
function ClawdIcon({ size = 20 }: { size?: number }) {
  return <img src={clawdImg} alt="Clawd" width={size} height={size * 0.64} style={{ imageRendering: "pixelated" }} />;
}

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
  lastUpdated: number;
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

const isUuid = (name: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);

interface ContextMenuState {
  x: number;
  y: number;
  items: { label: string; onClick: () => void; danger?: boolean }[];
}

function App() {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [screen, setScreen] = useState<Screen>({ type: "lists" });
  const [activeTab, setActiveTab] = useState<"named" | "unnamed">("named");
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showListMenu, setShowListMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const listMenuRef = useRef<HTMLDivElement>(null);

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

    // Reload when window regains focus
    const handleFocus = () => loadLists();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) loadLists();
    });

    return () => {
      unlisten.then((fn) => fn());
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadLists]);

  // Close context menu on outside click
  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null);
      setShowListMenu(false);
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  const handleSetTerminal = async (value: string) => {
    setTerminal(value);
    try {
      await invoke("set_terminal", { terminal: value });
    } catch (err) {
      console.error("Failed to set terminal:", err);
    }
  };

  const handleCreateList = async () => {
    // Replace spaces with hyphens
    const name = newListName.trim().replace(/\s+/g, "-");
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

  const handleDeleteList = async (listName: string) => {
    try {
      await invoke("delete_list", { listName });
      setScreen({ type: "lists" });
      await loadLists();
    } catch (err) {
      console.error("Failed to delete list:", err);
    }
  };

  const handleRenameList = async (oldName: string, newName: string) => {
    const sanitized = newName.trim().replace(/\s+/g, "-");
    if (!sanitized || sanitized === oldName) return;
    try {
      await invoke("rename_list", { oldName, newName: sanitized });
      setScreen({ type: "detail", listName: sanitized });
      setActiveTab("named");
      await loadLists();
    } catch (err) {
      console.error("Failed to rename list:", err);
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

  const handleDeleteTask = async (listName: string, taskId: string) => {
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

  const handleSpawnTask = async (listName: string, taskId: string) => {
    try {
      await invoke("spawn_task", { listName, taskId });
      await loadLists();
    } catch (err) {
      console.error("Failed to spawn task:", err);
    }
  };

  const showContextMenu = (
    e: React.MouseEvent,
    items: ContextMenuState["items"]
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, items });
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
          <ClawdIcon size={22} />
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
        {/* Tab bar */}
        <div className="tab-bar">
          <button
            className={`tab ${activeTab === "named" ? "tab-active" : ""}`}
            data-testid="tab-named"
            onClick={() => setActiveTab("named")}
          >
            Named
          </button>
          <button
            className={`tab ${activeTab === "unnamed" ? "tab-active" : ""}`}
            data-testid="tab-unnamed"
            onClick={() => setActiveTab("unnamed")}
          >
            Unnamed
          </button>
        </div>
        <div className="divider" />
        <div className="content">
          {(() => {
            const filtered = lists.filter((list) =>
              activeTab === "named" ? !isUuid(list.name) : isUuid(list.name)
            );

            const renderCard = (list: TaskList, showSpawn = true) => (
              <div
                key={list.name}
                className="list-card"
                data-testid={`list-card-${list.name}`}
                onClick={() =>
                  setScreen({ type: "detail", listName: list.name })
                }
                onContextMenu={(e) =>
                  showContextMenu(e, [
                    {
                      label: "Rename",
                      onClick: () => {
                        const newName = prompt("새 이름:", list.name);
                        if (newName) handleRenameList(list.name, newName);
                      },
                    },
                    {
                      label: "Delete",
                      danger: true,
                      onClick: () => handleDeleteList(list.name),
                    },
                  ])
                }
              >
                <div className="list-card-header">
                  <span className="list-name">
                    {list.name}{" "}
                    <span className="list-count-inline">
                      ({list.completed}/{list.total})
                    </span>
                  </span>
                  {showSpawn && (
                    <button
                      className="btn-play"
                      data-testid={`btn-play-${list.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSpawnAll(list.name);
                      }}
                    >
                      <ClawdIcon size={18} />
                    </button>
                  )}
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
              </div>
            );

            if (activeTab === "unnamed") {
              const withTasks = filtered.filter((l) => l.total > 0);
              const empty = filtered.filter((l) => l.total === 0);
              return (
                <>
                  {withTasks.length > 0 && (
                    <>
                      <div className="section-header">With Tasks</div>
                      {withTasks.map((list) => renderCard(list, true))}
                    </>
                  )}
                  {empty.length > 0 && (
                    <>
                      <div className="section-header">Empty Sessions</div>
                      {empty.map((list) => renderCard(list, false))}
                    </>
                  )}
                  {filtered.length === 0 && (
                    <div className="empty-state">No unnamed sessions</div>
                  )}
                </>
              );
            }

            return filtered.map((list) => renderCard(list, true));
          })()}

          {activeTab === "named" &&
            (showNewListInput ? (
              <div className="list-card new-list-input-card">
                <input
                  data-testid="input-new-list-name"
                  className="text-input"
                  type="text"
                  placeholder="List name (no spaces)..."
                  value={newListName}
                  onChange={(e) =>
                    setNewListName(e.target.value.replace(/\s+/g, "-"))
                  }
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
            ))}

          {activeTab === "unnamed" &&
            lists.filter((l) => isUuid(l.name)).length === 0 && (
              <div className="empty-state">No unnamed sessions</div>
            )}
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.items.map((item, i) => (
              <div
                key={i}
                className={`context-menu-item ${item.danger ? "danger" : ""}`}
                onClick={() => {
                  item.onClick();
                  setContextMenu(null);
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
        )}
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
        {renaming ? (
          <input
            className="text-input header-rename-input"
            data-testid="input-rename-list"
            value={renameValue}
            onChange={(e) =>
              setRenameValue(e.target.value.replace(/\s+/g, "-"))
            }
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                await handleRenameList(screen.listName, renameValue);
                setRenaming(false);
              }
              if (e.key === "Escape") {
                setRenaming(false);
              }
            }}
            onBlur={() => setRenaming(false)}
            autoFocus
          />
        ) : (
          <span className="header-title">{screen.listName}</span>
        )}
        <div className="header-actions">
          <button
            className="btn-spawn"
            data-testid="btn-spawn-all"
            onClick={() => handleSpawnAll(screen.listName)}
          >
            <ClawdIcon size={20} />
          </button>
          <div className="list-menu-wrapper" ref={listMenuRef}>
            <button
              className="btn-more"
              data-testid="btn-more-menu"
              onClick={(e) => {
                e.stopPropagation();
                setShowListMenu(!showListMenu);
              }}
            >
              ⋯
            </button>
            {showListMenu && (
              <div className="dropdown-menu" data-testid="list-dropdown-menu">
                <div
                  className="dropdown-item"
                  data-testid="btn-rename-list"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowListMenu(false);
                    setRenameValue(screen.listName);
                    setRenaming(true);
                  }}
                >
                  Rename
                </div>
                <div
                  className="dropdown-item danger"
                  data-testid="btn-delete-list"
                  onClick={async (e) => {
                    e.stopPropagation();
                    setShowListMenu(false);
                    await handleDeleteList(screen.listName);
                  }}
                >
                  Delete List
                </div>
              </div>
            )}
          </div>
        </div>
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
                  showContextMenu(e, [
                    {
                      label: "Delete",
                      danger: true,
                      onClick: () =>
                        handleDeleteTask(screen.listName, task.id),
                    },
                    ...(task.status === "in_progress"
                      ? [
                          {
                            label: "New Session",
                            onClick: () =>
                              handleSpawnTask(screen.listName, task.id),
                          },
                        ]
                      : []),
                  ])
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
                    className={`btn-spawn-task ${task.status === "in_progress" ? "btn-resume" : ""}`}
                    data-testid={`btn-spawn-${task.id}`}
                    onClick={() =>
                      handleSpawnTask(screen.listName, task.id)
                    }
                  >
                    {task.status === "in_progress" ? "Resume" : "Start"}
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

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.items.map((item, i) => (
            <div
              key={i}
              className={`context-menu-item ${item.danger ? "danger" : ""}`}
              onClick={() => {
                item.onClick();
                setContextMenu(null);
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
