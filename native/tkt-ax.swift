// tkt-ax — 카카오톡 채팅창에 포커스를 뺏지 않고 메시지를 보내는 최소 헬퍼.
//
// 왜 직접 만들었나:
//   kmsg send 는 전역 CGEvent 로 키를 합성해서 카카오톡을 반드시 앞으로 가져온다.
//   (아래 설명은 키보드 방식 fallback 에 대한 것이다. 지금 기본 경로는 키 이벤트를 아예
//   쓰지 않는다 — AXSelectedText 로 본문을 넣고 「전송」 버튼을 AXPress 한다. 그러면 창을
//   key 로 올릴 필요가 없어 카카오톡 창이 다른 앱 위로 튀어나오지도 않는다.)
//
//   openkakao-cli local-send 는 포커스는 안 뺏지만 입력창에 AXValue 를 직접 세팅해서
//   카카오톡 내부 텍스트 모델이 그 값을 모르고, 그래서 Return 이 무시된다
//   (글자는 입력창에 남고 전송은 안 됨).
//
//   그래서 여기서는 AXValue 를 쓰지 않는다. 입력창에 포커스만 주고 실제 키 이벤트를
//   CGEvent.postToPid 로 카카오톡 프로세스에 직접 꽂는다. 앱의 입력 처리를 그대로
//   타므로 정상 전송되고, 전역 이벤트가 아니라 포커스도 뺏지 않는다.
//
// 읽기도 여기서 한다. kmsg read 는 한 번에 17초가 걸리고, 채팅창이 위로 스크롤돼 있으면
// 화면에 렌더된 구간만 돌려줘서 최신 메시지를 놓친다. AX 트리를 직접 읽으면 둘 다 없다.
//
// 사용법:
//   tkt-ax send <채팅방 이름> <메시지>
//   tkt-ax read <채팅방 이름> [개수]
//   tkt-ax windows                      열려 있는 채팅창 목록
//   tkt-ax open <채팅방 이름>            닫혀 있는 채팅방을 연다
//   tkt-ax check                        접근성 권한·카카오톡 실행 여부를 진단한다

import AppKit
import ApplicationServices

let kakaoBundleID = "com.kakao.KakaoTalkMac"
let returnKey: CGKeyCode = 36
let deleteKey: CGKeyCode = 51
let aKey: CGKeyCode = 0

/// 채팅 목록 창의 제목. 대화창과 구조가 거의 같아서 제목으로만 구분한다.
/// 카카오톡 UI 언어에 따라 달라진다.
let chatListWindowTitles = ["카카오톡", "KakaoTalk"]

/// 입력창 아래 전송 버튼의 이름. 역시 UI 언어를 탄다.
let sendButtonTitles = ["전송", "Send"]

func fail(_ message: String, status: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(status)
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value
}

func children(of element: AXUIElement) -> [AXUIElement] {
    (attribute(element, kAXChildrenAttribute as String) as? [AXUIElement]) ?? []
}

func role(of element: AXUIElement) -> String {
    (attribute(element, kAXRoleAttribute as String) as? String) ?? ""
}

/// 대화 내역 영역인지. 입력창도 여러 줄 입력을 위해 AXScrollArea 안에 들어 있어서,
/// 스크롤 영역 전부를 건너뛰면 입력창까지 못 찾는다. 대화 내역은 AXTable 을 가진
/// 스크롤 영역이라는 점으로 구분한다.
func isTranscriptArea(_ element: AXUIElement) -> Bool {
    guard role(of: element) == "AXScrollArea" else { return false }
    return children(of: element).contains { role(of: $0) == "AXTable" }
}

/// 값을 쓸 수 있는 텍스트 입력 요소를 깊이 우선으로 찾는다.
///
/// 대화 내역 안에는 들어가지 않는다. 메시지 말풍선도 AXTextArea 라서 수백 개를 훑게
/// 되는데, 입력창은 어차피 그 바깥에 있다. 이걸 안 걸러내면 전송 한 번에 20초가 걸린다.
func findInputField(in element: AXUIElement, depth: Int = 0) -> AXUIElement? {
    if depth > 14 { return nil }
    if isTranscriptArea(element) { return nil }

    let elementRole = role(of: element)
    if elementRole == "AXTextArea" || elementRole == "AXTextField" {
        var settable = DarwinBoolean(false)
        AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
        if settable.boolValue { return element }
    }

    for child in children(of: element) {
        if let found = findInputField(in: child, depth: depth + 1) { return found }
    }
    return nil
}

func frame(of element: AXUIElement) -> CGRect {
    var rect = CGRect.zero
    guard let value = attribute(element, "AXFrame") else { return rect }
    AXValueGetValue(value as! AXValue, .cgRect, &rect)
    return rect
}

