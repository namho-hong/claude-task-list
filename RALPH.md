# Claude Task List — macOS Menubar App

Tauri v2 + React + TypeScript + Tailwind CSS 기반 macOS 메뉴바 앱.
`~/.claude/tasks/` 디렉토리의 태스크 리스트 JSON 파일을 실시간 감시하고,
태스크 관리 + Claude Code 세션 스폰 기능을 제공한다.

## 기술 스택

- **프레임워크**: Tauri v2 (Rust backend + WebView frontend)
- **프론트엔드**: React + TypeScript + Tailwind CSS
- **테스트/검증**: tauri-plugin-mcp (스크린샷 + DOM + 입력 시뮬레이션)
- **파일 감시**: Rust `notify` crate 또는 tauri-plugin-fs-watch
- **UI 스타일**: macOS 기본 Material (glassmorphism — backdrop-filter: blur + 반투명 배경), 다크모드 전용
- **배포**: `cargo tauri dev`로 개발/검증 (빌드/서명은 MVP 이후)

## 데이터 소스

경로: `~/.claude/tasks/<list-name>/<N>.json`

```json
{
  "id": "1",
  "subject": "Task title",
  "description": "Detailed description",
  "status": "pending",          // pending | in_progress | completed
  "blocks": [],
  "blockedBy": [],
  "metadata": {                 // optional
    "deadline": "2026-03-25",
    "priority": "high",
    "category": "dev"
  }
}
```

### 데이터 규칙
- UUID 디렉토리 (예: `050c6b6b-afa2-...`) 는 필터링. named list만 표시
- `0.json`은 guard task → UI에서 숨김
- 새 태스크 ID = 기존 최대 ID + 1 (0 제외)
- 새 리스트 생성 시 디렉토리 + guard task(0.json) 자동 생성

## 앱 구조

### System Tray
- SF Symbol 체크마크 아이콘 (또는 동등한 tray 아이콘)
- 클릭 시 별도 floating window 표시 (NSPopover가 아닌 독립 window)
- Dock 아이콘 없음 (LSUIElement = true 동등 설정)
- Cmd+Q로 종료 가능

### Screen 1: 리스트 선택

```
┌──────────────────────────────────────────┐
│  ✓  Claude Task List                     │
├──────────────────────────────────────────┤
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  Personal                   0 / 5  │  │
│  │  ░░░░░░░░░░░░░░░░░░░░░░░░   0%   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  claude-code-mastery       3 / 68  │  │
│  │  ▓░░░░░░░░░░░░░░░░░░░░░░░   4%   │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  + New List                        │  │
│  └────────────────────────────────────┘  │
│                                          │
└──────────────────────────────────────────┘
```

- 카드 클릭 → Screen 2로 전환
- progress 계산 시 guard task (id: 0) 제외
- + New List: 리스트 이름 입력 → 디렉토리 + guard task 생성

### Screen 2: 태스크 리스트 상세

```
┌──────────────────────────────────────────┐
│  ←  Personal                    ⚡ Spawn │
├──────────────────────────────────────────┤
│                                          │
│  ── In Progress ─────────────────────    │
│  ◉  PR 리뷰                        ▶   │
│                                          │
│  ── Pending ─────────────────────────    │
│  ○  주주총회 관련 메일 회신          ▶   │
│  ○  월급 제공하기                    ▶   │
│  ○  팁스 비용 보전 신청              ▶   │
│                                          │
│  ── Completed ───────────────────────    │
│  ✓  장보기                    (dimmed)  │
│  ✓  세금 신고                 (dimmed)  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │  New task subject...        [Add]  │  │
│  └────────────────────────────────────┘  │
│                                          │
└──────────────────────────────────────────┘
```

#### 인터랙션

