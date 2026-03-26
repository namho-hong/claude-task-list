# Task: Named/Unnamed 탭 + Rename 기능 (Round 6)

프로젝트 경로: /Users/dan/claude-task-list
기술 스택: Tauri v2 (Rust) + React 19 + TypeScript + Tailwind CSS 4
실행 방법: `cargo tauri dev` (cargo build 단독 사용 금지)
브랜드 컬러: #DA7756 (Claude Code 오렌지)

## 배경

현재 get_task_lists에서 UUID 형식 디렉토리는 필터링하고 있음 (is_uuid 함수).
Unnamed(UUID) 리스트도 볼 수 있도록 탭 시스템을 추가.

## Phase 1: Rust 백엔드 수정

### 1-A: get_task_lists 수정
- UUID 디렉토리를 필터링하지 않고 전부 반환
- TaskList 구조체에 `is_named: bool` 필드 추가 (UUID가 아니면 named)
- 또는 프론트엔드에서 UUID 판별해도 됨

### 1-B: rename_list 커맨드 추가
- `rename_list(old_name: String, new_name: String) -> Result<(), String>`
- `~/.claude/tasks/{old_name}` 디렉토리를 `~/.claude/tasks/{new_name}`으로 rename
- new_name에 공백 포함 시 하이픈으로 치환
- 이미 존재하는 이름이면 에러 반환
- invoke_handler에 등록

## Phase 2: 프론트엔드 탭 시스템

### 2-A: Screen 1 탭 UI
헤더 아래, 리스트 위에 탭 바 추가:

```
┌──────────────────────────────────┐
│ 🤖 Claude Task List          ⚙  │
├──────────────────────────────────┤
│  Named        Unnamed            │
│  ━━━━━                           │
├──────────────────────────────────┤
│  (리스트 카드들...)               │
└──────────────────────────────────┘
```

구현:
- `activeTab` state: "named" | "unnamed"
- 탭 클릭 시 전환
- 활성 탭에 밑줄(underline) 표시
- 탭 바는 헤더와 divider 사이에 배치

### 2-B: Named 탭
- 기존과 동일: 이름이 UUID가 아닌 리스트만 표시
- 카드: 이름 (진척률) + hover 시 Clawd Spawn 버튼
- "+ New List" 버튼 하단에 표시

### 2-C: Unnamed 탭
- UUID 형식 이름을 가진 리스트만 표시
- UUID 표시: 화면 너비에 맞게 적절히 축약 (앞 8자리 + "..." 등 — 렌더링 보고 판단)
- 카드: UUID (진척률) + hover 시 Clawd Spawn 버튼
- "+ New List" 버튼 없음

### 2-D: UUID 판별
프론트엔드에서 is_uuid 판별 (Rust의 is_uuid와 동일 로직):
- 8-4-4-4-12 hex 패턴
- `const isUuid = (name: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)`

## Phase 3: Rename 기능

### 3-A: Screen 2 ⋯ 메뉴에 "Rename" 추가
- Unnamed 리스트의 Screen 2 진입 시 ⋯ 메뉴에 "Rename" 옵션 추가
- Named 리스트에도 Rename 있어도 됨 (이름 변경)
- "Delete List" 옵션은 유지

### 3-B: Rename UI
- "Rename" 클릭 시 → 헤더의 리스트 이름 부분이 input으로 변환
- Enter로 확정, Escape로 취소
- 공백 → 하이픈 자동 치환
- rename_list invoke 호출 후 loadLists + screen 업데이트 (새 이름으로)

## Phase 4: 커밋 전 정리

- 기존 E2E 테스트가 UUID 필터링에 의존하면 업데이트
- 새 탭 관련 E2E 테스트 추가
- screencapture로 Named 탭, Unnamed 탭 각각 확인

## 작업 방식

1. 코드 수정
2. cargo tauri dev 자동 리빌드
3. Playwright + screencapture 검증
4. 실패 시 수정 반복
5. 이전 iteration 작업은 git diff로 확인

## 검증 기준

- [ ] Named 탭: 기존처럼 이름 있는 리스트만 표시
- [ ] Unnamed 탭: UUID 리스트 표시 (적절히 축약)
- [ ] 탭 전환이 정상 동작
- [ ] Unnamed 리스트에도 Clawd Spawn 버튼 (hover)
- [ ] Unnamed 탭에 "+ New List" 없음
- [ ] ⋯ → Rename 클릭 → 이름 입력 → 디렉토리 rename 성공
- [ ] Rename 후 Named 탭으로 이동 + 리스트 갱신
- [ ] rename_list Rust 커맨드 동작
- [ ] 기존 E2E 테스트 통과
- [ ] screencapture 시각적 확인

## Stuck 대응

10 iteration 이후 미완료 시 .claude/ralph-stuck.md에 기록

## 완료 조건
위 검증 기준을 모두 충족했을 때만 completion promise를 출력하라.