func stringValue(_ element: AXUIElement) -> String {
    (attribute(element, kAXValueAttribute as String) as? String) ?? ""
}

func isClockText(_ text: String) -> Bool {
    let parts = text.split(separator: ":")
    guard parts.count == 2, parts[0].count <= 2, parts[1].count == 2 else { return false }
    return parts.allSatisfy { $0.allSatisfy(\.isNumber) }
}

struct Message {
    var time: String
    var author: String?
    var body: String
    var mine: Bool
    var attachment: Bool = false
}

func jsonEscape(_ s: String) -> String {
    var out = ""
    for c in s.unicodeScalars {
        switch c {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if c.value < 0x20 { out += String(format: "\\u%04x", c.value) } else { out.unicodeScalars.append(c) }
        }
    }
    return out
}

struct Keyboard {
    let pid: pid_t
    let source: CGEventSource

    func tap(_ key: CGKeyCode, flags: CGEventFlags = []) {
        for isDown in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: isDown)
            else { continue }
            event.flags = flags
            event.postToPid(pid)
        }
    }

    func type(_ text: String) {
        var utf16 = Array(text.utf16)
        for isDown in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: isDown)
            else { continue }
            event.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
            event.postToPid(pid)
        }
    }
}

// MARK: - 공통 준비

let usage = "usage: tkt-ax send <chat> <message> | read <chat> [limit] | windows | open <chat> | check"

let arguments = CommandLine.arguments
guard arguments.count >= 2 else { fail(usage) }
let command = arguments[1]
let readLimit: Int
if command == "read", arguments.count >= 4 {
    guard let limit = Int(arguments[3]), limit >= 0 else {
        fail("읽을 메시지 수는 0 이상의 정수여야 합니다")
    }
    readLimit = limit
} else {
    readLimit = 30
}

