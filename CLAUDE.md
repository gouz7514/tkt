# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

tkt (terminal kakao talk) — macOS Accessibility API로 카카오톡 Mac 앱의 UI를 직접 읽고 조작하는
Ink 기반 TUI. 카카오톡 공식 API를 쓰지 않으며 macOS + 카카오톡 Mac 앱에서만 동작한다.

## 명령어

```bash
npm run dev          # build:native 후 tsx 로 src/cli.tsx 실행 (개발 기본 경로)
npm run build        # build:native 후 tsc → dist/
npm run start        # build:native 후 node dist/cli.js
npm run build:native # swiftc -O native/tkt-ax.swift -o native/tkt-ax
npm run doctor       # 시작이 막힐 때 단계별 진단 (scripts/doctor.sh)
```

```bash
./native/tkt-ax check              # {"trusted":bool,"kakaoRunning":bool}
./native/tkt-ax windows            # 열려 있는 채팅창 제목 JSON
./native/tkt-ax read <채팅방> [개수]
./native/tkt-ax send <채팅방> <메시지>
./native/tkt-ax open <채팅방>       # 닫힌 방을 채팅 목록에서 찾아 연다
```

`src/*.ts(x)` 를 고쳤다면 `npm run dev` 만으로 반영되지만, `native/tkt-ax.swift` 를 고쳤다면
반드시 재빌드해야 한다 (`npm run dev` 는 매번 재빌드하므로 그대로 쓰면 된다).

## 아키텍처

세 계층이 한 방향으로 쌓인다:

1. **`native/tkt-ax.swift`** — AX 트리를 직접 다루는 단발성 CLI. 명령마다 프로세스를 새로 띄우고
   JSON 한 줄을 stdout 으로 뱉은 뒤 `exit` 한다. 상태를 들고 있지 않다.
2. **`src/kakao.ts`** — 헬퍼를 `execFile` 로 감싼 유일한 지점. 여기서 직렬화·재시도·진단을 처리한다.
3. **`src/app.tsx`** — Ink UI. 폴링 루프 하나가 `readMessages` 를 반복 호출한다.

`src/cli.tsx` 는 진입점으로, 준비 상태 확인(`missingTools`) → 설정 로드/`setup` → `render(<App/>)` 순이다.

### 채팅방은 "창 제목"으로 식별된다

chat_id 같은 안정적인 키가 없다. `config.json` 의 `displayName` 이 곧 카카오톡 창 제목이며,
읽기·전송·열기 모두 이 문자열로 창을 찾는다. `matchChatWindow` 는 **정확 일치 우선, 부분 일치는
후보가 하나일 때만** 채택한다

### 헬퍼 호출은 반드시 직렬

`kakao.ts` 의 `serialize()` 큐가 read/send/open 을 한 줄로 세운다. 두 호출이 겹치면 같은 AX 트리를
동시에 건드려 서로를 망친다. 예외는 `listOpenChats()` — 창 제목만 훑는 가벼운 조회라 큐를 타지
않는다. 큐에 넣으면 읽기가 도는 동안 Tab(채팅방 전환)이 먹지 않는다.

### 전송 경로는 두 가지, 기본은 키 이벤트 없는 경로

`sendWithoutKeyboard` 가 기본이다. `AXSelectedTextRange` 로 기존 입력 내용을 통째로 선택한 뒤
`AXSelectedText` 로 치환하고 「전송」 버튼을 `AXPress` 한다. 이 경로는 카카오톡 창을 앞으로
끌어올리지 않는다 — 이 도구의 존재 이유다.

- `AXValue` 를 직접 세팅하면 안 된다. 카카오톡 내부 텍스트 모델이 그 값을 모르고 전송이 무시된다.
- 「전송」 버튼은 **본문을 넣은 뒤에** 찾아야 한다. 입력창이 비어 있으면 버튼이 그려지지 않을 수 있다.
- 버튼은 아이콘이라 `AXTitle` 이 비어 있을 수 있으니 `AXDescription` 까지 본다 (`buttonLabels`).
- `AXPress` 의 반환값은 신뢰할 수 없다. **입력창이 비워졌는지**로 성공을 판정한다.
- 실패 시에만 키보드 fallback(`CGEvent.postToPid`)으로 떨어지며, 이 경로는 창을 앞으로 올린다.