| 요소 | 동작 |
|------|------|
| ← | Screen 1로 돌아감 |
| ⚡ Spawn | 리스트 전체 스폰 (아래 스폰 참조) |
| ▶ (개별) | 리스트 스폰 + 이 태스크 먼저 작업 지시 |
| 태스크 텍스트 클릭 | 상태 토글: pending → in_progress → completed → pending |
| 태스크 호버 | description 툴팁 표시 |
| 우클릭 | 삭제 (JSON 파일 삭제) |
| ✓ 완료 태스크 | ▶ 없음, dimmed 표시 |
| + Add Task | subject 입력 → 새 JSON 파일 생성 (status: pending) |

#### 정렬 순서
1. in_progress (상단)
2. pending (중간)
3. completed (하단, dimmed)

## 스폰 동작

Warp 터미널 새 탭에서 Claude Code 세션을 시작한다.

### 리스트 전체 스폰 (⚡)
```bash
osascript -e '
set the clipboard to "CLAUDE_CODE_TASK_LIST_ID=Personal claude"
tell application "System Events"
    tell process "stable"
        click menu item "New Terminal Tab" of menu "File" of menu bar 1
        delay 3
        click menu item "Paste" of menu "Edit" of menu bar 1
        delay 1
        keystroke return
    end tell
end tell
'
```

### 개별 태스크 스폰 (▶)
```bash
osascript -e '
set the clipboard to "claude $'"'"'Personal 태스크 리스트에서 \"주주총회 관련 메일 회신\" 태스크를 먼저 작업해줘'"'"'"
tell application "System Events"
    tell process "stable"
        click menu item "New Terminal Tab" of menu "File" of menu bar 1
        delay 3
        click menu item "Paste" of menu "Edit" of menu bar 1
        delay 1
        keystroke return
    end tell
end tell
'
```

### 스폰 CRITICAL 규칙
- Warp process name = `"stable"` (NOT `"Warp"`)
- `Edit > Paste` 메뉴 클릭 (NOT Cmd+V)
- `File > New Terminal Tab` 메뉴 클릭 (NOT Cmd+T)
- delay 3 after tab open
- clipboard 설정을 탭 열기 전에 수행
- `keystroke return` 필수

## 파일 감시 (File Watcher)

- `~/.claude/tasks/` 전체를 재귀적으로 감시
- JSON 파일 생성/수정/삭제 이벤트 감지
- **디바운싱 300ms**: 연속 변경 시 마지막 변경 후 300ms 대기 후 한 번만 reload
- 변경 감지 → JSON 재파싱 → React 상태 업데이트 → UI 자동 반영
- JSON 파싱 실패 시 (동시 접근): 무시하고 다음 이벤트 대기 (crash 금지)

---

## 실행 방식

Phase별로 개별 ralph-loop를 실행한다. 각 Phase는 독립적인 completion promise를 가진다.

| Phase | Promise | 명령 |
|-------|---------|------|
| 1 | PHASE1_COMPLETE | `--max-iterations 50 --completion-promise "PHASE1_COMPLETE"` |
| 2 | PHASE2_COMPLETE | `--max-iterations 50 --completion-promise "PHASE2_COMPLETE"` |
| 3 | PHASE3_COMPLETE | `--max-iterations 50 --completion-promise "PHASE3_COMPLETE"` |
| 4 | PHASE4_COMPLETE | `--max-iterations 50 --completion-promise "PHASE4_COMPLETE"` |
| 5 | PHASE5_COMPLETE | `--max-iterations 50 --completion-promise "PHASE5_COMPLETE"` |

Phase 5 완료 후 최종 완료 조건 전체 충족 시: `<promise>COMPLETE</promise>`

---

## 반복 시작 프로토콜 (매 iteration 필수)

매 iteration 시작 시 아래 순서로 현재 상태를 파악한다.

### Step 0: 컨텍스트 복원 (컴팩트 대비)
1. `PROGRESS.md` 읽기 — 이것이 컴팩트 이후의 "기억"
2. "실패한 접근법" 섹션 확인 → **이 방법들은 재시도하지 않음**
3. "현재 작업 중" 항목부터 이어서 진행

### Step 1: 프로젝트 존재 확인
- 프로젝트 디렉토리가 존재하는가?
- `package.json`, `Cargo.toml` 등 핵심 파일이 있는가?
- 없으면 → Phase 1부터 시작

