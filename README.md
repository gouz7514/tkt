# tkt

터미널에서 카카오톡 채팅방 하나를 주고받는 TUI.

카카오톡 전체를 옮기려는 게 아니라, **한 채팅방의 텍스트 송수신만** 한다.
읽기·전송 모두 macOS 접근성 API로 카카오톡 앱을 직접 다루며,
**카카오톡 창을 앞으로 끌어올리지 않는다** — 다른 앱에서 일하는 중에도 창이 튀어나오지 않는다.

```
 개발팀                                                    대기 중
╭──────────────────────────────────────────────────────────────╮
│ 18:12 상대   배포 언제 하나요?                                │
│ 18:14 나     지금 올릴게요                                    │
╰──────────────────────────────────────────────────────────────╯
 > 메시지를 입력하고 Enter
 Tab 채팅방 전환 · Esc 종료
```

## 준비물

| 항목 | 이유 |
|---|---|
| macOS 13 이상 | 카카오톡 Mac 앱과 접근성 API |
| Xcode Command Line Tools | `swiftc` 로 네이티브 헬퍼를 빌드한다 (`xcode-select --install`) |
| [카카오톡 Mac 앱](https://apps.apple.com/kr/app/kakaotalk/id869223134?mt=12) | 로그인된 상태여야 한다 |
| Node 20 이상 + corepack | yarn 4 는 corepack 이 자동으로 받아온다 (`corepack enable`) |
| [kmsg](https://github.com/channprj/kmsg) | 최초 설정의 채팅방 목록 조회, 채팅창이 닫혔을 때 재열기<br>`brew install channprj/tap/kmsg` |

**터미널 앱에 손쉬운 사용(Accessibility) 권한**이 필요하다.
시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 쓰는 터미널 앱을 추가한다.

카카오톡 UI 가 한국어 또는 영어라고 가정한다. 다른 언어에서는
`native/tkt-ax.swift` 의 `chatListWindowTitles`, `sendButtonTitles` 를 고쳐야 한다.

## 실행

```bash
corepack enable
yarn install
yarn dev
```

첫 실행에서 대상 채팅방을 고른다. 다시 고르려면 `yarn dev setup`.
설정은 `~/.config/tkt/config.json` 에 저장된다.

`yarn dev` 는 매번 네이티브 헬퍼(`native/tkt-ax`)를 먼저 컴파일한다. 2초쯤 걸린다.

## 쓰는 법

| 키 | 동작 |
|---|---|
| `Enter` | 전송 |
| `Tab` | 채팅방 전환 (열려 있는 카카오톡 채팅창 중에서) |
| `Esc` | 종료 |

## 알아둘 것

- **대상 채팅방의 카카오톡 창이 열려 있어야 한다.** 최소화하지 말고 뒤에 두거나 다른
  화면에 둔다. 닫혀 있으면 kmsg 로 한 번 다시 여는데, 이때만 카카오톡이 앞으로 나오고
  십수 초 걸린다.
- **`Tab` 전환은 이미 열려 있는 창들 사이에서만 된다.** 다른 방으로 가려면 카카오톡에서
  먼저 열어둔다.
- **tkt 는 하나만 띄운다.** 여러 개가 동시에 접근성 API를 두드리면 서로 막혀서 몇십 초씩
  걸리거나 실패한다.
- 텍스트만 다룬다. 사진·이모티콘은 `[사진]` 으로만 보인다.
- 카카오톡이 공식으로 허용한 방식이 아니다. 개인 용도로 쓰고, 계정 관련 위험은 각자 판단한다.

## 구조

```
src/kakao.ts      카카오톡 연동 계층 (모든 호출을 직렬화)
src/app.tsx       Ink TUI — 폴링 루프, 채팅방 전환
src/cli.tsx       진입점, 최초 설정
native/tkt-ax.swift   접근성 API 헬퍼 — read / send / windows
```

읽기는 `AXScrollArea → AXTable → AXRow` 를 직접 순회한다.
전송은 입력창의 `AXSelectedText` 를 치환하고 「전송」 버튼을 `AXPress` 한다 —
키 이벤트를 쓰지 않아서 창을 앞으로 올릴 필요가 없다.
왜 이 방식이어야 하는지는 `native/tkt-ax.swift` 의 주석에 적어뒀다.
