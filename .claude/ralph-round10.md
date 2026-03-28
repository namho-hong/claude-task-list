# Task: Named Task List 프로젝트 디렉토리 바인딩 (Round 10)

프로젝트 경로: /Users/dan/claude-task-list
기술 스택: Tauri v2 (Rust) + React 19 + TypeScript + Tailwind CSS 4
실행 방법: `cargo tauri dev` (cargo build 단독 사용 금지)

## 배경

Named Task List를 spawn하면 터미널 기본 위치(~)에서 Claude가 시작됨.
home 디렉토리에서는 trust 설정이 안 되고 프로젝트 컨텍스트도 없어서 UX가 나쁨.
Unnamed session은 `find_session_project_dir`로 JSONL에서 cwd를 역추적하지만,
Named list에는 이 정보가 없음.

## 핵심 설계 결정 (확정)

1. Named list 생성 시 `~/claude-task-list/<list-name>/` 워크스페이스 자동 생성
2. `~/.claude/tasks/<list-name>/_meta.json`에 `{"project_dir": "..."}` 기록
3. spawn 시 `_meta.json`의 `project_dir`로 `cd` 후 Claude 실행
4. 앱 `productName`을 `claude-task-list-app`으로 변경 (워크스페이스 경로와 충돌 방지)
5. UUID→Named rename 시 `find_session_project_dir`로 기존 디렉토리 캡처 → `_meta.json`에 보존
6. Named list의 `project_dir`이 삭제된 경우 → 자동 재생성(mkdir)
7. 리스트 삭제 시 워크스페이스(`~/claude-task-list/<name>/`)는 삭제하지 않음

## Phase 1: 앱 이름 변경 + `_meta.json` 인프라

### 1-A: `tauri.conf.json` 수정
- `productName`: `"claude-task-list"` → `"claude-task-list-app"`
- `identifier`: `"com.dan.claude-task-list"` → `"com.dan.claude-task-list-app"`

### 1-B: `_meta.json` 필터링
`lib.rs`의 `get_task_lists` (line 122-126)와 `get_tasks` (line 163-166)에서 `_meta.json`을 skip.

현재 skip 패턴:
```rust
if file_name == "0" || file_name == "999" { continue; }
```
→ `file_name == "_meta"` 조건 추가.

### 1-C: 헬퍼 함수 추가

```rust
fn read_project_dir(list_name: &str) -> Option<String>
fn write_project_dir(list_name: &str, project_dir: &str) -> Result<(), String>
fn workspace_dir(list_name: &str) -> PathBuf  // ~/claude-task-list/<list_name>
```

### Phase 1 E2E 검증 (Playwright mock 기반)
```
e2e-round10.spec.ts에 추가:

1. _meta.json이 포함된 mock 리스트 데이터 생성
2. get_task_lists 결과에서 _meta 태스크가 표시되지 않는지 확인
3. get_tasks 결과에서 _meta 태스크가 표시되지 않는지 확인
4. 리스트 카드의 total/completed 카운트에 _meta가 포함되지 않는지 확인
```

## Phase 2: `create_list` + `rename_list` 수정

### 2-A: `create_list` 수정
Named list 생성 시:
1. `~/.claude/tasks/<name>/` 디렉토리 생성 (기존)
2. `~/claude-task-list/<name>/` 워크스페이스 디렉토리 생성 (신규)
3. `_meta.json`에 `project_dir` 기록 (신규)
- UUID 이름인 경우 워크스페이스 생성 안 함 (기존 동작 유지)

### 2-B: `rename_list` 수정
- UUID→Named: `find_session_project_dir(old_name)`으로 디렉토리 캡처 → `_meta.json` 기록
- Named→Named: 기존 `_meta.json` 유지
- 디렉토리 정보가 없는 경우: `~/claude-task-list/<new_name>/` 새로 생성

