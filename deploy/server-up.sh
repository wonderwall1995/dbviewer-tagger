#!/usr/bin/env bash
# 배포할 때마다 실행한다 ("딸깍"): main을 받아 Web을 빌드하고, 새 버전으로 바꿔 끼운 뒤 서비스를 다시 시작한다.
#   사용법: deploy/server-up.sh                main의 최신 커밋을 배포
#           deploy/server-up.sh <커밋>         그 커밋을 배포 (main에 들어 있는 커밋만)
#           deploy/server-up.sh --rollback     빌드 없이 바로 전에 배포한 버전으로 되돌림
#
# 버전별 폴더에 준비한 뒤 링크만 바꿔 끼운다. 바꿔 끼운 뒤 응답이 없으면 자동으로 이전 버전으로 되돌린다.
#   /opt/tagger/releases/<커밋>/        서버 파일 2개      /opt/tagger/current  → 지금 버전
#   /var/www/tagger-releases/<커밋>/    화면 파일          /var/www/tagger      → 지금 버전
# 서버 파일은 빌드한 폴더(홈)에서 바로 실행하지 않는다. 서비스는 홈 폴더를 볼 수 없다.
# 이 스크립트는 시험(pnpm test)을 돌리지 않는다. 시험은 PR을 main에 병합하기 전에 개발 PC에서 돌린다.
set -euo pipefail