### Step 2: 빌드 상태 확인
- `cargo tauri dev` 실행 → 컴파일 성공 여부
- 실패하면 → 에러 메시지 기반으로 수정부터

### Step 3: 완료 조건 체크리스트 순회
- 현재 Phase의 완료 조건을 하나씩 검증
- 이미 충족된 항목 파악
- 미충족 항목 중 첫 번째부터 작업 시작

### Step 4: 작업 수행
- 미충족 항목을 하나씩 해결

### Step 5: iteration 종료 시 PROGRESS.md 갱신
- 아래 형식으로 반드시 갱신 (다음 iteration과 컴팩트에 대한 보험)

---

## PROGRESS.md 형식 (매 iteration 종료 시 갱신)

```md
# Progress — Phase N

## Iteration
현재: 12 / 50

## 완료
- [x] 항목 1
- [x] 항목 2

## 현재 작업 중
- [ ] 항목 3
  - 상태: 컴파일은 되나 이벤트 미수신
  - 마지막 시도: CrossPlatformWatcher로 변경

## 실패한 접근법 (재시도 금지)
- notify 6.x RecommendedWatcher → macOS FSEvents 호환 X
- polling watcher 100ms → CPU 사용률 과다

## 실패 로그 (최근 3건)
- iter 12: notify 8.0 EventKind::Modify 수신되나 path가 None
         → event.paths 대신 event.info 확인 필요
- iter 11: notify RecommendedWatcher macOS에서 FSEvents 미작동
         → CrossPlatformWatcher로 변경 시도
- iter 10: Cargo.toml에 notify 버전 충돌
         → 6.1.1 → 8.0.0 업그레이드로 해결

## 다음 작업
1. event.info 기반으로 파일 경로 추출 로직 수정
2. 수정 후 파일 감시 검증 재실행
```

### PROGRESS.md 규칙
- 실패 로그는 **최근 3건**만 유지 (오래된 것 삭제)
- "실패한 접근법"은 **누적** (삭제하지 않음 — 재시도 방지용)
- Phase 전환 시 새 Phase 내용으로 교체 (이전 Phase 로그는 필요 없음)

---

## 반복 한도 도달 시 (Escape Hatch)

max-iterations (50회)에 도달했지만 Phase 완료 조건 미충족 시:

### 즉시 수행
1. PROGRESS.md에 최종 상태 기록:
   - **완료된 항목**: 체크리스트 중 충족된 항목 나열
   - **블로킹 이슈**: 현재 막힌 문제와 에러 메시지
   - **시도한 접근법**: 이번 루프에서 시도한 모든 해결 방법
   - **권장 다음 단계**: 다음 루프에서 시도할 대안

### 안전 장치
- 동일 에러가 **5회 연속** 반복되면 → 다른 접근법으로 전환
- **3가지 접근법** 모두 실패하면 → "실패한 접근법"에 기록하고 다음 항목으로 이동
- 해당 항목이 다른 항목의 선행 조건이면 → PROGRESS.md에 블로킹 의존성 기록

---

## Phase 별 구현 계획

### Phase 1: 프로젝트 셋업 + MCP + 파일 감시 (기반)

1. Tauri v2 프로젝트 생성 (React + TypeScript + Tailwind)
2. Tauri 설정: Dock 아이콘 숨김, system tray 아이콘 등록
3. tauri-plugin-mcp 설치 및 설정 (debug 빌드)
4. Rust 파일 감시 구현 (`notify` crate, ~/.claude/tasks/ 감시, 300ms 디바운싱)
5. 프론트엔드 데이터 모델: TaskList[], Task[] TypeScript 타입
6. Tauri command로 파일 읽기/쓰기/삭제 API 구현
7. 파일 변경 → 프론트엔드 이벤트 전달 파이프라인

**검증**:
- `cargo tauri dev` 빌드 성공
- tray 아이콘 표시됨 (screencapture로 확인)
- MCP로 스크린샷 촬영 가능
- ~/.claude/tasks/ 에 파일 추가/수정 시 콘솔에 변경 로그 출력