### 읽기의 휴리스틱

`runRead` 는 대화 영역(AXTable을 가진 AXScrollArea)의 행을 훑는다:

- **내가 보낸 메시지 판정**: 말풍선 프레임의 `maxX` 가 테이블 오른쪽 끝에서 40pt 이내면 내 것.
- **시각 상속**: 카카오톡은 같은 분에 연속된 메시지의 마지막 행에만 시각을 표시하므로,
  뒤에서 앞으로 훑으며 빈 시각을 채운다.
- 본문 없이 AXImage 만 있는 행은 `[사진]` / `[사진 N장]`, 그 외(날짜 구분선 등)는 버린다.

### AX 트리 순회 시 대화 영역은 반드시 건너뛴다

`findInputField` / `findSendButton` 은 `isTranscriptArea()` 로 대화 영역을 잘라낸다. 말풍선도
`AXTextArea` 라서 수백 개를 훑게 되고, 그러면 전송 한 번에 20초가 걸린다. 새 탐색 함수를 추가할
때도 같은 가드를 넣을 것.

### 창 상태 판별의 함정

최소화하거나 앱을 숨기면(Cmd+H) 창의 subrole 이 `AXStandardWindow` → `AXDialog` 로 바뀌지만 AX
트리는 살아 있어 읽기·전송이 모두 된다. `chatWindows()` 가 최소화·숨김 상태의 `AXDialog` 를
채팅창으로 인정하는 이유다. 이걸 걸러내면 최소화한 창을 "닫힌 방"으로 오해해 `open` 이 돌고,
사용자가 내려둔 창이 도로 튀어나온다.

또한 헬퍼의 "모호한 이름" 오류 문구에는 `kakao.ts` 의 `WINDOW_CLOSED` 표식(`'열려 있지 않습니다'`)이
들어가면 안 된다. 들어가면 닫힌 창으로 오해해 `open` 을 태우고 아무 방이나 열게 된다.

### UI 폴링 루프의 제약

`app.tsx` 의 폴링 이펙트에서 `active` 플래그는 **반드시 이펙트 안의 지역 변수**여야 한다. ref 로
공유하면 방 전환 시 이전 루프가 죽지 않고 두 루프가 번갈아 `setRows` 를 호출해 화면이 두 채팅방을
오간다. `wake` ref 는 전송 직후 폴링을 즉시 깨우는 신호다.

## 로케일 의존

카카오톡 UI 언어에 묶인 문자열이 `native/tkt-ax.swift` 상단에 모여 있다:
`chatListWindowTitles`(채팅 목록 창 제목), `sendButtonTitles`(전송 버튼), `pressWindowMenuItem`에
넘기는 `["채팅", "Chats"]`. 한국어·영어만 지원하며 다른 언어 대응은 여기를 고친다.

## 설정

`config.json` 은 프로젝트 루트에 있고 **gitignore 대상**이다 (대상 채팅방 이름이 들어간다).
`src/config.ts`, `src/kakao.ts` 모두 `import.meta.url` 기준 `../` 로 경로를 잡는데, `src/` 와
`dist/` 가 똑같이 루트 한 단계 아래라 개발·빌드 양쪽에서 같은 곳을 가리킨다. 이 구조를 깨는
디렉터리 이동은 두 파일의 경로 계산을 함께 고쳐야 한다.

## 사용자 대상 문구

에러 메시지, 주석, README 모두 한국어다. 특히 `kakao.ts` 의 `missingTools()` 는 접근성 권한이
없을 때의 안내를 여러 줄로 돌려주며 `cli.tsx` 가 들여쓰기해 출력한다. 새 안내를 추가할 때 이
형식을 유지할 것.
