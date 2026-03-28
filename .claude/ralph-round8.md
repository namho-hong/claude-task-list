# Task: 메뉴바에서 추가한 태스크가 Claude Code 세션에서 안 보이는 버그 (Round 8)

프로젝트 경로: /Users/dan/claude-task-list
기술 스택: Tauri v2 (Rust) + React 19 + TypeScript
실행 방법: `cargo tauri dev` (cargo build 단독 사용 금지)

## 증상

1. 메뉴바 앱에서 Named Task List에 새 태스크를 추가
2. 해당 리스트를 Spawn (Clawd 버튼 클릭)
3. 스폰된 Claude Code 세션에서 Ctrl+T를 눌러도 추가한 태스크가 안 보임

## 디버깅 절차

### Step 1: 파일 포맷 비교
- 메뉴바 앱의 create_task가 생성하는 JSON 포맷 확인 (src-tauri/src/lib.rs)
- Claude Code의 tasklist 플러그인이 생성하는 JSON 포맷 확인 (~/.claude/tasks/ 내 기존 파일 비교)
- 필드 차이, 누락 필드, 타입 차이 등 확인
- 차이가 있으면 create_task 수정

### Step 2: Guard task 호환성
- 메뉴바 앱은 0.json guard를 status: "completed"로 생성
- tasklist 플러그인은 0.json guard를 status: "pending"으로 생성
- 이 차이가 문제를 일으키는지 확인
- 필요하면 guard task 포맷을 tasklist 플러그인과 동일하게 맞추기

### Step 3: Ctrl+T 태스크 뷰의 데이터 소스
- Claude Code의 Ctrl+T가 어디서 데이터를 읽는지 확인
- ~/.claude/tasks/ 디렉토리를 직접 읽는지, 아니면 내부 state를 사용하는지
- CLAUDE_CODE_TASK_LIST_ID 환경변수가 설정되었을 때 어떤 경로로 읽는지

### Step 4: 실제 테스트
테스트 리스트를 만들고 실제로 태스크가 보이는지 확인:

1. 테스트용 리스트 디렉토리 생성: `mkdir -p ~/.claude/tasks/Bug-Test`
2. Guard task 생성 (tasklist 플러그인 포맷과 동일하게)
3. 태스크 파일 생성 (tasklist 플러그인 포맷과 동일하게)
4. `CLAUDE_CODE_TASK_LIST_ID=Bug-Test claude` 실행
5. cliclick으로 Ctrl+T 전송
6. screencapture로 태스크가 보이는지 확인
7. 안 보이면 포맷을 변경하며 재시도

### Step 5: create_task 수정
포맷 차이를 발견하면 Rust create_task 함수를 수정하여 Claude Code가 읽을 수 있는 포맷으로 생성

## 검증 방법

최종 검증:
1. `cargo tauri dev`로 앱 실행
2. cliclick으로 tray icon 클릭 → 창 열기
3. Named 탭에서 리스트 선택 → Screen 2 진입
4. 새 태스크 입력 + Add 클릭
5. ls로 ~/.claude/tasks/{list}/ 에 파일 생성 확인
6. Clawd 버튼으로 해당 리스트 Spawn
7. 스폰된 터미널에서 Claude Code가 시작되면 cliclick으로 Ctrl+T 전송
8. screencapture로 태스크 목록에 새 태스크가 보이는지 확인

## 검증 기준

- [ ] 메뉴바에서 추가한 태스크가 ~/.claude/tasks/에 올바른 포맷으로 저장됨
- [ ] create_task의 JSON 포맷이 Claude Code/tasklist 플러그인과 호환
- [ ] 스폰된 세션의 Ctrl+T에서 메뉴바로 추가한 태스크가 보임
- [ ] 기존 E2E 테스트 통과
- [ ] screencapture로 시각적 확인

## 완료 조건
위 검증 기준을 모두 충족했을 때만 completion promise를 출력하라.