**E2E 검증 (tauri-plugin-mcp)**:
1. MCP 스크린샷 촬영 → tray 아이콘이 메뉴바에 표시되는지 확인
2. MCP DOM 조회 → WebView가 정상 로드되었는지 확인 (root 엘리먼트 존재)
3. 테스트용 JSON 파일을 `~/.claude/tasks/E2E-Test/1.json`에 생성
4. 500ms 대기 후 MCP DOM 재조회 → 프론트엔드에 파일 변경 이벤트가 수신되었는지 확인 (콘솔 로그 또는 상태 변수)
5. 테스트 파일 삭제 → 정리

**Self-Correction**:
1. `cargo tauri dev` 실패 → 에러 읽고 수정
2. MCP 연결 실패 → screencapture로 폴백하고 계속 진행
3. 파일 감시 안 됨 → notify crate 설정 확인, 경로 권한 확인
4. E2E 실패 → MCP 연결 상태 확인, DOM selector 수정

**Phase 1 완료 조건**:
- [ ] `cargo tauri dev` 에러 없이 빌드/실행
- [ ] tray 아이콘 표시됨
- [ ] ~/.claude/tasks/ 파일 변경 → 콘솔 로그 출력 (파일 감시 동작)
- [ ] MCP 또는 screencapture로 tray 아이콘 확인
- [ ] E2E: MCP DOM 조회로 WebView 로드 확인
- [ ] E2E: 파일 생성 → 파일 감시 이벤트 수신 확인

→ 모두 충족 시: `<promise>PHASE1_COMPLETE</promise>`

### Phase 2: Screen 1 — 리스트 선택 화면

1. floating window UI 구현 (tray 아이콘 클릭 시 표시/숨김)
2. ~/.claude/tasks/ 에서 named list 목록 로드 (UUID 필터링)
3. 각 리스트: 이름 + 완료/전체 + 프로그레스 바 (guard task 제외)
4. 리스트 카드 클릭 → Screen 2 전환
5. + New List 버튼 → 이름 입력 → 디렉토리 + guard task 생성
6. glassmorphism 스타일 적용 (backdrop-filter: blur, 반투명 배경)

**검증**:
- MCP 스크린샷으로 리스트가 올바르게 표시되는지 확인
- 실제 ~/.claude/tasks/Personal/ 의 태스크 수와 UI 표시 수 일치
- New List로 생성 후 디렉토리와 0.json 존재 확인
- 다른 터미널에서 태스크 파일 추가 → UI 자동 갱신 확인

**E2E 검증 (tauri-plugin-mcp)**:
1. MCP DOM 조회 → 리스트 카드 엘리먼트 개수 세기
2. 파일 시스템에서 `~/.claude/tasks/` 의 named list 개수와 DOM 카드 개수 일치 확인
3. MCP 입력 시뮬레이션 → "+ New List" 버튼 클릭
4. 리스트 이름 입력 필드에 "E2E-Test" 입력 시뮬레이션 → 확인/Enter
5. DOM 재조회 → "E2E-Test" 카드가 새로 표시되는지 확인
6. 파일 시스템 → `~/.claude/tasks/E2E-Test/` 디렉토리 + `0.json` 존재 확인
7. MCP 입력 시뮬레이션 → 리스트 카드 클릭
8. DOM 조회 → Screen 2로 전환되었는지 확인 (뒤로가기 버튼 존재 여부)
9. MCP 스크린샷 → glassmorphism 스타일 시각적 확인
10. 외부에서 `~/.claude/tasks/E2E-Test/1.json` 생성 → 500ms 대기 → DOM 재조회 → 프로그레스 바 갱신 확인
11. 테스트 리스트 정리 (E2E-Test 디렉토리 삭제)

**Self-Correction**:
1. UI 안 보임 → window 설정, tray 클릭 이벤트 확인
2. 리스트 수 불일치 → UUID 필터링/guard task 제외 로직 확인
3. 파일 변경 후 UI 갱신 안 됨 → 이벤트 파이프라인 디버깅
4. E2E 클릭 실패 → DOM selector 확인, 엘리먼트에 data-testid 속성 추가

