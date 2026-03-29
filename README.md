# Claude Task List

**Claude Code tasks, unchained from sessions. See, launch, and resume — right from your menu bar.**

A lightweight macOS menu bar app that gives you persistent, always-visible access to your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) task lists — with one-click session execution.

<!-- TODO: Add screenshot/GIF here -->
<!-- ![Claude Task List screenshot](docs/screenshot.png) -->

## The Problem

If you use Claude Code as your primary workflow engine, you've probably started managing tasks through it — not just code tasks, but everything. It's fast, contextual, and natural.

But task lists are bound to sessions. Close the terminal, and they vanish from view. You either reload them manually every time, or resort to external tools (Linear, Notion via MCP) that strip away the context that made Claude Code tasks powerful in the first place.

## What This Does

Claude Task List watches `~/.claude/tasks/` and surfaces everything in your menu bar:

- **See all your task lists** — named and unnamed, at a glance
- **Browse tasks** with status (pending / in progress / completed)
- **Launch a task** — spawns a new Claude Code session with the task's full context
- **Resume a session** — picks up exactly where you left off, with session ID linking
- **Add tasks from anywhere** — tell Claude in any session to add to any list

### Why not just use an external task manager?

| External tools (Linear, Notion) | Claude Task List |
|---|---|
| Tasks are just text fragments | Tasks carry their **session context** |
| Separate system from the executor | Claude **creates and executes** — same system |
| Requires MCP setup + context copying | Reads native `~/.claude/tasks/` directly |
| Another app to manage | Lives in your **menu bar** — zero friction |

## Install

### From GitHub Releases

1. Download the latest `.dmg` from [Releases](../../releases)
2. Drag to Applications
3. Launch — it appears in your menu bar

### Build from Source

```bash
git clone https://github.com/namho-hong/claude-task-list.git
cd claude-task-list
npm install
npm run tauri build
```

The built `.dmg` will be in `src-tauri/target/release/bundle/dmg/`.

> **Requirements:** Node.js 18+, Rust toolchain, macOS 12+

## Usage

1. **Click the menu bar icon** to open the task panel
2. **Create a list** — give it a name, optionally bind it to a project directory
3. **Add tasks** — either from the UI or from any Claude Code session:
   ```
   Add "fix auth bug" to my backend-tasks list
   ```
4. **Click a task** to launch or resume a Claude Code session for it
5. **Terminal support** — works with iTerm2, Terminal.app, and Warp

### How tasks connect to sessions

When you launch a task, Claude Task List:
1. Creates a new Claude Code session (or resumes an existing one)
2. Injects the task context as the initial prompt
3. Links the session ID back to the task for future resume

This means Claude starts with full context — no briefing needed.

## Tech Stack

- **Frontend:** React 19 + TypeScript + Tailwind CSS 4
- **Desktop:** Tauri v2 (Rust backend + WebView)
- **Data:** JSON files in `~/.claude/tasks/` — no database, no sync, no server

## Project Structure

```
src/App.tsx              — React main component (dual-screen UI)
src/App.css              — Tailwind + custom styles
src-tauri/src/lib.rs     — Rust commands, file watcher, system tray, session spawn
src-tauri/tauri.conf.json — Window config (380x520, transparent, hudWindow)
```

## Roadmap

- [ ] Agent launchpad — initiate autonomous agent loops from the menu bar
- [ ] Persistent channel sessions — always-on Claude instances connected via messaging
- [ ] Cross-device sync via cloud task storage

## License

MIT
