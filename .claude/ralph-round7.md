# Task: 정렬 + Unnamed Divider + 리스트 우클릭 메뉴 (Round 7)

프로젝트 경로: /Users/dan/claude-task-list
기술 스택: Tauri v2 (Rust) + React 19 + TypeScript + Tailwind CSS 4
실행 방법: `cargo tauri dev` (cargo build 단독 사용 금지)
브랜드 컬러: #DA7756 (Claude Code 오렌지)

## Task 1: Last Updated 기반 정렬

### 1-A: Rust 백엔드
- TaskList 구조체에 `last_updated: u64` 필드 추가 (unix timestamp, 초 단위)
- get_task_lists에서 각 리스트 디렉토리 내 가장 최근 수정된 .json 파일의 mtime 조회
- `fs::metadata(path)?.modified()?` → SystemTime → unix timestamp 변환
- 빈 디렉토리면 디렉토리 자체의 mtime 사용

### 1-B: 프론트엔드 정렬
- 현재: 이름 알파벳순 (Rust에서 sort)
- 변경: 기본 정렬을 last_updated 내림차순 (최근이 위)으로 변경
- Named 탭, Unnamed 탭 모두 동일하게 적용
- Rust의 기존 `lists.sort_by(|a, b| a.name.cmp(&b.name))` 를
  `lists.sort_by(|a, b| b.last_updated.cmp(&a.last_updated))` 로 변경

### 1-C: 프론트엔드 TypeScript interface 업데이트
- TaskList interface에 `lastUpdated: number` 추가
- Rust의 snake_case → camelCase 매핑 확인 (serde rename 또는 프론트에서 처리)

## Task 2: Unnamed 세션 Divider

Unnamed 탭에서 태스크가 있는 세션과 빈 세션을 분리.

레이아웃:
```
┌──────────────────────────────────┐
│  Named        Unnamed            │
│                ━━━━━━━           │
├──────────────────────────────────┤
│  WITH TASKS                      │
│  b9b56d2b… (12/14)         🤖   │
│  dcb010ff… (10/12)         🤖   │
│  5e6305ae… (9/11)          🤖   │
│                                  │
│  ── EMPTY SESSIONS ──            │
│  170b0679… (0/0)                 │
│  20221941… (0/0)                 │
│  257b5b6a… (0/0)                 │
│  ...                             │
└──────────────────────────────────┘
```

구현:
- Unnamed 리스트를 `total > 0` 과 `total === 0` 으로 분리
- "WITH TASKS" 섹션: 상단에 배치, last_updated 내림차순 정렬
- "EMPTY SESSIONS" 섹션: 하단에 배치, divider로 구분
- 각 섹션에 section-header 텍스트 표시
- 빈 세션에는 Spawn 버튼 불필요 (태스크가 없으므로)

## Task 3: Screen 1 리스트 카드 우클릭 → 컨텍스트 메뉴

현재 리스트 카드는 클릭 시 Screen 2로 이동만 됨.
우클릭 시 컨텍스트 메뉴를 띄워서 Rename, Delete 등 바로 접근 가능하게.

구현:
- 리스트 카드에 onContextMenu 핸들러 추가
- showContextMenu 호출로 커스텀 컨텍스트 메뉴 표시
- 메뉴 항목:
  - "Rename" — 리스트 이름 변경 (프롬프트/인라인 입력)
  - "Delete" (danger) — 리스트 삭제
- 기존 Screen 2의 ⋯ 메뉴와 동일한 기능
- Named/Unnamed 탭 모두에서 동작

Rename UI (Screen 1에서):
- 컨텍스트 메뉴에서 "Rename" 클릭 시 → 카드의 이름 부분이 input으로 변환
- 또는 간단하게 window.prompt() 사용 (Tauri WebView에서 동작 확인 필요)
- Enter로 확정, rename_list invoke 호출

## 검증 방법

각 기능별로 실제 앱에서 동작 확인:

1. `cargo tauri dev`로 앱 실행
2. cliclick으로 tray icon 클릭하여 창 열기
3. screencapture로 화면 캡처 후 이미지 확인

### 검증 시나리오

#### 정렬
- Named 탭: 최근 수정된 리스트가 상단에 표시되는지 screencapture로 확인
- 파일 하나를 touch로 수정 후 리스트 순서가 바뀌는지 확인

#### Unnamed Divider
- Unnamed 탭에서 "WITH TASKS" / "EMPTY SESSIONS" 섹션이 나뉘는지 확인
- 태스크 있는 세션이 상단, 빈 세션이 하단인지 확인

#### 우클릭 메뉴
- 리스트 카드 위에서 cliclick으로 우클릭 → 컨텍스트 메뉴 표시 확인
- Rename, Delete 메뉴 항목 확인

#### Playwright
- 기존 E2E 테스트 통과 (변경사항 반영)
- 새 테스트 추가: 탭 전환, 우클릭 메뉴

## 작업 방식

1. 코드 수정
2. cargo tauri dev 자동 리빌드
3. screencapture + Playwright로 검증
4. 실패 시 수정 반복

## 검증 기준

- [ ] Named/Unnamed 탭 모두 last_updated 내림차순 정렬
- [ ] TaskList 구조체에 last_updated 필드 존재
- [ ] Unnamed 탭: "WITH TASKS" / "EMPTY SESSIONS" divider
- [ ] 빈 세션이 하단에 표시
- [ ] 리스트 카드 우클릭 → Rename + Delete 컨텍스트 메뉴
- [ ] Rename 동작 (이름 변경 후 리스트 갱신)
- [ ] Delete 동작 (삭제 후 리스트 갱신)
- [ ] 기존 E2E 테스트 통과
- [ ] screencapture 시각적 확인

## 완료 조건
위 검증 기준을 모두 충족했을 때만 completion promise를 출력하라.