### Phase 2 E2E 검증 (실제 파일시스템 + Playwright)
```
1. Playwright 테스트에서 실제 Tauri invoke로 create_list("E2E-Round10-Test") 호출
2. 파일시스템 확인: ~/.claude/tasks/E2E-Round10-Test/_meta.json 존재
3. _meta.json 내용 파싱: project_dir이 ~/claude-task-list/E2E-Round10-Test/ 인지 확인
4. 파일시스템 확인: ~/claude-task-list/E2E-Round10-Test/ 디렉토리 존재
5. UI에서 "+ New List" → 이름 입력 → 생성 후 동일 검증
6. Rename 테스트: UUID 형식 리스트를 rename → _meta.json에 project_dir 기록 확인
7. 테스트 후 정리: 생성한 디렉토리/파일 삭제
```

## Phase 3: `spawn_list` + `spawn_task` 수정

### 3-A: `spawn_list` 수정
Named list spawn 시:
1. `_meta.json`에서 `project_dir` 읽기
2. `project_dir`이 없으면 자동 재생성 (mkdir)
3. `cd "{project_dir}" && CLAUDE_CODE_TASK_LIST_ID={name} claude` 실행
4. `_meta.json`이 없는 경우 (레거시): 기존 동작 유지 (cd 없이 실행)

### 3-B: `spawn_task` 수정
개별 태스크 spawn에도 동일한 cd 로직 적용:
- resume 시: `cd "{project_dir}" && CLAUDE_CODE_TASK_LIST_ID={} claude --resume {}`
- 새 세션: `cd "{project_dir}" && CLAUDE_CODE_TASK_LIST_ID={} claude --session-id {} $'{}'`

### Phase 3 E2E 검증 (Playwright mock + 클립보드 검증)
```
spawn은 실제로 Warp 탭을 여는 사이드이펙트가 있으므로,
Tauri invoke mock으로 spawn_list/spawn_task 호출 시
전달되는 명령어 문자열을 캡처하여 검증한다.

1. spawn_list mock에서 호출된 인자 기록
2. Named list spawn 시 명령어에 cd "/Users/.../claude-task-list/<name>" 포함 확인
3. Named task spawn 시 동일 cd 포함 확인
4. Unnamed list spawn 시 기존 동작 (cd 없거나 JSONL 기반 cd) 확인
5. project_dir에 공백이 포함된 경우 따옴표 처리 확인
```

실제 spawn 동작 검증은 native E2E로 수행:
```
1. 테스트용 Named list 생성 (create_list)
2. 앱 UI에서 해당 리스트의 Spawn 버튼 클릭 (cliclick)
3. 새로 열린 터미널 탭에서 pwd 확인 또는 클립보드에 설정된 명령어 확인
4. 명령어에 cd "~/claude-task-list/<name>" 포함 확인
```

## 작업 방식

1. 코드 수정
2. `cargo tauri dev` 자동 리빌드 확인
3. E2E 테스트 실행: `npx playwright test e2e-round10.spec.ts`
4. 기존 E2E 테스트 통과 확인: `npx playwright test`
5. 실패 시 에러 기반 수정 반복
6. 이전 iteration 작업은 `git diff`로 확인

## 완료 조건

- [ ] `productName`이 `claude-task-list-app`으로 변경됨
- [ ] `_meta.json`이 `get_task_lists`, `get_tasks` 결과에 포함되지 않음
- [ ] Named list 생성 시 `~/claude-task-list/<name>/` 자동 생성 + `_meta.json` 기록
- [ ] UUID→Named rename 시 기존 프로젝트 디렉토리가 `_meta.json`에 보존됨
- [ ] Named list spawn 시 `cd "{project_dir}"` 포함된 명령어로 실행
- [ ] Named task spawn 시 `cd "{project_dir}"` 포함된 명령어로 실행
- [ ] 삭제된 `project_dir`은 spawn 시 자동 재생성
- [ ] Unnamed list spawn은 기존 동작 유지
- [ ] 리스트 삭제 시 `~/claude-task-list/<name>/`은 삭제되지 않음
- [ ] E2E 테스트 (`e2e-round10.spec.ts`) 전체 통과
- [ ] 기존 E2E 테스트 (`e2e-crud`, `e2e-phase3~5`) 깨지지 않음

위 완료 조건을 모두 충족했을 때만 completion promise를 출력하라.

## Stuck 대응

10 iteration 이후 미완료 시 .claude/ralph-stuck-round10.md에 기록