**Phase 2 완료 조건**:
- [ ] tray 아이콘 클릭 → 윈도우 표시됨
- [ ] Screen 1에 named task list 목록 표시됨 (UUID 필터링, guard task 제외)
- [ ] 프로그레스 바가 실제 완료율 반영
- [ ] + New List → 디렉토리 + guard task 생성
- [ ] 외부 파일 변경 → UI 자동 갱신
- [ ] glassmorphism 스타일 적용
- [ ] E2E: New List 생성 → DOM에 카드 표시 + 파일 시스템 확인
- [ ] E2E: 리스트 카드 클릭 → Screen 2 전환 확인
- [ ] E2E: 외부 파일 변경 → 프로그레스 바 자동 갱신 확인

→ 모두 충족 시: `<promise>PHASE2_COMPLETE</promise>`

### Phase 3: Screen 2 — 태스크 상세 + CRUD

1. 뒤로가기(←), 리스트 이름, ⚡ Spawn 버튼 헤더
2. 태스크 목록: in_progress → pending → completed 순 정렬
3. 상태 아이콘: ○(pending) ◉(in_progress) ✓(completed)
4. 태스크 텍스트 클릭 → 상태 토글 (JSON 파일 수정)
5. completed 태스크 dimmed 표시, ▶ 버튼 없음
6. 태스크 호버 → description 툴팁 표시
7. 태스크 삭제 (우클릭 → JSON 파일 삭제)
8. + Add Task: subject 입력 → 새 JSON 파일 생성
9. ▶ 개별 스폰 버튼 (pending/in_progress만)

**검증**:
- 상태 토글 후 JSON 파일의 status 값 변경 확인 (cat으로)
- 태스크 추가 후 새 JSON 파일 생성 확인
- 태스크 삭제 후 JSON 파일 삭제 확인
- 정렬 순서: in_progress 상단, completed 하단 확인
- MCP 스크린샷으로 시각적 확인

**E2E 검증 (tauri-plugin-mcp)**:
1. 사전 준비: Screen 2가 표시된 상태에서 시작 (Screen 1에서 리스트 카드 클릭)
2. MCP DOM 조회 → 태스크 목록 엘리먼트 순서 확인 (in_progress → pending → completed)
3. MCP 입력 시뮬레이션 → Add Task 입력 필드에 "E2E 테스트 태스크" 입력 + Add 버튼 클릭
4. DOM 재조회 → "E2E 테스트 태스크" 엘리먼트 존재 확인 (pending 섹션)
5. 파일 시스템 → 새 JSON 파일 생성 확인 + status: "pending" 확인
6. MCP 입력 시뮬레이션 → "E2E 테스트 태스크" 텍스트 클릭 (상태 토글)
7. DOM 재조회 → 상태 아이콘 변경 확인 (○ → ◉, pending → in_progress 섹션 이동)
8. 파일 시스템 → JSON 파일 status: "in_progress" 확인
9. MCP 입력 시뮬레이션 → 같은 태스크 텍스트 다시 클릭
10. DOM 재조회 → completed 섹션 이동 + dimmed 스타일 + ▶ 버튼 없음 확인
11. 파일 시스템 → JSON 파일 status: "completed" 확인
12. MCP 입력 시뮬레이션 → "E2E 테스트 태스크" 우클릭 → 삭제
13. DOM 재조회 → "E2E 테스트 태스크" 엘리먼트 사라짐 확인
14. 파일 시스템 → 해당 JSON 파일 삭제 확인

**Self-Correction**:
1. 상태 토글 안 됨 → Tauri command 호출/JSON 쓰기 확인
2. 정렬 안 맞음 → sort 로직 디버깅
3. 삭제 후 UI 갱신 안 됨 → 파일 감시 이벤트 확인
4. E2E 클릭이 엘리먼트 못 찾음 → data-testid 속성 확인, selector 수정
5. E2E 상태 토글 후 DOM 미갱신 → React 상태 업데이트 타이밍, 적절한 대기 추가

