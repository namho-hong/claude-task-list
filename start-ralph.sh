#!/bin/bash
cd /Users/dan/claude-task-list

# RALPH.md 내용을 읽어서 상태 파일에 직접 삽입
RALPH_CONTENT=$(cat RALPH.md)

mkdir -p .claude
cat > .claude/ralph-loop.local.md << STATEEOF
---
active: true
iteration: 1
session_id:
max_iterations: 50
completion_promise: "PHASE1_COMPLETE"
started_at: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
---

${RALPH_CONTENT}
STATEEOF

# Claude 시작 — RALPH.md 내용을 직접 프롬프트로 전달
claude "$RALPH_CONTENT"
