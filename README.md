# suhree 🌱

작업표시줄 바로 위에서 작물을 키우는 아기자기한 도트 데스크탑 펫. 핵심은 **온라인인 친구의 밭만 몰래 털 수 있는** 실시간 잠입 PvP.

- **클라이언트**: Tauri v2 + Rust(창/OS 레이어) + webview(vanilla TS, 모든 Firebase + 게임 로직)
- **백엔드**: Firebase Realtime Database (Spark 무료 티어, Cloud Functions 미사용)
- **신원**: Firebase 익명 인증 + 닉네임 + 친구코드 (비밀번호 없음)

## 사전 준비

1. Node 18+, Rust(stable), 그리고 Windows에 **WebView2 런타임** (Win11 기본 포함).
2. Firebase 콘솔에서 `suhree` 프로젝트의 Realtime Database가 **asia-southeast1** 리전에 생성되어 있어야 합니다.
   URL: `https://suhree-default-rtdb.asia-southeast1.firebasedatabase.app`
3. **익명 인증 활성화**: Firebase 콘솔 → Authentication → Sign-in method → **익명** 사용 설정.
4. **보안 규칙 배포**: `database.rules.json` 내용을 콘솔 → Realtime Database → 규칙 에 붙여넣고 게시.
   (또는 `firebase deploy --only database` — firebase-tools 사용 시.)

## 실행

```bash
npm install
npm run tauri:dev      # Tauri 데스크탑 앱 (스트립 오버레이)
```

UI만 빠르게 보고 싶다면 (창 위치/클릭통과 없이 일반 브라우저에서):

```bash
npm run dev            # http://localhost:1420
```

빌드:

```bash
npm run tauri:build    # 설치 파일/실행 파일 생성
```

## 동작 개요

- 실행 = RTDB 연결 = 온라인. 종료/네트워크 끊김 시 `onDisconnect`로 자동 오프라인.
- 빈 밭 칸 클릭 → 씨앗 심기(툴바 `씨` 버튼으로 종류 선택). 익은 작물 클릭 → 100% 수확.
- 친구 패널에서 **온라인 친구**만 `털기` 가능. 트랜잭션으로 밭당 도둑 1명만 잠금.
- 털기 시작 → 대상 스트립이 빨개지고 알림음 + "침입자!" + `쫓아내기` 버튼.
  - 대상이 T초 안에 쫓아내면 실패 + 도둑 5분 쿨다운(작물 유지).
  - T초 버티면 익은 작물의 50%를 훔치고(나머지 50% 증발) 쪽지 한 줄 남기고 도주. 5분 쿨다운.
- 털리는 30초 동안에만 **밭 주인의 커서**가 도둑 화면에 고스트로 보임(평상시 전송 안 함).
- 허수아비(방어)는 T를 늘리고, 낫(공격)은 T를 줄임. 레벨은 무한이지만 ln 점근(상한 존재).

## 튜닝

밸런스 수치는 전부 `src/config/balance.ts` 한 곳에 모여 있습니다(작물 티어, T 공식 상수,
쿨다운, 커서 Hz, 가격, 점근 상수). 작물 티어는 더미 3종이며 성장시간·가격·수확가치를 쉽게 조정할 수 있습니다.

## 구조

```
src-tauri/src/          Rust: 창 위치(작업표시줄/멀티모니터/DPI), 부분 click-through, 전체화면 숨김
  window/geometry.rs     SHAppBarMessage + EnumDisplayMonitors + GetDpiForMonitor → 물리px 스트립 rect
  clickthrough/hit_test  60Hz GetCursorPos 폴링 → set_ignore_cursor_events 토글
  fullscreen/mod.rs      SHQueryUserNotificationState OR foreground-rect 비교 → 숨김
src/                    webview: firebase/ · game/ · raid/ · friends/ · render/ · config/
database.rules.json     RTDB 보안 규칙 (raid-잠금-쓰기 트릭 + 쿨다운 + sanity 범위)
```

## Spark 티어에서의 한계 (정직하게)

Cloud Functions가 없으므로 일부 경제 로직은 **클라이언트 신뢰**입니다. 보안 규칙이 강제하는 것:
밭당 도둑 1명(트랜잭션), 온라인·친구 대상만 raid, 잠금 보유자만 피해자 밭 쓰기, 커서 송출은
주인+raid중에만, 쿨다운 서버시각, 수치/문자열 범위. 강제 못 하는 것: 정확한 50% 계산, 코인 증감의
정당성(절대값 범위만 제한). 친구끼리 즐기는 게임 전제의 합리적 절충이며, 완전한 안티치트는 Functions(Blaze)가 필요합니다.

## 에셋 & 디자인

- 모든 픽셀아트는 오리지널(스타듀밸리 등 외부 스프라이트 미복제). 작물 스프라이트는
  `src/render/sprites.ts`의 팔레트-인덱스 그리드로 손수 제작했고 캔버스에 렌더됩니다.
  작물은 **세로형**으로 얇은 흙선(~3px) 위에 솟아오르며, 티어는 색이 아니라 **실루엣**으로 구분
  (무=낮고 둥글게, 밀=가늘고 높게, 호박=넓고 납작하게).
- 폰트는 **MulmaruMono**(`src/assets/MulmaruMono.ttf`) — DOM과 캔버스 양쪽에서 사용.
- 평상시 스트립은 **작물만** 보이는 얇은 띠고, **마우스를 올리면 HUD가 위로 롤업**되어
  코인 + 상점/친구/쪽지/꾸미기/설정 버튼이 나타납니다(작업표시줄 공간 점유 최소화 + 클릭통과 유지).