**Phase 3 완료 조건**:
- [ ] 태스크가 상태별 정렬됨 (in_progress → pending → completed)
- [ ] 태스크 텍스트 클릭 → 상태 토글 + JSON 파일 반영
- [ ] 태스크 호버 → description 툴팁 표시
- [ ] + Add Task → 새 태스크 추가 + JSON 파일 생성
- [ ] 태스크 삭제 (우클릭) → JSON 파일 삭제
- [ ] E2E: Add Task → DOM에 태스크 표시 + JSON 파일 생성 확인
- [ ] E2E: 상태 토글 (pending → in_progress → completed) → DOM + JSON 동기화 확인
- [ ] E2E: 태스크 삭제 → DOM에서 제거 + JSON 파일 삭제 확인

→ 모두 충족 시: `<promise>PHASE3_COMPLETE</promise>`

### Phase 4: 스폰 통합

1. ⚡ 리스트 전체 스폰: osascript로 Warp 새 탭 + CLAUDE_CODE_TASK_LIST_ID
2. ▶ 개별 태스크 스폰: osascript로 Warp 새 탭 + 프롬프트에 태스크 이름 포함

**검증**:
- ⚡ 클릭 → Warp 새 탭 열림 + claude 명령어 실행됨
- ▶ 클릭 → Warp 새 탭 열림 + 해당 태스크 이름이 프롬프트에 포함됨
- Accessibility 권한 팝업 대응 (첫 실행 시)

**E2E 검증 (tauri-plugin-mcp)**:
1. Screen 2 DOM 조회 → ⚡ Spawn 버튼 존재 확인
2. DOM 조회 → pending/in_progress 태스크에 ▶ 버튼 존재, completed 태스크에 ▶ 버튼 없음 확인
3. MCP 입력 시뮬레이션 → ⚡ Spawn 버튼 클릭
4. 2초 대기 → screencapture로 Warp 새 탭 열림 확인
5. 클립보드 내용 확인 → `CLAUDE_CODE_TASK_LIST_ID=<리스트이름> claude` 포함 확인
6. MCP 입력 시뮬레이션 → pending 태스크의 ▶ 버튼 클릭
7. 2초 대기 → screencapture로 Warp 새 탭 열림 확인
8. 클립보드 내용 확인 → 해당 태스크 이름이 프롬프트에 포함 확인

**Self-Correction**:
1. osascript 실패 → Warp process name "stable" 확인
2. 클립보드 내용 미전달 → delay/순서 확인
3. Accessibility 권한 없음 → 사용자에게 안내 표시
4. E2E에서 ⚡/▶ 버튼 못 찾음 → data-testid 확인, selector 수정

**Phase 4 완료 조건**:
- [ ] ⚡ Spawn → Warp 새 탭 열림 + claude 실행
- [ ] ▶ 개별 Spawn → Warp 새 탭 + 태스크 이름 포함
- [ ] E2E: ⚡ 클릭 → 클립보드에 올바른 명령어 + Warp 탭 열림 확인
- [ ] E2E: ▶ 클릭 → 클립보드에 태스크 이름 포함 확인
- [ ] E2E: completed 태스크에 ▶ 버튼 미표시 확인

→ 모두 충족 시: `<promise>PHASE4_COMPLETE</promise>`

### Phase 5: 폴리시

1. 다크모드 전용 UI (라이트모드 미지원)
2. Cmd+Q 종료 지원
3. 스크롤 (태스크 많을 때)
4. 빈 리스트 상태 처리 ("No tasks yet")

**검증**:
- 다크모드 스크린샷으로 UI 확인
- 태스크 20개+ 리스트에서 스크롤 동작 확인
- Cmd+Q로 앱 정상 종료 확인