// check 는 "무엇이 준비되지 않았는지" 를 알아내는 명령이다. 준비된 상태를 전제하는 아래
// guard 들에 걸리면 안 되므로 가장 먼저 처리한다.
if command == "check" {
    // 권한이 없으면 시스템 다이얼로그를 띄운다. 손쉬운 사용 목록에 항목이 추가되므로
    // 사용자는 설정에서 앱을 찾아 헤맬 필요 없이 토글만 켜면 된다.
    let trusted = AXIsProcessTrustedWithOptions(
        [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
    )
    let running = NSWorkspace.shared.runningApplications
        .contains { $0.bundleIdentifier == kakaoBundleID }
    print("{\"trusted\":\(trusted),\"kakaoRunning\":\(running)}")
    exit(0)
}

guard let kakao = NSWorkspace.shared.runningApplications
    .first(where: { $0.bundleIdentifier == kakaoBundleID })
else {
    fail("카카오톡이 실행 중이 아닙니다")
}
let pid = kakao.processIdentifier
let axApp = AXUIElementCreateApplication(pid)

// 권한이 없으면 AX API 가 통째로 막힌다. 창 목록 읽기 실패는 그 첫 증상이라, 여기서
// 권한 문제와 그 밖의 문제를 갈라 안내한다.
guard attribute(axApp, kAXWindowsAttribute as String) != nil else {
    fail(
        AXIsProcessTrusted()
            ? "카카오톡 창 목록을 읽지 못했습니다."
            : "터미널에 손쉬운 사용(Accessibility) 권한이 없습니다. `tkt` 를 다시 실행하면 안내가 나옵니다."
    )
}

/// 지금 열려 있는 카카오톡 창들. 창은 명령 도중에도 늘어나므로 그때그때 다시 읽는다.
func currentWindows() -> [(title: String, element: AXUIElement)] {
    guard let ws = attribute(axApp, kAXWindowsAttribute as String) as? [AXUIElement] else { return [] }
    return ws.map { ((attribute($0, kAXTitleAttribute as String) as? String) ?? "", $0) }
}

/// 채팅창 후보. 채팅 목록 창과, 카카오톡이 띄우는 제목 없는 AXUnknown 보조 창은 뺀다.
///
/// 최소화하거나 앱을 숨기면(Cmd+H) 창의 subrole 이 AXStandardWindow 에서 AXDialog 로
/// 바뀐다. AX 트리 자체는 그대로 살아 있어서 읽기·전송 모두 되는데, subrole 만 보고
/// 걸러내면 창이 사라진 것으로 보인다. 그러면 readMessages 가 "닫힌 방" 으로 오해해
/// open 을 태우고, open 은 목록에서 방을 골라 Return 을 눌러 — 최소화해 둔 창을 도로
/// 끄집어낸다. 그래서 최소화·숨김 상태의 AXDialog 는 채팅창으로 인정한다.
func chatWindows() -> [(title: String, element: AXUIElement)] {
    let appHidden = (attribute(axApp, kAXHiddenAttribute as String) as? Bool) ?? false
    return currentWindows().filter {
        guard !$0.title.isEmpty, !chatListWindowTitles.contains($0.title) else { return false }
        let sub = attribute($0.element, kAXSubroleAttribute as String) as? String
        if sub == "AXStandardWindow" { return true }
        // 정상 상태에서 뜨는 진짜 모달 다이얼로그까지 채팅창으로 보지 않도록 조건을 건다.
        let minimized = (attribute($0.element, kAXMinimizedAttribute as String) as? Bool) ?? false
        return sub == "AXDialog" && (minimized || appHidden)
    }
}

if command == "windows" {
    let items = chatWindows().map { "\"\(jsonEscape($0.title))\"" }.joined(separator: ",")
    print("{\"windows\":[\(items)]}")
    exit(0)
}

guard arguments.count >= 3 else { fail(usage) }
let chatTitle = arguments[2]

enum ChatWindowMatch {
    case found(AXUIElement)
    case notOpen
    case ambiguous([String])
}

/// 제목으로 채팅창을 고른다.
///
/// 부분 일치를 허용하면 이름이 비슷한 다른 방을 잘못 열 수 있다.
func matchChatWindow(named name: String) -> ChatWindowMatch {
    let exact = chatWindows().filter { $0.title == name }
    if exact.count > 1 { return .ambiguous(exact.map(\.title)) }
    if let match = exact.first { return .found(match.element) }
    return .notOpen
}

func ambiguousMessage(_ name: String, _ matched: [String]) -> String {
    "'\(name)' 와(과) 이름이 겹치는 채팅창이 여럿입니다: \(matched). "
        + "어느 방인지 특정할 수 없어 아무 것도 하지 않았습니다. 채팅방 이름을 정확히 지정하세요."
}

// open 은 채팅창이 아직 없는 상태에서 부르는 명령이므로 여기서 막지 않는다.
// read/send 는 실제로 쓸 때 requireChatWindow() 로 확인한다.
func requireChatWindow() -> AXUIElement {
    switch matchChatWindow(named: chatTitle) {
    case .found(let window):
        return window
    case .ambiguous(let matched):
        fail(ambiguousMessage(chatTitle, matched))
    case .notOpen:
        fail("'\(chatTitle)' 채팅창이 열려 있지 않습니다.", status: 3)
    }
}

// MARK: - read

enum AttachmentKind: String {
    case image = "Image"
    case emoji = "Emoji"
    case video = "Video"
    case voiceCall = "Voice Call"
    case videoCall = "Video Call"
    case groupVoiceCall = "Group Voice Call"
    case groupVideoCall = "Group Video Call"
    case voiceMessage = "Voice Message"
    case audio = "Audio"
    case file = "File"
    case location = "Location"
    case contact = "Contact"
    case link = "Link"
    case gift = "Gift"
    case payment = "Payment"
    case poll = "Poll"
    case event = "Event"
    case attachment = "Attachment"

    var isCall: Bool {
        [.voiceCall, .videoCall, .groupVoiceCall, .groupVideoCall].contains(self)
    }
}

struct Attachment {
    let kind: AttachmentKind
    let rect: CGRect
    var count = 1
    var missed = false

    var label: String {
        if missed { return "Missed \(kind.rawValue)" }
        if count > 1 { return "\(kind.rawValue) ×\(count)" }
        return kind.rawValue
    }
}

struct AttachmentElement {
    let role: String
    let rect: CGRect
    let labels: [String]

    var isProfileButton: Bool {
        role == "AXButton" && labels.contains { ["프로필", "profile"].contains($0) }
    }
}

let attachmentHints: [(AttachmentKind, NSRegularExpression)] = [
    (.groupVideoCall, #"그룹\s*페이스톡|\bgroup\s*(face\s*talk|video\s*call)\b"#),
    (.groupVoiceCall, #"그룹\s*콜|\bgroup\s*(voice\s*)?call\b"#),
    (.videoCall, #"페이스톡|영상\s*통화|\b(face\s*talk|video\s*call)\b"#),
    (.voiceCall, #"보이스톡|음성\s*통화|\bvoice\s*(talk|call)\b"#),
    (.voiceMessage, #"음성\s*(메시지|녹음)|\bvoice\s*(message|recording)\b|audiomessage"#),
    (.emoji, #"이모티콘|이모지|스티커|\b(emoticon|emoji|sticker)\b|emoticonimage|stickerimage"#),
    (.location, #"위치\s*(공유|전송|보기)|^위치$|지도\s*보기|\blocation\b|map\s*preview"#),
    (.contact, #"연락처|프로필\s*공유|\bcontact\b|profile\s*share|\.vcf(?:$|[?#\s])"#),
    (.gift, #"선물하기|선물(이 도착| 받기)|기프티콘|\bgift\b"#),
    (.payment, #"송금|정산\s*(요청|하기)|\b(payment|money\s*transfer)\b"#),
    (.poll, #"투표|\bpoll\b"#),
    (.event, #"톡캘린더|일정\s*(공유|보기)|^일정$|\b(calendar|event)\b|\.ics(?:$|[?#\s])"#),
    (.video, #"동영상|비디오|\b(video|movie)\b|videoplayer|videothumbnail|\.(mp4|m4v|mov|webm)(?:$|[?#\s])"#),
    (.audio, #"\baudio\b|\.(mp3|m4a|wav|aac|ogg|flac)(?:$|[?#\s])"#),
    (.image, #"사진|^이미지$|\bphoto\b|\.(png|jpe?g|heic|webp|gif)(?:$|[?#\s])"#),
    (.file, #"파일|다운로드|\b(file|download)\b|\.(pdf|zip|txt|docx?|xlsx?|pptx?)(?:$|[?#\s])"#),
    (.link, #"링크\s*(미리\s*보기|공유)|\blink\s*(preview|share)\b|urlpreview"#),
].map { kind, pattern in
    (kind, try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive, .anchorsMatchLines]))
}

func isPlaybackTime(_ text: String) -> Bool {
    isClockText(text) || text.range(of: #"^\d{1,2}:\d{2}:\d{2}$"#, options: .regularExpression) != nil
}

func attachmentElements(
    from element: AXUIElement, role elementRole: String, depth: Int = 0
) -> [AttachmentElement] {
    let mediaRoles = ["AXImage", "AXButton", "AXGroup", "AXLink", "AXVideo", "AXMovie", "AXAudio"]
    if depth > 0 && elementRole == "AXStaticText" {
        let label = stringValue(element)
        guard !label.isEmpty else { return [] }
        return [AttachmentElement(role: elementRole, rect: frame(of: element), labels: [label])]
    }
    guard mediaRoles.contains(elementRole) else { return [] }

    let keys = ["AXDescription", "AXTitle", "AXHelp", "AXIdentifier", "AXSubrole", "AXURL", "AXFilename"]
    var values: CFArray?
    AXUIElementCopyMultipleAttributeValues(element, keys as CFArray, [], &values)
    let labels = (values as? [Any] ?? []).compactMap { value -> String? in
        (value as? String ?? (value as? URL)?.absoluteString)?.lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let part = AttachmentElement(role: elementRole, rect: frame(of: element), labels: labels)
    guard elementRole == "AXGroup", depth < 2 else { return [part] }
    return [part] + children(of: element).flatMap {
        attachmentElements(from: $0, role: role(of: $0), depth: depth + 1)
    }
}

func classifyAttachment(
    _ elements: [AttachmentElement], captions: [AttachmentElement], clockRects: [CGRect]
) -> Attachment? {
    let parts = elements.filter { !$0.isProfileButton }
    let images = parts.filter { $0.role == "AXImage" }
    let groups = parts.filter { $0.role == "AXGroup" }
    let cardCaptions = captions.filter { caption in
        // 이미지 위쪽의 발신자 이름은 카드 종류를 판정하는 데 쓰지 않는다.
        (images + groups).contains { $0.rect.minY <= caption.rect.minY + 2 }
    }
    let labels = (parts + cardCaptions).flatMap(\.labels).joined(separator: "\n")

    if let hint = attachmentHints.first(where: { _, pattern in
        pattern.firstMatch(in: labels, range: NSRange(labels.startIndex..., in: labels)) != nil
    }), let anchor = images.first ?? groups.first ?? parts.first {
        let kind = hint.0
        let rect = kind.isCall
            ? cardCaptions.reduce(anchor.rect) { $0.union($1.rect) }
            : anchor.rect
        let missed = kind.isCall && labels.range(
            of: #"부재중|응답\s*없음|\b(missed|no\s*answer)\b"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
        return Attachment(kind: kind, rect: rect, count: kind == .image ? max(1, images.count) : 1, missed: missed)
    }

    if let video = parts.first(where: { ["AXVideo", "AXMovie"].contains($0.role) }) {
        return Attachment(kind: .video, rect: images.first?.rect ?? video.rect)
    }
    if let audio = parts.first(where: { $0.role == "AXAudio" }) {
        return Attachment(kind: .audio, rect: audio.rect)
    }
    if let link = parts.first(where: { $0.role == "AXLink" && !$0.labels.isEmpty }) {
        return Attachment(kind: .link, rect: groups.first?.rect ?? link.rect)
    }
    guard let image = images.first else {
        return groups.first.map { Attachment(kind: .attachment, rect: $0.rect) }
    }
    // 썸네일 위의 재생 버튼과 길이만 사용한다. 말풍선 바깥의 전송 시각은 제외한다.
    let playOverlay = parts.contains { part in
        part.role == "AXButton" && !part.rect.isEmpty && image.rect.contains(part.rect)
            && part.labels.contains { ["재생", "play"].contains($0) }
    }
    let nestedTimes = parts.filter { $0.role == "AXStaticText" && $0.labels.contains(where: isPlaybackTime) }
    let isThumbnail = images.allSatisfy {
        max($0.rect.width, $0.rect.height) >= 96 && min($0.rect.width, $0.rect.height) >= 36
    }
    if isThumbnail && (playOverlay || (clockRects + nestedTimes.map(\.rect)).contains(where: {
        !$0.isEmpty && image.rect.contains($0)
    })) {
        return Attachment(kind: .video, rect: image.rect)
    }

    // 일부 카톡 이모티콘은 유형 정보 대신 122pt 크기의 그림 한 장으로 노출된다.
    if images.count == 1 && groups.isEmpty && cardCaptions.isEmpty
        && abs(image.rect.width - 122) < 1 && abs(image.rect.height - 122) < 1 {
        return Attachment(kind: .emoji, rect: image.rect)
    }

    // 파일이나 통화 같은 카드의 작은 아이콘을 사진으로 오인하지 않는다.
    if isThumbnail && cardCaptions.isEmpty {
        return Attachment(kind: .image, rect: image.rect, count: images.count)
    }
    return Attachment(kind: .attachment, rect: groups.first?.rect ?? image.rect)
}

func runRead(limit: Int) -> Never {
    guard let table = findTable(in: requireChatWindow()) else {
        fail("'\(chatTitle)' 채팅창에서 대화 영역을 찾지 못했습니다")
    }

    // 말풍선이 오른쪽 끝에 붙어 있으면 내가 보낸 것으로 본다.
    let tableRight = frame(of: table).maxX
    var messages: [Message] = []

    for row in children(of: table) {
        guard let cell = children(of: row).first else { continue }

        var time = ""
        var author: String?
        var bodies: [String] = []
        var candidates: [(AXUIElement, String)] = []
        var staticLabels: [(value: String, element: AXUIElement)] = []
        var clockLabels: [(value: String, element: AXUIElement)] = []
        var bubble: CGRect?

        for part in children(of: cell) {
            let elementRole = role(of: part)
            switch elementRole {
            case "AXStaticText":
                let text = stringValue(part)
                if isClockText(text) {
                    if time.isEmpty { time = text }
                    clockLabels.append((text, part))
                } else if isPlaybackTime(text) {
                    clockLabels.append(("", part))
                } else if !text.isEmpty {
                    staticLabels.append((text, part))
                    if author == nil { author = text }
                }
            case "AXTextArea":
                let text = stringValue(part)
                if !text.isEmpty {
                    bodies.append(text)
                    if bubble == nil { bubble = frame(of: part) }
                }
            case "AXImage":
                candidates.append((part, elementRole))
                if bubble == nil { bubble = frame(of: part) }
            default:
                candidates.append((part, elementRole))
            }
        }

        var body = bodies.joined(separator: "\n")
        var isAttachment = false
        if body.isEmpty {
            let elements = candidates.flatMap { attachmentElements(from: $0.0, role: $0.1) }
            guard !elements.isEmpty else { continue }
            let clockRects = clockLabels.map { frame(of: $0.element) }
            let captions = staticLabels.map {
                AttachmentElement(role: "AXStaticText", rect: frame(of: $0.element), labels: [$0.value])
            }
            guard let attachment = classifyAttachment(elements, captions: captions, clockRects: clockRects)
            else { continue }
            body = attachment.label
            isAttachment = true
            // 카드 설명을 발신자 이름으로 취급하지 않는다.
            let authorCaption = captions.first
            if let authorCaption, authorCaption.rect.minY >= attachment.rect.minY - 2 {
                author = nil
            }
            bubble = attachment.rect
            if attachment.kind == .video || attachment.kind.isCall {
                time = zip(clockLabels, clockRects).first { label, rect in
                    !label.value.isEmpty && (rect.isEmpty || !attachment.rect.contains(rect))
                }?.0.value ?? ""
            }
        }

        let mine = bubble.map { tableRight - $0.maxX < 40 } ?? true
        messages.append(Message(time: time, author: author, body: body, mine: mine, attachment: isAttachment))
    }

    // 카카오톡은 같은 분에 연속으로 오간 메시지를 묶어 마지막 행에만 시각을 표시한다.
    // 시각이 빈 행은 뒤따르는 행의 시각을 물려받게 채운다.
    var pendingTime = ""
    for i in stride(from: messages.count - 1, through: 0, by: -1) {
        if messages[i].time.isEmpty {
            messages[i].time = pendingTime
        } else {
            pendingTime = messages[i].time
        }
    }

    let tail = messages.suffix(limit)
    var out = "{\"chat\":\"\(jsonEscape(chatTitle))\",\"messages\":["
    out += tail.map { m in
        let authorField = m.author.map { "\"\(jsonEscape($0))\"" } ?? "null"
        return "{\"time\":\"\(jsonEscape(m.time))\",\"author\":\(authorField),"
            + "\"body\":\"\(jsonEscape(m.body))\",\"mine\":\(m.mine),\"attachment\":\(m.attachment)}"
    }.joined(separator: ",")
    out += "]}"
    print(out)
    exit(0)
}

// MARK: - open

func findListWindow() -> AXUIElement? {
    currentWindows().first { chatListWindowTitles.contains($0.title) }?.element
}

/// 「창」 메뉴의 항목을 누른다.
///
/// 채팅 목록 창이 닫혀 있으면 다른 방법으로는 되살릴 수 없다. `activate()` 도 `open -a` 도
/// 창을 되돌려주지 않는다. 반면 메뉴 항목 AXPress 는 앱을 활성화하지 않고도 동작한다.
func pressWindowMenuItem(_ wanted: [String]) -> Bool {
    guard let barRef = attribute(axApp, kAXMenuBarAttribute as String) else { return false }
    let bar = barRef as! AXUIElement
    for top in children(of: bar) {
        for menu in children(of: top) {
            for item in children(of: menu) {
                let title = (attribute(item, kAXTitleAttribute as String) as? String) ?? ""
                if wanted.contains(title) {
                    return AXUIElementPerformAction(item, kAXPressAction as CFString) == .success
                }
            }
        }
    }
    return false
}

/// 목록 창의 검색 필드. 채팅방 행을 필터링하는 통로다 — 목록 테이블은 가상화돼 있어
/// 화면 근처의 행만 AX 트리에 존재하므로, 아래쪽 채팅방은 검색해야 나온다.
func findSearchField(in window: AXUIElement, depth: Int = 0) -> AXUIElement? {
    if depth > 10 { return nil }
    if role(of: window) == "AXTextField" {
        var settable = DarwinBoolean(false)
        AXUIElementIsAttributeSettable(window, kAXValueAttribute as CFString, &settable)
        if settable.boolValue { return window }
    }
    for child in children(of: window) {
        if let found = findSearchField(in: child, depth: depth + 1) { return found }
    }
    return nil
}

func findTable(in element: AXUIElement, depth: Int = 0) -> AXUIElement? {
    if depth > 12 { return nil }
    if role(of: element) == "AXScrollArea",
       let table = children(of: element).first(where: { role(of: $0) == "AXTable" }) {
        return table
    }
    for child in children(of: element) {
        if let found = findTable(in: child, depth: depth + 1) { return found }
    }
    return nil
}

func rowTitle(_ element: AXUIElement, depth: Int = 0) -> String? {
    if depth > 4 { return nil }
    if role(of: element) == "AXStaticText" {
        let text = stringValue(element)
        if !text.isEmpty { return text }
    }
    for child in children(of: element) {
        if let title = rowTitle(child, depth: depth + 1) { return title }
    }
    return nil
}

func matchingChatRows(in table: AXUIElement, named name: String) -> [AXUIElement] {
    children(of: table).filter { role(of: $0) == "AXRow" && rowTitle($0) == name }
}

func runOpen(chat: String) -> Never {
    switch matchChatWindow(named: chat) {
    case .found:
        print("already open")
        exit(0)
    case .ambiguous(let matched):
        fail(ambiguousMessage(chat, matched))
    case .notOpen:
        break
    }

    if findListWindow() == nil, !pressWindowMenuItem(["채팅", "Chats"]) {
        fail("카카오톡 채팅 목록 창을 열 수 없습니다. 카카오톡을 한 번 열어주세요.")
    }

    var listWindow: AXUIElement?
    for _ in 0..<20 {
        if let window = findListWindow() { listWindow = window; break }
        usleep(150_000)
    }
    guard let list = listWindow else {
        fail("카카오톡 채팅 목록 창을 찾지 못했습니다")
    }
    // 목록 창이 「친구」 탭을 보고 있으면 채팅 목록(AXTable) 대신 AXOutline 이 그려진다.
    // 같은 메뉴 항목으로 채팅 탭으로 되돌린다.
    var listTable = findTable(in: list)
    if listTable == nil, pressWindowMenuItem(["채팅", "Chats"]) {
        for _ in 0..<20 {
            usleep(150_000)
            if let table = findTable(in: findListWindow() ?? list) { listTable = table; break }
        }
    }
    guard let table = listTable else {
        fail("채팅 목록을 찾지 못했습니다. 카카오톡에서 채팅 탭을 열어주세요.")
    }

    // 검색 결과에서 메시지 미리보기는 제외하고 정확한 제목만 비교한다.
    var previousSearch: (field: AXUIElement, text: String)?
    func restoreSearch() {
        if let previousSearch {
            _ = replaceText(in: previousSearch.field, with: previousSearch.text)
        }
    }

    var matches = matchingChatRows(in: table, named: chat)
    if matches.isEmpty, let search = findSearchField(in: list) {
        previousSearch = (search, stringValue(search))
        AXUIElementSetAttributeValue(search, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        usleep(120_000)
        guard replaceText(in: search, with: chat) else {
            restoreSearch()
            fail("카카오톡 채팅 검색어를 입력하지 못했습니다")
        }

        for _ in 0..<25 {
            usleep(120_000)
            matches = matchingChatRows(in: table, named: chat)
            if !matches.isEmpty { break }
        }
    }

    guard matches.count <= 1 else {
        restoreSearch()
        fail("같은 이름의 '\(chat)' 채팅방이 여러 개 있습니다. 카카오톡에서 직접 열어주세요.")
    }
    guard let row = matches.first else {
        restoreSearch()
        fail("'\(chat)' 채팅방을 목록에서 찾지 못했습니다")
    }

    // Return 은 앱의 key window 로만 전달된다. 목록 창을 올려야 행 선택이 먹는다.
    // 채팅방을 여는 동작이라 창이 앞으로 나오는 것은 자연스럽다. 앱 포커스는 뺏지 않는다.
    AXUIElementSetAttributeValue(list, kAXMainAttribute as CFString, kCFBooleanTrue)
    AXUIElementSetAttributeValue(list, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    usleep(200_000)
    AXUIElementSetAttributeValue(table, kAXSelectedRowsAttribute as CFString, [row] as CFArray)
    usleep(200_000)

    guard let source = CGEventSource(stateID: .combinedSessionState),
          let selected = attribute(table, kAXSelectedRowsAttribute as String) as? [AXUIElement],
          selected.count == 1, selected.first.map({ CFEqual($0, row) }) == true,
          let focusedWindow = attribute(axApp, kAXFocusedWindowAttribute as String),
          CFEqual(focusedWindow, list) else {
        restoreSearch()
        fail("대상 채팅방 선택을 확인하지 못해 열기를 중단했습니다")
    }
    Keyboard(pid: pid, source: source).tap(returnKey)

    var opened = false
    for _ in 0..<40 {
        usleep(150_000)
        if case .found = matchChatWindow(named: chat) { opened = true; break }
    }

    restoreSearch()
    if !opened { fail("'\(chat)' 채팅창이 열리지 않았습니다") }
    print("opened")
    exit(0)
}

func replaceText(in field: AXUIElement, with replacement: String) -> Bool {
    guard let current = attribute(field, kAXValueAttribute as String) as? String else { return false }
    if !current.isEmpty {
        var range = CFRange(location: 0, length: (current as NSString).length)
        guard let axRange = AXValueCreate(.cfRange, &range),
              AXUIElementSetAttributeValue(field, kAXSelectedTextRangeAttribute as CFString, axRange) == .success
        else { return false }
    }
    return AXUIElementSetAttributeValue(
        field, kAXSelectedTextAttribute as CFString, replacement as CFTypeRef
    ) == .success
}

// MARK: - send

/// 버튼에 붙은 이름들. 아이콘으로 그려진 버튼은 AXTitle 이 비어 있고 AXDescription 에만
/// 이름이 있어서, 제목만 보면 「전송」 버튼을 놓친다.
func buttonLabels(_ element: AXUIElement) -> [String] {
    [kAXTitleAttribute as String, kAXDescriptionAttribute as String]
        .compactMap { attribute(element, $0) as? String }
        .filter { !$0.isEmpty }
}

/// 입력창 아래 「전송」 버튼. 있으면 키 이벤트 없이 보낼 수 있다.
func findSendButton(in element: AXUIElement, depth: Int = 0) -> AXUIElement? {
    if depth > 14 { return nil }
    // 대화 내역 안에는 없다. 들어가면 탐색이 십수 초로 늘어난다.
    if isTranscriptArea(element) { return nil }
    if role(of: element) == "AXButton",
       buttonLabels(element).contains(where: { sendButtonTitles.contains($0) }) {
        return element
    }
    for child in children(of: element) {
        if let found = findSendButton(in: child, depth: depth + 1) { return found }
    }
    return nil
}

/// 키 이벤트를 쓰지 않는 전송.
///
/// 입력창의 기존 내용을 통째로 선택 범위로 잡고 `AXSelectedText` 로 치환한다. `AXValue` 를
/// 직접 세팅하는 것과 달리 앱의 텍스트 시스템을 거치므로 카카오톡이 내용을 인식한다.
/// 그 다음 「전송」 버튼을 찾아 누른다 — 버튼은 본문이 들어간 뒤에야 나타날 수 있다.
///
/// 창을 key 로 올리지 않으므로 카카오톡 창이 다른 앱 위로 올라오지 않는다.
/// 성공 여부는 반환값으로 알 수 없다 — 누르는 순간 입력창이 비면서 버튼이 재구성되는지
/// AXPress 가 실패 코드를 돌려주기 때문이다. 그래서 입력창이 비워졌는지로 판정한다.
func pressSendButton(field: AXUIElement, window: AXUIElement, message: String) -> Bool {
    guard replaceText(in: field, with: message) else { return false }

    usleep(150_000)

    // 버튼은 본문을 넣은 뒤에 찾는다. 카카오톡은 입력창이 비어 있는 동안 전송 버튼을
    // 그리지 않기도 해서, 먼저 찾으면 멀쩡한 창에서도 키보드 fallback 으로 떨어진다.
    // 그 경로는 카카오톡 창을 앞으로 끌어올리므로 이 도구의 존재 이유가 날아간다.
    guard let button = findSendButton(in: window),
          (attribute(field, kAXValueAttribute as String) as? String) == message else { return false }

    AXUIElementPerformAction(button, kAXPressAction as CFString)
    return true
}

func confirmSend(field: AXUIElement) -> Never {
    for _ in 0..<20 {
        usleep(100_000)
        if (attribute(field, kAXValueAttribute as String) as? String)?.isEmpty == true {
            print("sent")
            exit(0)
        }
    }
    fail("전송 결과를 확인하지 못했습니다. 카카오톡에서 확인해 주세요.")
}

func runSend(message: String) -> Never {
    guard !message.isEmpty else { fail("빈 메시지는 보내지 않습니다") }

    let window = requireChatWindow()
    guard let field = findInputField(in: window) else {
        fail("'\(chatTitle)' 채팅창에서 입력창을 찾지 못했습니다")
    }
    if pressSendButton(field: field, window: window, message: message) {
        confirmSend(field: field)
    }

    guard let source = CGEventSource(stateID: .combinedSessionState) else {
        fail("CGEventSource 를 만들지 못했습니다")
    }
    let keyboard = Keyboard(pid: pid, source: source)

    // fallback: 「전송」 버튼을 못 찾았거나 치환이 안 먹은 경우. 실제 키 이벤트를 쓴다.
    // postToPid 로 보낸 키는 앱의 key window 로 가므로, 대상 창을 main 으로 올려야
    // 엉뚱한 채팅창으로 들어가지 않는다. 이 경로에서는 카카오톡 창이 앞으로 올라온다.
    AXUIElementSetAttributeValue(window, kAXMainAttribute as CFString, kCFBooleanTrue)
    usleep(150_000)

    AXUIElementSetAttributeValue(field, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    usleep(120_000)

    func verifyFocus() {
        guard let focusedWindow = attribute(axApp, kAXFocusedWindowAttribute as String),
              let focusedField = attribute(axApp, kAXFocusedUIElementAttribute as String),
              CFEqual(focusedWindow, window), CFEqual(focusedField, field) else {
            fail("대상 채팅창에 입력 포커스를 확인하지 못해 전송을 중단했습니다")
        }
    }

    // 입력창에 남아 있던 내용을 먼저 비운다. AXValue 를 ""로 덮으면 앱 모델과 어긋나므로
    // 전체선택 후 삭제를 실제 키 이벤트로 보낸다.
    verifyFocus()
    keyboard.tap(aKey, flags: .maskCommand)
    usleep(60_000)
    verifyFocus()
    keyboard.tap(deleteKey)
    usleep(60_000)

    verifyFocus()
    keyboard.type(message)
    usleep(250_000)
    guard (attribute(field, kAXValueAttribute as String) as? String) == message else {
        fail("메시지 입력을 확인하지 못해 전송을 중단했습니다")
    }
    verifyFocus()
    keyboard.tap(returnKey)

    confirmSend(field: field)
}

switch command {
case "send":
    guard arguments.count >= 4 else { fail("usage: tkt-ax send <chat> <message>") }
    runSend(message: arguments[3])
case "read":
    runRead(limit: readLimit)
case "open":
    runOpen(chat: chatTitle)
default:
    fail("알 수 없는 명령: \(command)")
}
