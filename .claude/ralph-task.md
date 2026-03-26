# Task: Claude Task List 메뉴바 앱 수정 (Tauri v2 + React)

프로젝트 경로: /Users/dan/claude-task-list

## Phase 1: 창 위치 및 클릭 로직 정리
1. 좌클릭 시 tray icon 바로 아래에 팝업 창이 열리도록 위치 계산 구현
   - tray icon의 screen 좌표를 기반으로 window position 설정
   - 창이 메뉴바에 딱 붙어서 열려야 함
2. 클릭 로직 race condition 해결
   - 좌클릭: 팝업 토글 (열기/닫기)만 담당
   - 우클릭: Quit 메뉴 표시
   - 좌클릭과 우클릭 간 간섭 제거, 일관된 동작 보장

## Phase 2: 포커스 해제 시 자동 닫힘
- 창이 포커스를 잃으면 자동으로 숨김 처리
- Tauri window의 blur/focus-lost 이벤트 활용
- tray icon 클릭으로 다시 열 수 있어야 함

## Phase 3: 글래스모피즘 제대로 구현
- 현재 CSS backdrop-filter + rgba opacity 방식은 뒤가 너무 보임
- 웹 리서치를 통해 Tauri v2에서 macOS 네이티브 vibrancy 또는 적절한 글래스모피즘 구현 방법을 조사
- NSVisualEffectView, window_vibrancy crate, 또는 Tauri의 built-in vibrancy 옵션 등을 검토
- 뒤의 앱 글자가 읽히지 않을 정도의 적절한 blur 수준 적용
- 리서치 결과에 따라 최적의 방법으로 구현

## 검증 방법

### E2E 테스트 (Playwright + macOS Accessibility)
스크립트 단위 테스트가 아닌, 실제 유저와 동일한 레벨의 인터페이스 테스트를 작성하라.
프로젝트에 이미 Playwright(1.58.2)가 설치되어 있다.

1. **네이티브 tray 동작 검증**
   - macOS Accessibility API 또는 AppleScript(`osascript`)를 활용하여 실제 tray icon에 좌클릭/우클릭 이벤트를 보내고 결과를 확인
   - 좌클릭 -> 창이 tray icon 바로 아래 위치에 열림 (좌표 검증)
   - 좌클릭 다시 -> 창 닫힘
   - 우클릭 -> Quit 메뉴만 표시
   - 좌/우클릭 연속 시 race condition 없음

2. **포커스 해제 검증**
   - 다른 앱 활성화 또는 데스크탑 클릭 시뮬레이션
   - 창이 자동으로 닫히는지 확인

3. **WebView UI 검증 (Playwright)**
   - 앱을 실행한 상태에서 Playwright로 WebView에 연결
   - 태스크 CRUD, 상태 변경, spawn 버튼 등 기존 기능 정상 동작 확인

4. **글래스모피즘 시각 검증**
   - 스크린샷 캡처 후 배경 앱의 텍스트가 읽히지 않는 수준인지 확인
   - 이전/이후 스크린샷 비교

### 빌드 검증
- 매 iteration마다 `cargo build` 성공 확인

## 완료 조건
- 모든 E2E 테스트 통과
- 빌드 성공
- 기존 기능 정상 동작
위 조건을 모두 충족했을 때만 completion promise를 출력하라.
하나라도 미충족이면 다음 iteration에서 계속 수정하라.
