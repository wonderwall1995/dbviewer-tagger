#!/usr/bin/env bash
# 배포할 때마다 실행한다 ("딸깍"): main을 받아 Web을 빌드하고 교체한 뒤 서비스를 다시 시작한다.
#   사용법: deploy/server-up.sh            main의 최신 커밋을 배포
#           deploy/server-up.sh <커밋>     그 커밋을 배포 (되돌리기: 이전에 배포한 커밋을 넣는다)
# 흐름: main 받기 → Web에 필요한 패키지만 설치(Electron 제외) → 서버 묶음 + 화면 빌드
#       → /opt/tagger, /var/www/tagger 교체 → (있으면) 견본 데이터 교체 → 서비스 재시작 → 응답 확인
# 서버 파일은 빌드한 폴더(홈)에서 바로 실행하지 않고 /opt/tagger 로 복사한다. 서비스는 홈 폴더를 볼 수 없다.
set -euo pipefail

if ! systemctl cat tagger-api >/dev/null 2>&1; then
  echo "tagger-api 서비스가 없습니다. 이 서버에서 deploy/setup-server.sh 를 먼저 실행하세요." >&2
  exit 1
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

echo "== 1. main 받기"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "작업 폴더에 커밋하지 않은 변경이 있습니다. 서버에서는 코드를 고치지 않습니다." >&2
  git status --short >&2
  exit 1
fi
git fetch origin
TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  git checkout -q main
  git pull --ff-only origin main
else
  # 되돌리기: 지정한 커밋으로 배포한다. 다음에 인자 없이 실행하면 다시 main으로 돌아간다.
  git checkout -q --detach "$TARGET"
fi
REV="$(git rev-parse --short HEAD)"
echo "배포할 커밋: $REV $(git log -1 --format=%s)"

echo "== 2. 설치 (Web에 필요한 패키지만)"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
pnpm install --frozen-lockfile --filter "@tagger/server..." --filter "@tagger/ui..."

echo "== 3. 빌드"
pnpm --filter @tagger/core run build
pnpm --filter @tagger/server run bundle
pnpm --filter @tagger/ui run build
test -f apps/server/bundle/tagger-server.js
test -f packages/ui/dist/index.html

echo "== 4. 교체"
sudo install -o root -g root -m 0644 apps/server/bundle/tagger-server.js /opt/tagger/tagger-server.js
sudo install -o root -g root -m 0644 apps/server/bundle/tagger-admin.js /opt/tagger/tagger-admin.js
sudo rsync -a --delete --chown=root:root --chmod=D755,F644 packages/ui/dist/ /var/www/tagger/
if [[ -d samples/workspace ]]; then
  sudo rsync -a --delete --chown=tagger:www-data --chmod=D700,F600 samples/workspace/ /var/lib/tagger/sample/
  echo "견본 데이터를 바꿨습니다 (새로 들어오는 면접관부터 적용)"
fi

echo "== 5. 서비스 재시작"
sudo systemctl restart tagger-api
for i in $(seq 1 30); do
  if curl -fsS --unix-socket /run/tagger/tagger.sock http://localhost/api/health >/dev/null 2>&1; then
    # 되돌릴 때 쓸 수 있게, 배포에 성공한 커밋을 기록한다.
    echo "$(date -Is) $REV" | sudo tee -a /var/lib/tagger/deploy-history.log >/dev/null
    echo "배포했습니다: $REV  (기록: sudo cat /var/lib/tagger/deploy-history.log)"
    exit 0
  fi
  sleep 1
done
echo "서비스가 응답하지 않습니다. 로그를 확인하세요: journalctl -u tagger-api -n 50 --no-pager" >&2
exit 1
