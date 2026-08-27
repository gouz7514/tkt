#!/bin/bash
# tkt 가 시작되지 않을 때 어느 단계에서 막히는지 찾는다.
#
# 각 단계는 실행하기 전에 먼저 제목을 찍는다. 화면에 마지막으로 남은 제목이
# 곧 막힌 지점이다 — 멈춘 채로 두고 그 제목을 보면 된다.
set -u
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "macOS"
sw_vers -productVersion

step "Xcode 명령줄 도구 (없으면 여기서 설치 다이얼로그를 띄우고 멈춘다)"
if ! xcode-select -p; then
  echo "→ 명령줄 도구가 없습니다. xcode-select --install 로 설치한 뒤 다시 실행하세요."
  exit 1
fi
swiftc --version | head -1

step "네이티브 헬퍼 빌드 (처음에는 모듈 캐시를 만드느라 수십 초 걸릴 수 있다)"
time swiftc -O native/tkt-ax.swift -o native/tkt-ax || exit 1

step "헬퍼 실행 — 접근성 권한과 카카오톡 실행 여부"
./native/tkt-ax check || exit 1
echo '→ trusted:false 면 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서'
echo '  이 터미널 앱을 켜고, 터미널을 완전히 종료했다 다시 여세요.'

step "열려 있는 채팅창"
./native/tkt-ax windows

step "Node 와 tsx (여기서 멈추면 의존성 설치가 덜 끝난 것이다)"
node --version
npx tsx --version

printf '\n\033[1m모든 단계 통과. npm run dev 를 다시 실행해 보세요.\033[0m\n'
