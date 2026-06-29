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
- 털기는 **시간 버티기가 아니라 작업표시줄 근처 스트립 안에서의 실시간 술래잡기**입니다.
  - **서리자**: 익은 작물을 **직접 클릭**해 털어요(작물 1개당 N번 클릭, N은 방어자 허수아비 − 내 낫 레벨).
    동시에 화면에 뜨는 **방어자 커서(고스트 + 빨간 위험원)를 피해야** 합니다.
  - **방어자**: 빨개진 스트립에 뜨는 **서리자 커서(고스트 + 초록 조준원, 옆에 침입자 닉네임)를 직접 클릭**해
    M번 맞히면 쫓아냅니다(M은 서리자 낫 − 내 허수아비 레벨).
  - 끝나면(쫓겨남/시간초과/싹쓸이/자진 도주) 서리자는 **턴 만큼 코인 유지**, 5분 쿨다운, 쪽지 한 줄.
- 털리는 동안에만 **양쪽 커서**가 서로의 화면에 고스트로 보입니다(평상시 전송 안 함, raid 중 10Hz).
- 공격력=**낫**, 방어력=**허수아비** 레벨로 결정. 레벨은 무한이지만 ln 점근(상한 존재).
- **마을 채팅**: 모든 접속자가 함께 쓰는 단일 공개 채팅방(`채팅` 버튼, 최근 N개만 표시).
- **골드 랭킹**: 나 + 친구들의 코인 순위(`랭킹` 버튼).

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
밭당 도둑 1명(트랜잭션), 온라인·친구 대상만 raid, 잠금 보유자만 피해자 밭 쓰기 + 도둑커서(raiderCursor)
송출, 주인만 자기커서(ownerCursor) 송출, 쿨다운 서버시각, 채팅은 본인 uid·길이 검증(작성자만 삭제),
수치/문자열 범위. 강제 못 하는 것: 클릭당 코인 환산, 코인 증감의 정당성(절대값 범위만 제한). 친구끼리
즐기는 게임 전제의 합리적 절충이며, 완전한 안티치트는 Functions(Blaze)가 필요합니다.

## 에셋 & 디자인

- 모든 픽셀아트는 오리지널(스타듀밸리 등 외부 스프라이트 미복제). 작물 스프라이트는
  `src/render/sprites.ts`의 팔레트-인덱스 그리드로 손수 제작했고 캔버스에 렌더됩니다.
  작물은 **세로형**으로 얇은 흙선(~3px) 위에 솟아오르며, 티어는 색이 아니라 **실루엣**으로 구분
  (무=낮고 둥글게, 밀=가늘고 높게, 호박=넓고 납작하게).
- 폰트는 **MulmaruMono**(`src/assets/MulmaruMono.ttf`) — DOM과 캔버스 양쪽에서 사용.
- 평상시 스트립은 **작물만** 보이는 얇은 띠고, **마우스를 올리면 HUD가 위로 롤업**되어
  코인 + 상점/친구/쪽지/꾸미기/설정 버튼이 나타납니다(작업표시줄 공간 점유 최소화 + 클릭통과 유지).
