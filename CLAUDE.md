# Claude Task List

macOS 메뉴바 네이티브 앱. Claude Code의 태스크 관리 시스템(`~/.claude/tasks/`)을 GUI로 제공한다.

## 제품 요약

- 메뉴바 아이콘 클릭으로 태스크 현황 확인 및 관리
- 태스크별 Claude Code 세션 spawn/resume
- `~/.claude/tasks/` 파일 감시로 CLI 변경사항 실시간 반영

## 기술 스택

- **Frontend:** React 19 + TypeScript + Tailwind CSS 4 (Vite 7)
- **Desktop:** Tauri v2 (Rust 백엔드 + WebView)
- **데이터:** JSON 파일 기반 (`~/.claude/tasks/<list-name>/<id>.json`), DB 없음
- **테스트:** Playwright E2E

## 프로젝트 구조

```
src/App.tsx           — React 메인 컴포넌트 (듀얼 스크린 UI)
src/App.css           — Tailwind + 커스텀 스타일
src-tauri/src/lib.rs  — Rust 커맨드, 파일 감시, 시스템 트레이, 세션 spawn
src-tauri/tauri.conf.json — 윈도우 설정 (380x520, transparent, hudWindow)
```

## 핵심 개념

- **Named 리스트:** 사용자 지정 이름의 영구 리스트
- **Unnamed 리스트:** UUID 기반 임시 세션 리스트
- **Guard task:** id 0, 999는 리스트 구조 보존용 예약 태스크 (UI에서 제외)
- **프로젝트 디렉토리 바인딩:** `_meta.json`에 저장, spawn 시 해당 디렉토리로 cd
- **세션 Resume:** 태스크 metadata.session_id로 중단된 세션 이어가기

## 개발

```bash
npm run tauri dev    # 개발 서버 + Tauri 앱 실행
npm run tauri build  # 프로덕션 빌드
npx playwright test  # E2E 테스트
```

## 컨벤션

- 다크 모드 전용 UI (glassmorphism/hudWindow 효과)
- 터미널 지원: iTerm2, Terminal.app, Warp
- Spawn 시 osascript(macOS) 사용
- 파일 감시 debounce: 300ms