**E2E 검증 (tauri-plugin-mcp)**:
1. MCP 스크린샷 촬영 → 다크모드 UI가 정상 렌더링되는지 확인
2. 테스트 리스트에 태스크 20개 일괄 생성 (JSON 파일 20개 작성)
3. Screen 2 진입 → MCP DOM 조회 → 20개 태스크 엘리먼트 존재 확인
4. MCP 입력 시뮬레이션 → 스크롤 다운 → 마지막 태스크가 뷰포트에 보이는지 확인
5. 빈 리스트 생성 (guard task만 존재) → Screen 2 진입
6. DOM 조회 → "No tasks yet" 또는 빈 상태 메시지 표시 확인
7. 테스트 데이터 정리

**Self-Correction**:
1. 스크롤 안 됨 → overflow 스타일 확인, 컨테이너 높이 고정 확인
2. E2E 스크롤 검증 실패 → scrollIntoView 또는 MCP 스크롤 시뮬레이션 방식 변경

**Phase 5 완료 조건**:
- [ ] 다크모드 전용 UI 적용
- [ ] 스크롤 동작
- [ ] Cmd+Q 종료
- [ ] 빈 리스트 상태 처리
- [ ] E2E: 다크모드 UI 스크린샷 확인
- [ ] E2E: 태스크 20개 스크롤 동작 확인
- [ ] E2E: 빈 리스트 "No tasks yet" 메시지 확인

→ 모두 충족 시: `<promise>PHASE5_COMPLETE</promise>`

---

## 최종 완료 조건

Phase 1~5 모든 완료 조건이 참일 때만 `<promise>COMPLETE</promise>` 출력.

## E2E 테스트 공통 규칙

### data-testid 컨벤션
모든 인터랙티브 엘리먼트에 `data-testid` 속성을 부여한다. MCP DOM 조회 및 입력 시뮬레이션의 selector로 사용.

| 엘리먼트 | data-testid |
|----------|-------------|
| 리스트 카드 | `list-card-{리스트이름}` |
| 리스트 프로그레스 바 | `list-progress-{리스트이름}` |
| + New List 버튼 | `btn-new-list` |
| New List 이름 입력 | `input-new-list-name` |
| 뒤로가기 버튼 | `btn-back` |
| ⚡ Spawn 버튼 | `btn-spawn-all` |
| 태스크 항목 | `task-item-{id}` |
| 태스크 텍스트 (클릭 영역) | `task-text-{id}` |
| 태스크 description 툴팁 | `task-tooltip-{id}` |
| 태스크 상태 아이콘 | `task-status-{id}` |
| ▶ 개별 스폰 버튼 | `btn-spawn-{id}` |
| + Add Task 입력 | `input-new-task` |
| Add 버튼 | `btn-add-task` |
| 빈 상태 메시지 | `empty-state` |

### E2E 실행 규칙
1. E2E 검증은 해당 Phase의 기능 구현 완료 후 실행
2. MCP 연결 실패 시 → screencapture + 수동 파일 시스템 검증으로 폴백
3. DOM 조회 실패 시 → data-testid 누락 여부 확인 → 코드에 추가 후 재시도
4. 입력 시뮬레이션 후 DOM 변경 대기 → 최소 300ms (파일 감시 디바운싱 고려)
5. E2E 테스트에서 생성한 데이터(리스트, 태스크)는 반드시 정리

## Self-Correction 공통 규칙

1. 코드 작성 후 반드시 `cargo tauri dev` 실행
2. 컴파일 에러 → 에러 메시지 읽고 수정
3. 런타임 에러 → 콘솔 로그 확인 후 수정
4. UI 이상 → MCP 스크린샷 또는 screencapture로 확인 후 수정
5. MCP 연결 실패 → screencapture로 폴백
6. 동일 에러 5회 연속 반복 → 다른 접근법으로 전환
7. 3가지 접근법 모두 실패 → "실패한 접근법"에 기록하고 다음 항목으로 이동
8. **매 iteration 종료 시 PROGRESS.md 반드시 갱신**
9. E2E 테스트 실패 → selector/타이밍 문제 우선 확인 후 기능 로직 확인
10. 모든 Phase 완료 + 완료 조건 전체 충족까지 반복