# 본문 전체를 함수로 감싼다. bash는 함수를 끝까지 읽은 뒤 실행하므로, 실행 중에 git pull로 이 파일이 바뀌어도 꼬이지 않는다.
main() {

  RELEASES=/opt/tagger/releases
  WEB_RELEASES=/var/www/tagger-releases
  HISTORY=/var/lib/tagger/deploy-history.log
  KEEP=3

  if ! systemctl cat tagger-api >/dev/null 2>&1; then
    echo "tagger-api 서비스가 없습니다. 이 서버에서 deploy/setup-server.sh 를 먼저 실행하세요." >&2
    exit 1
  fi

  # 링크를 한 번에 바꾼다 (임시 링크를 만든 뒤 이름을 바꾼다. 바꾸는 중에 링크가 없는 순간이 없다).
  swap_link() {
    local target="$1" link="$2"
    sudo ln -sfn "$target" "$link.new"
    sudo mv -Tf "$link.new" "$link"
  }

  # 응답 확인: 소켓으로 서버에 직접, 그리고 Nginx를 거쳐서. 소켓은 tagger와 www-data만 쓸 수 있어서 sudo로 확인한다.
  healthy() {
    sudo curl -fsS --max-time 3 --unix-socket /run/tagger/tagger.sock http://localhost/api/health >/dev/null 2>&1 || return 1
    local domain
    domain="$(sudo grep -m1 -oP 'server_name\s+\K[^; ]+' /etc/nginx/sites-available/tagger 2>/dev/null || true)"
    [[ -z "$domain" ]] && return 0
    if sudo grep -q 'listen 443' /etc/nginx/sites-available/tagger; then
      curl -fsS --max-time 5 --resolve "$domain:443:127.0.0.1" "https://$domain/api/health" >/dev/null 2>&1
    else
      curl -fsS --max-time 5 -H "Host: $domain" http://127.0.0.1/api/health >/dev/null 2>&1
    fi
  }

  restart_and_check() {
    sudo systemctl restart tagger-api
    for _ in $(seq 1 30); do
      if healthy; then return 0; fi
      sleep 1
    done
    return 1
  }

  activate() {
    local rev="$1"
    swap_link "$RELEASES/$rev" /opt/tagger/current
    swap_link "$WEB_RELEASES/$rev" /var/www/tagger
  }

  PREV="$(basename "$(readlink -f /opt/tagger/current 2>/dev/null || echo none)")"

  # ── 되돌리기: 빌드 없이 바로 전 버전으로 ─────────────────────────────────────
  if [[ "${1:-}" == "--rollback" ]]; then
    TARGET_REV="$(sudo tac "$HISTORY" 2>/dev/null | awk '{print $2}' | grep -vx "$PREV" | head -1 || true)"
    if [[ -z "$TARGET_REV" || ! -d "$RELEASES/$TARGET_REV" || ! -d "$WEB_RELEASES/$TARGET_REV" ]]; then
      echo "되돌릴 이전 버전이 서버에 없습니다. 커밋을 지정해 배포하세요: deploy/server-up.sh <커밋>" >&2
      exit 1
    fi
    activate "$TARGET_REV"
    if restart_and_check; then
      echo "$(date -Is) $TARGET_REV rollback" | sudo tee -a "$HISTORY" >/dev/null
      echo "되돌렸습니다: $PREV → $TARGET_REV"
      exit 0
    fi
    echo "되돌린 버전도 응답하지 않습니다. 로그를 확인하세요: journalctl -u tagger-api -n 50 --no-pager" >&2
    exit 1
  fi

  REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$REPO"

  echo "== 1. 코드 받기"
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "작업 폴더에 커밋하지 않은 변경이 있습니다. 서버에서는 코드를 고치지 않습니다." >&2
    git status --short >&2
    exit 1
  fi
  git fetch origin
  TARGET="${1:-}"
  local script_before
  script_before="$(git hash-object deploy/server-up.sh)"
  if [[ -z "$TARGET" ]]; then
    git checkout -q main
    git pull --ff-only origin main
    # 받아 온 main에서 이 배포 스크립트가 바뀌었으면, 새 스크립트로 처음부터 다시 실행한다.
    if [[ -z "${TAGGER_REEXEC:-}" && "$(git hash-object deploy/server-up.sh)" != "$script_before" ]]; then
      echo "배포 스크립트가 새로 바뀌어, 새 스크립트로 다시 실행합니다."
      TAGGER_REEXEC=1 exec bash "$REPO/deploy/server-up.sh" "$@"
    fi
  else
    # main에 병합된 커밋만 배포한다. (병합되지 않은 브랜치의 커밋은 PR 검토를 거치지 않았다)
    if ! git merge-base --is-ancestor "$TARGET" origin/main 2>/dev/null; then
      echo "$TARGET 은(는) main에 들어 있는 커밋이 아닙니다. main에 병합된 커밋만 배포합니다." >&2
      exit 1
    fi
    git checkout -q --detach "$TARGET"
  fi
  REV="$(git rev-parse --short=12 HEAD)"
  echo "배포할 커밋: $REV $(git log -1 --format=%s)"

  echo "== 2. 설치 (Web에 필요한 패키지만)"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  export ELECTRON_SKIP_BINARY_DOWNLOAD=1
  pnpm install --frozen-lockfile --filter "@tagger/server..." --filter "@tagger/ui..."

  echo "== 3. 검사와 빌드"
  pnpm --filter @tagger/core run build
  pnpm --filter @tagger/server run build      # 타입 검사를 겸한다
  pnpm --filter @tagger/ui run typecheck
  pnpm --filter @tagger/server run bundle
  pnpm --filter @tagger/ui run build
  test -f apps/server/bundle/tagger-server.js
  test -f packages/ui/dist/index.html

  echo "== 4. 새 버전 준비 ($REV)"
  sudo install -d -o root -g root -m 0755 "$RELEASES/$REV" "$WEB_RELEASES/$REV"
  sudo install -o root -g root -m 0644 apps/server/bundle/tagger-server.js apps/server/bundle/tagger-admin.js "$RELEASES/$REV/"
  sudo rsync -a --delete --chown=root:root --chmod=D755,F644 packages/ui/dist/ "$WEB_RELEASES/$REV/"
  if [[ -d samples/workspace ]]; then
    sudo rsync -a --delete --chown=tagger:www-data --chmod=D700,F600 samples/workspace/ /var/lib/tagger/sample/
    echo "견본 데이터를 바꿨습니다 (새로 들어오는 면접관부터 적용)"
  fi

  echo "== 5. 바꿔 끼우고 다시 시작"
  activate "$REV"
  if restart_and_check; then
    echo "$(date -Is) $REV" | sudo tee -a "$HISTORY" >/dev/null
    # 오래된 버전은 최근 KEEP개만 남긴다 (지금 버전과 바로 전 버전은 지우지 않는다).
    for dir in "$RELEASES" "$WEB_RELEASES"; do
      sudo ls -1t "$dir" | grep -vx -e "$REV" -e "$PREV" | tail -n +"$KEEP" | while read -r old; do sudo rm -rf -- "${dir:?}/$old"; done
    done
    echo "배포했습니다: $REV  (되돌리기: deploy/server-up.sh --rollback)"
    exit 0
  fi

  echo "새 버전이 응답하지 않습니다. 이전 버전($PREV)으로 되돌립니다." >&2
  if [[ "$PREV" != "none" && -d "$RELEASES/$PREV" && -d "$WEB_RELEASES/$PREV" ]]; then
    activate "$PREV"
    if restart_and_check; then
      echo "이전 버전으로 되돌렸습니다. 새 버전의 로그를 확인하세요: journalctl -u tagger-api -n 80 --no-pager" >&2
    else
      echo "이전 버전도 응답하지 않습니다. 로그를 확인하세요: journalctl -u tagger-api -n 80 --no-pager" >&2
    fi
  fi
  exit 1
}

main "$@"
exit $?
