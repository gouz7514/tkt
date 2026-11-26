#!/bin/bash
# tkt 가 시작되지 않을 때 어느 단계에서 막히는지 찾는다.
#
# 각 단계는 실행하기 전에 먼저 제목을 찍는다. 화면에 마지막으로 남은 제목이
# 곧 막힌 지점이다 — 멈춘 채로 두고 그 제목을 보면 된다.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "macOS"
macos_version=$(sw_vers -productVersion)
echo "$macos_version"
if (( ${macos_version%%.*} < 13 )); then
  echo "→ macOS 13 이상이 필요합니다." >&2
  exit 1
fi

step "Xcode 명령줄 도구 (도구가 없으면 설치 안내가 표시됩니다)"
if ! xcode-select -p; then
  echo "→ 명령줄 도구가 없습니다. xcode-select --install 로 설치한 뒤 다시 실행하세요."
  exit 1
fi
swiftc --version

step "네이티브 헬퍼 빌드 (처음에는 수십 초가 걸릴 수 있습니다)"
time swiftc -O native/tkt-ax.swift -o native/tkt-ax

step "헬퍼 실행 — 접근성 권한과 카카오톡 실행 여부"
readiness=$(./native/tkt-ax check)
echo "$readiness"
ready=1
if [[ "$readiness" != *'"trusted":true'* ]]; then
  echo '→ 시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 이 터미널 앱을 켜고 완전히 종료했다 다시 여세요.' >&2
  ready=0
fi
if [[ "$readiness" != *'"kakaoRunning":true'* ]]; then
  echo '→ 카카오톡을 실행하고 로그인해 주세요.' >&2
  ready=0
fi
(( ready )) || exit 1

step "열려 있는 채팅창"
windows=$(./native/tkt-ax windows)
echo "$windows"
if [[ "$windows" == '{"windows":[]}' ]]; then
  echo '→ 카카오톡에서 채팅창을 하나 이상 열어주세요.' >&2
  exit 1
fi

step "Node와 tsx"
node --version
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 20 ? 1 : 0)'; then
  echo '→ Node 20 이상이 필요합니다.' >&2
  exit 1
fi
if [[ ! -x node_modules/.bin/tsx ]]; then
  echo '→ npm install로 의존성을 설치해 주세요.' >&2
  exit 1
fi
./node_modules/.bin/tsx --version

printf '\n\033[1m모든 단계 통과. npm run dev 를 다시 실행해 보세요.\033[0m\n'
