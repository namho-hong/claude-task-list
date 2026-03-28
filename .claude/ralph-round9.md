# Task: 앱 아이콘이 검은색으로 빌드되는 문제 수정 (Round 9)

프로젝트 경로: /Users/dan/claude-task-list

## 증상

- src-tauri/icons/icon.png는 오렌지색 (#DA7756) 배경 + 검은 체크마크
- src-tauri/icons/icon.icns도 오렌지색으로 확인됨
- 하지만 `npx tauri build`로 빌드한 DMG/앱의 아이콘이 검은색으로 표시됨
- macOS 아이콘 캐시 문제가 아님 — 버전을 바꿔도 여전히 검은색

## 디버깅 절차

1. 빌드된 .app 번들 내부의 실제 아이콘 파일 확인
   - /src-tauri/target/release/bundle/macos/claude-task-list.app/Contents/Resources/
   - 어떤 아이콘 파일이 포함되어 있는지 확인
   - Info.plist에서 어떤 아이콘 파일을 참조하는지 확인

2. Tauri 빌드 과정에서 아이콘이 어떻게 처리되는지 확인
   - tauri.conf.json의 bundle.icon 설정 확인
   - Tauri가 빌드 시 아이콘을 자체적으로 변환하는지 확인
   - 빌드 로그에서 아이콘 관련 처리 확인

3. DMG 내부의 .app에서 실제로 사용되는 아이콘 추출 + 시각적 확인
   - DMG 마운트 → .app/Contents/Resources/icon.icns 추출
   - sips로 PNG 변환 후 확인
   - 만약 여기서도 오렌지면 macOS 렌더링 문제
   - 만약 여기서 검은색이면 빌드 파이프라인 문제

4. 아이콘 파일을 직접 교체한 후 재빌드
   - 확실하게 오렌지색인 PNG를 모든 사이즈로 생성
   - icon.icns를 새로 생성
   - 모든 아이콘 파일 교체 후 빌드

## 검증 방법

1. `npx tauri build` 실행
2. 빌드된 DMG를 마운트
3. DMG 안의 앱 아이콘을 screencapture로 캡처
4. 캡처한 이미지에서 오렌지색이 보이는지 확인
5. Finder에서 .app 파일의 아이콘 미리보기도 확인

## 완료 조건
빌드된 DMG/앱의 아이콘이 실제 화면에서 오렌지색으로 보일 때만 completion promise 출력.
