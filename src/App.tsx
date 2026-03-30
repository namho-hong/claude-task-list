import { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./App.css";

// Clawd - Claude Code's 8-bit pixel art robot mascot
import clawdImg from "./assets/clawd.png";
function ClaudeIcon({ size = 20 }: { size?: number }) {
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
  projectDir: string | null;
}

type Screen = { type: "listlist" } | { type: "tasklist"; listName: string };

const STATUS_ORDER: Record<string, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2,
};

const STATUS_OPTIONS: { value: Task["status"]; icon: string; label: string }[] = [
  { value: "pending", icon: "○", label: "Pending" },
  { value: "in_progress", icon: "◉", label: "In Progress" },
  { value: "completed", icon: "✓", label: "Completed" },
];

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
  const [screen, setScreen] = useState<Screen>({ type: "listlist" });
  const [activeTab, setActiveTab] = useState<"named" | "unnamed">("named");
  const [newListName, setNewListName] = useState("");
  const [showNewListInput, setShowNewListInput] = useState(false);
  const [newTaskSubject, setNewTaskSubject] = useState("");
  const [terminal, setTerminal] = useState("terminal");
  const [tooltip, setTooltip] = useState<{
    id: string;
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showListMenu, setShowListMenu] = useState(false);
  const [statusDropdown, setStatusDropdown] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const [listPreview, setListPreview] = useState<{ name: string; x: number; y: number; above: boolean } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [renamingCard, setRenamingCard] = useState<string | null>(null);
  const [cardRenameValue, setCardRenameValue] = useState("");

  // Auto-update state
  const [updateState, setUpdateState] = useState<
    | { status: "idle" }
    | { status: "available"; update: Update }
    | { status: "downloading"; progress: number }
    | { status: "ready" }
    | { status: "error" }
  >({ status: "idle" });
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskValue, setEditingTaskValue] = useState("");
  const focusTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mouseSuppressionRef = useRef(false);
  const listMenuRef = useRef<HTMLDivElement>(null);

  // Shared filter: named vs unnamed (unnamed excludes empty sessions)
  const getVisibleLists = useCallback(() => {
    const byTab = lists.filter((list) =>
      activeTab === "named" ? !isUuid(list.name) : isUuid(list.name)
    );
    return activeTab === "unnamed" ? byTab.filter((l) => l.total > 0) : byTab;
  }, [lists, activeTab]);

  const loadLists = useCallback(async () => {
    try {
      const result = await invoke<TaskList[]>("get_task_lists");
      setLists(result);
    } catch (err) {
      console.error("[frontend] Failed to load lists:", err);
    }
  }, []);

  // Check for app updates on mount
  useEffect(() => {
    check()
      .then((update) => {
        if (update) {
          setUpdateState({ status: "available", update });
        }
      })
      .catch((err) => {
        console.error("[updater] check failed:", err);
      });
  }, []);

  const handleUpdate = useCallback(async () => {
    if (updateState.status !== "available") return;
    const { update } = updateState;
    try {
      setUpdateState({ status: "downloading", progress: 0 });
      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setUpdateState({
                status: "downloading",
                progress: Math.round((downloaded / contentLength) * 100),
              });
            }
            break;
          case "Finished":
            break;
        }
      });
      setUpdateState({ status: "ready" });
    } catch (err) {
      console.error("[updater] download failed:", err);
      setUpdateState({ status: "error" });
      // Revert to available after 3s so user can retry
      setTimeout(() => {
        setUpdateState({ status: "available", update });
      }, 3000);
    }
  }, [updateState]);

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

  // Re-enable mouse focus on real mouse movement
  useEffect(() => {
    const handleMouseMove = () => {
      mouseSuppressionRef.current = false;
    };
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null);
      setShowListMenu(false);
      setStatusDropdown(null);
    };
    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("click", handleClick);
    };
  }, []);

  // Reset focusedIndex on screen change or tab change
  useEffect(() => {
    setFocusedIndex(0);
    setEditingTaskId(null);
  }, [screen, activeTab]);

  // Focus change: dismiss tooltips, scroll into view, re-show tooltip after 1s dwell
  useEffect(() => {
    // Dismiss any existing tooltip/preview
    setTooltip(null);
    setListPreview(null);
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    if (focusTooltipTimerRef.current) clearTimeout(focusTooltipTimerRef.current);

    // Scroll focused item into view (slight delay so highlight paints first)
    const scrollTimer = setTimeout(() => {
    if (screen.type === "listlist") {
      const filtered = getVisibleLists();
      const list = filtered[focusedIndex];
      if (list) {
        document.querySelector(`[data-testid="list-card-${list.name}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
    } else if (screen.type === "tasklist") {
      const currentList = lists.find((l) => l.name === screen.listName);
      const tasks = [...(currentList?.tasks || [])].sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1) ||
          Number(a.id) - Number(b.id)
      );
      const statusOrder2 = ["in_progress", "pending", "completed"];
      const flatTasks2 = statusOrder2.flatMap((s) =>
        tasks.filter((t) => t.status === s)
      );
      const task = flatTasks2[focusedIndex];
      if (task) {
        document.querySelector(`[data-testid="task-item-${task.id}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
    }
    }, 50);

    // Start 1s timer for focused item tooltip
    focusTooltipTimerRef.current = setTimeout(() => {
      if (screen.type === "tasklist") {
        const currentList = lists.find((l) => l.name === screen.listName);
        const tasks = [...(currentList?.tasks || [])].sort(
          (a, b) =>
            (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1) ||
            Number(a.id) - Number(b.id)
        );
        const statusOrder = ["in_progress", "pending", "completed"];
        const flatTasks = statusOrder.flatMap((s) =>
          tasks.filter((t) => t.status === s)
        );
        const task = flatTasks[focusedIndex];
        if (task?.description) {
          const el = document.querySelector(`[data-testid="task-item-${task.id}"]`);
          if (el) {
            const rect = el.getBoundingClientRect();
            setTooltip({
              id: task.id,
              text: task.description,
              x: rect.left,
              y: rect.bottom + 4,
            });
          }
        }
      } else if (screen.type === "listlist") {
        const filtered = getVisibleLists();
        const list = filtered[focusedIndex];
        if (list && list.total > 0) {
          const el = document.querySelector(`[data-testid="list-card-${list.name}"]`);
          if (el) {
            const rect = el.getBoundingClientRect();
            const estimatedHeight = Math.min(list.total, 8) * 20 + 24;
            const spaceBelow = window.innerHeight - rect.bottom;
            const above = spaceBelow < estimatedHeight + 8;
            const y = above ? rect.top - 4 : rect.bottom + 4;
            setListPreview({ name: list.name, x: rect.left, y, above });
          }
        }
      }
    }, 1000);

    return () => {
      clearTimeout(scrollTimer);
      if (focusTooltipTimerRef.current) clearTimeout(focusTooltipTimerRef.current);
    };
  }, [focusedIndex, screen, activeTab, lists]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if an input/textarea/select is focused
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") {
        return;
      }

      // Skip if editing task inline
      if (editingTaskId) return;

      if (screen.type === "listlist") {
        // Tab and Escape work regardless of list count
        if (e.key === "Tab") {
          e.preventDefault();
          setActiveTab((prev) => (prev === "named" ? "unnamed" : "named"));
          return;
        } else if (e.key === "Escape") {
          e.preventDefault();
          invoke("hide_window").catch(() => {});
          return;
        }

        const filtered = getVisibleLists();
        const count = filtered.length;
        if (count === 0) return;

        if (e.key === "ArrowDown") {
          e.preventDefault();
          mouseSuppressionRef.current = true;
          setFocusedIndex((prev) => (prev + 1) % count);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          mouseSuppressionRef.current = true;
          setFocusedIndex((prev) => (prev - 1 + count) % count);
        } else if (e.key === "Enter" && e.metaKey) {
          e.preventDefault();
          const list = filtered[focusedIndex];
          if (list) {
            handleSpawnAll(list.name);
            invoke("hide_window").catch(() => {});
          }
        } else if (e.key === "Enter") {
          e.preventDefault();
          const list = filtered[focusedIndex];
          if (list) {
            setScreen({ type: "tasklist", listName: list.name });
          }
        }
      } else if (screen.type === "tasklist") {
        // Need allTasks from groups - compute inline
        const currentList = lists.find((l) => l.name === screen.listName);
        const tasks = [...(currentList?.tasks || [])].sort(
          (a, b) =>
            (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1) ||
            Number(a.id) - Number(b.id)
        );
        const statusOrder = ["in_progress", "pending", "completed"];
        const flatTasks = statusOrder.flatMap((s) =>
          tasks.filter((t) => t.status === s)
        );
        const count = flatTasks.length;

        if (e.key === "ArrowDown") {
          e.preventDefault();
          mouseSuppressionRef.current = true;
          if (count > 0) setFocusedIndex((prev) => (prev + 1) % count);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          mouseSuppressionRef.current = true;
          if (count > 0) setFocusedIndex((prev) => (prev - 1 + count) % count);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const task = flatTasks[focusedIndex];
          if (task) {
            handleSpawnTask(screen.listName, task.id);
            invoke("hide_window").catch(() => {});
          }
        } else if (e.key === "F2") {
          e.preventDefault();
          const task = flatTasks[focusedIndex];
          if (task) {
            setEditingTaskId(task.id);
            setEditingTaskValue(task.subject);
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          setScreen({ type: "listlist" });
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [screen, activeTab, lists, focusedIndex, editingTaskId]);

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
      setScreen({ type: "listlist" });
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
      setScreen({ type: "tasklist", listName: sanitized });
      setActiveTab("named");
      await loadLists();
    } catch (err) {
      console.error("Failed to rename list:", err);
    }
  };

  const handleSetStatus = async (listName: string, taskId: string, newStatus: string) => {
    try {
      await invoke("update_task_status", { listName, taskId, newStatus });
      await loadLists();
    } catch (err) {
      console.error("Failed to set status:", err);
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

  const renderUpdateButton = () => {
    if (updateState.status === "idle") return null;
    if (updateState.status === "available") {
      return (
        <button className="update-btn" onClick={handleUpdate}>
          ⬆ Update
        </button>
      );
    }
    if (updateState.status === "downloading") {
      return (
        <button className="update-btn update-btn-progress" disabled>
          ⬇ {updateState.progress}%
        </button>
      );
    }
    if (updateState.status === "ready") {
      return (
        <button className="update-btn update-btn-restart" onClick={() => relaunch()}>
          ↻ Restart
        </button>
      );
    }
    if (updateState.status === "error") {
      return (
        <button className="update-btn update-btn-error" disabled>
          ⬆ Update
        </button>
      );
    }
    return null;
  };

  // Screen 1: List selection
  if (screen.type === "listlist") {
    return (
      <div className="app-container" data-testid="app-root">
        <div className="header">
          <ClaudeIcon size={22} />
          <span className="header-title">Claude Task List</span>
          {renderUpdateButton()}
          <select
            className="header-terminal-select"
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
        <div className="content" onScroll={() => {
          if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
          setListPreview(null);
        }}>
          {(() => {
            const filtered = getVisibleLists();

            const renderCard = (list: TaskList, showSpawn = true, idx = -1) => (
              <div
                key={list.name}
                className={`list-card${screen.type === "listlist" && idx === focusedIndex ? " focused" : ""}`}
                data-testid={`list-card-${list.name}`}
                onClick={() =>
                  setScreen({ type: "tasklist", listName: list.name })
                }
                onMouseEnter={(e) => {
                  if (mouseSuppressionRef.current) return;
                  if (idx >= 0) setFocusedIndex(idx);
                  if (list.total > 0) {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    hoverTimerRef.current = setTimeout(() => {
                      const estimatedHeight = Math.min(list.total, 8) * 20 + 24;
                      const spaceBelow = window.innerHeight - rect.bottom;
                      const above = spaceBelow < estimatedHeight + 8;
                      const y = above ? rect.top - 4 : rect.bottom + 4;
                      setListPreview({ name: list.name, x: rect.left, y, above });
                    }, 1000);
                  }
                }}
                onMouseLeave={() => {
                  if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                  setListPreview(null);
                }}
                onContextMenu={(e) =>
                  showContextMenu(e, [
                    {
                      label: "Rename",
                      onClick: () => {
                        setCardRenameValue(isUuid(list.name) ? "" : list.name);
                        setRenamingCard(list.name);
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
                  {renamingCard === list.name ? (
                    <input
                      className="text-input card-rename-input"
                      data-testid={`input-rename-card-${list.name}`}
                      value={cardRenameValue}
                      placeholder="Enter list name"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        setCardRenameValue(e.target.value.replace(/\s+/g, "-"))
                      }
                      onKeyDown={async (e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                          await handleRenameList(list.name, cardRenameValue);
                          setRenamingCard(null);
                        }
                        if (e.key === "Escape") {
                          setRenamingCard(null);
                        }
                      }}
                      onBlur={() => setRenamingCard(null)}
                      autoFocus
                    />
                  ) : (
                    <span className="list-name">
                      {list.name}{" "}
                      <span className="list-count-inline">
                        ({list.completed}/{list.total})
                      </span>
                    </span>
                  )}
                  {showSpawn && (
                    <button
                      className="btn-play"
                      data-testid={`btn-play-${list.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSpawnAll(list.name);
                      }}
                    >
                      <ClaudeIcon size={18} />
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
                {list.projectDir ? (
                  <div
                    className="list-project-dir clickable"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const picked = await invoke<string | null>("pick_directory", { defaultPath: list.projectDir });
                      if (picked && picked !== list.projectDir) {
                        await invoke("set_project_dir", { listName: list.name, projectDir: picked });
                        await loadLists();
                      }
                    }}
                  >
                    {list.projectDir.replace(/^\/Users\/[^/]+/, "~")}
                  </div>
                ) : (
                  <button
                    className="btn-set-project-dir"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const picked = await invoke<string | null>("pick_directory", { defaultPath: null });
                      if (picked) {
                        await invoke("set_project_dir", { listName: list.name, projectDir: picked });
                      } else {
                        await invoke("init_project_dir", { listName: list.name });
                      }
                      await loadLists();
                    }}
                  >
                    Set directory
                  </button>
                )}
              </div>
            );

            if (filtered.length === 0) {
              return <div className="empty-state">{activeTab === "named" ? "No named lists" : "No unnamed sessions"}</div>;
            }
            return filtered.map((list, i) => renderCard(list, true, i));
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

        {/* List Preview Tooltip */}
        {listPreview && (() => {
          const previewList = lists.find((l) => l.name === listPreview.name);
          if (!previewList || previewList.tasks.length === 0) return null;
          const sorted = [...previewList.tasks]
            .sort((a, b) => (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1) || Number(a.id) - Number(b.id));
          return (
            <div
              className="list-preview-tooltip"
              style={listPreview.above
                ? { left: listPreview.x, bottom: window.innerHeight - listPreview.y }
                : { left: listPreview.x, top: listPreview.y }
              }
              onMouseEnter={() => setListPreview(null)}
            >
              {sorted.slice(0, 8).map((task) => (
                <div key={task.id} className={`list-preview-item ${task.status === "completed" ? "preview-completed" : ""}`}>
                  <span className={`preview-icon ${task.status === "in_progress" ? "status-active" : ""}`}>
                    {task.status === "completed" ? "✓" : task.status === "in_progress" ? "◉" : "○"}
                  </span>
                  <span className="preview-text">{task.subject}</span>
                </div>
              ))}
              {previewList.tasks.length > 8 && (
                <div className="list-preview-more">+{previewList.tasks.length - 8} more</div>
              )}
            </div>
          );
        })()}

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
    (a, b) => (STATUS_ORDER[a.status] ?? 1) - (STATUS_ORDER[b.status] ?? 1) || Number(a.id) - Number(b.id)
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

  // Flat task list for keyboard navigation indexing
  const allTasks = groups.flatMap((g) => g.tasks);

  return (
    <div className="app-container" data-testid="app-root">
      <div className="header">
        <button
          className="btn-back"
          data-testid="btn-back"
          onClick={() => setScreen({ type: "listlist" })}
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
        {renderUpdateButton()}
        <div className="header-actions">
          <button
            className="btn-spawn"
            data-testid="btn-spawn-all"
            onClick={() => handleSpawnAll(screen.listName)}
          >
            <ClaudeIcon size={20} />
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
                className={`task-item ${task.status === "completed" ? "task-completed" : ""}${screen.type === "tasklist" && allTasks.indexOf(task) === focusedIndex ? " focused" : ""}`}
                data-testid={`task-item-${task.id}`}
                onMouseEnter={() => {
                  if (mouseSuppressionRef.current) return;
                  const idx = allTasks.indexOf(task);
                  if (idx >= 0) setFocusedIndex(idx);
                }}
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
                  className={`task-status task-status-clickable ${task.status === "in_progress" ? "status-active" : ""}`}
                  data-testid={`task-status-${task.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setStatusDropdown(
                      statusDropdown?.taskId === task.id
                        ? null
                        : { taskId: task.id, x: rect.left, y: rect.bottom + 4 }
                    );
                  }}
                >
                  {task.status === "completed"
                    ? "✓"
                    : task.status === "in_progress"
                      ? "◉"
                      : "○"}
                </span>
                {statusDropdown?.taskId === task.id && (
                  <div
                    className="status-dropdown"
                    style={{ left: statusDropdown.x, top: statusDropdown.y }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <div
                        key={opt.value}
                        className={`status-dropdown-item ${opt.value === task.status ? "active" : ""}`}
                        onClick={async () => {
                          if (opt.value !== task.status) {
                            await handleSetStatus(screen.listName, task.id, opt.value);
                          }
                          setStatusDropdown(null);
                        }}
                      >
                        <span className="status-dropdown-icon">{opt.icon}</span>
                        {opt.label}
                      </div>
                    ))}
                  </div>
                )}
                {editingTaskId === task.id ? (
                  <input
                    className="task-edit-input"
                    data-testid={`task-edit-${task.id}`}
                    value={editingTaskValue}
                    onChange={(e) => setEditingTaskValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const val = editingTaskValue.trim();
                        if (val && val !== task.subject) {
                          invoke("update_task_subject", {
                            listName: screen.listName,
                            taskId: task.id,
                            newSubject: val,
                          }).then(() => loadLists());
                        }
                        setEditingTaskId(null);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingTaskId(null);
                      }
                    }}
                    onBlur={() => setEditingTaskId(null)}
                    autoFocus
                  />
                ) : (
                  <span
                    className="task-text"
                    data-testid={`task-text-${task.id}`}
                    onMouseEnter={(e) => showTooltip(task, e)}
                    onMouseLeave={hideTooltip}
                  >
                    {task.subject}
                  </span>
                )}
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
