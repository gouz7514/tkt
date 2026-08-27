# tkt (terminal kakao talk)

터미널에서 카톡을 주고받을 수 있는 TUI (Text User Interface)

![tkt example image](https://github.com/user-attachments/assets/b638804a-516a-4752-8996-9f59d8e8d857)

> ❗중요❗
> - 개인 환경에서만 테스트를 진행했어요. 다른 환경에서는 의도와 다르게 동작할 수 있어요
> - 카카오톡 UI의 변경에 따라 동작하지 않을 수 있어요
> - 카카오가 공식으로 허용한 방식이 아니니 사용 방식에 따라 카카오 이용약관 또는 운영정책 위반으로 해석될 수 있어요
> - 맥북에서만 가능해요

## 시작하기 전에
### 필요사항

| 항목 | 이유 |
|---|---|
| macOS 13 이상 | 카카오톡 Mac 앱과 접근성 API를 위해 필요해요 |
| Xcode Command Line Tools | `swiftc` 로 네이티브 헬퍼를 빌드해요 (`xcode-select --install`) |
| Mac용 카카오톡 앱 | 로그인 + 채팅창 열림 상태 |
| Node 20 이상 | npm을 사용해요 |

### 동작 원리
- macOS Accessibility API로 카카오톡 UI를 직접 읽고 조작해요
- 실행하고자 하는 터미널에 손쉬운 사용 권한이 필요해요
- **읽기**
  - 채팅창에서에서 시각, 보낸 사람, 본문을 읽어요
  - 말풍선이 오른쪽 끝에 붙어 있으면 내가 보낸 것으로 간주해요
- **전송**
  - 입력창의 내용을 보내고자 하는 메시지로 치환하고 전송 버튼을 눌러요
  - 키 이벤트를 쓰지 않으므로 카카오톡 창을 앞으로 끌어올리지 않아요
- 카카오톡 UI가 한국어 또는 영어인 경우만 동작해요
  - 다른 언어를 사용하는 경우 `native/tkt-ax.swift` 의 `chatListWindowTitles`, `sendButtonTitles` 수정이 필요해요

## 실행
- **실행하기 전 채팅을 주고받고자 하는 카카오 채팅방을 미리 열어두세요**
```bash
npm install
npm run dev
```

## 사용법
| 키 | 동작 |
|---|---|
| `Enter` | 전송 |
| `Tab` | 채팅방 전환 (열려 있는 카카오톡 채팅창 중에서) |
| `Esc` | 종료 |

## 라이선스

[MIT](LICENSE)
