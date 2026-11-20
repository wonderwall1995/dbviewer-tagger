#!/usr/bin/env bash
# 입장 코드 관리. 서비스와 같은 사용자(tagger)와 같은 설정(/etc/tagger/tagger.env)으로 관리 명령을 실행한다.
#   deploy/tagger-admin.sh set-code [--days N]   새 입장 코드 (기본 60일). 코드는 이때 한 번만 보여 준다
#   deploy/tagger-admin.sh status                 코드가 있는지, 언제 만료되는지
#   deploy/tagger-admin.sh revoke                 코드를 지워 새 입장을 막는다
# 코드를 바꿔도 서비스를 다시 시작할 필요는 없다.
set -euo pipefail

if [[ ! -f /opt/tagger/tagger-admin.js ]]; then
  echo "/opt/tagger/tagger-admin.js 가 없습니다. deploy/server-up.sh 를 먼저 실행하세요." >&2
  exit 1
fi

# 설정 파일의 KEY=VALUE 줄만 환경 변수로 넘긴다 (주석과 빈 줄은 뺀다).
mapfile -t ENV_LINES < <(sudo grep -E '^[A-Z_]+=' /etc/tagger/tagger.env)
exec sudo -u tagger env "${ENV_LINES[@]}" /usr/bin/node /opt/tagger/tagger-admin.js "$@"
