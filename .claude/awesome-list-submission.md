# awesome-claude-code 제출 초안

> 제출 URL: https://github.com/hesreallyhim/awesome-claude-code/issues/new?template=recommend-resource.yml

---

## Resource Name

Claude Task List

## Resource URL

https://github.com/{OWNER}/claude-task-list

## Category

Tooling

## Description

A macOS menu bar app that gives you persistent access to Claude Code's task system (`~/.claude/tasks/`). Tasks are session-linked — launch a new Claude Code session or resume an existing one directly from the menu bar. No MCP, no external sync — it reads Claude Code's native task files in real-time.

**Key features:**
- Always-visible task lists in the menu bar (named + unnamed)
- One-click task execution with full session context injection
- Session resume via stored session IDs
- Cross-session task adds (tell Claude in any session to add to any list)
- Real-time file watching with 300ms debounce
- Supports iTerm2, Terminal.app, Warp

**Why it exists:** Claude Code tasks are bound to sessions. Close the terminal, they vanish. External tools (Linear/Notion via MCP) can store task text but lose the session context. This app keeps tasks visible and executable — Claude creates them, Claude executes them, the context stays intact.

**Built with:** Tauri v2 (Rust + WebView), React 19, Tailwind CSS 4

## Security Notes

- No network calls — purely local filesystem operations
- Reads/writes only to `~/.claude/tasks/` directory
- Session spawn uses macOS `osascript` for terminal automation
- No shell scripts executed beyond standard `claude` CLI invocation
- Code-signed and notarized for macOS

## Demo / Evidence

<!-- TODO: Add GIF or video link showing the app in action -->
<!-- Recommended: Record a short GIF showing:
  1. Menu bar icon click → task list view
  2. Creating a task list
  3. Clicking a task → Claude Code session spawns
  4. Session resume flow
-->
