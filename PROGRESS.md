# Progress — Menubar Fixes

## Iteration
현재: 5 / 30

## 완료
- [x] Phase 1: 창 위치 — tray icon rect 기반 window positioning
- [x] Phase 1: 클릭 로직 — 좌클릭 토글, 우클릭 Quit 메뉴, race condition 해결 (AtomicBool toggling)
- [x] Phase 2: 포커스 해제 자동 닫힘 — WindowEvent::Focused(false) + grace period 500ms
- [x] Phase 3: 글래스모피즘 — windowEffects hudWindow (네이티브 macOS vibrancy)
- [x] E2E: 7/7 테스트 통과 (tray click, positioning, close, right-click, focus loss, race condition, glassmorphism screenshot)
- [x] cargo build 성공
- [x] 기존 기능 정상 동작

## 실패한 접근법 (재시도 금지)
- Image::from_path → Tauri v2에 없음
- CSS backdrop-filter + rgba → 뒤가 너무 보임, 네이티브 windowEffects로 교체
- macOSPrivateApi를 최상위에 배치 → app 섹션 하위에 배치해야 함
- System Events로 tray app을 frontmost 설정 → background-only app이라 불가

## 다음 작업
- 모든 완료 조건 충족됨 → ALL_MENUBAR_FIXES_VERIFIED
