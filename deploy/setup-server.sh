#!/usr/bin/env bash
# 처음 한 번만 실행한다: 이 서버에 DBViewer-tagger Web을 올릴 자리를 만든다.
#   사용법: deploy/setup-server.sh <도메인>     (pnpm server:setup <도메인>)
#           deploy/setup-server.sh              지난번 도메인을 다시 쓴다 (/etc/tagger/domain)
# 하는 일 (여러 번 실행해도 안전하다):
#   1. 자원 점검 결과를 보여 준다 (메모리, 디스크)
#   2. 전용 사용자 tagger 를 만든다 (로그인 불가, sudo 없음)
#   3. /opt/tagger/releases(서버 파일, 버전별), /var/www/tagger-releases(화면, 버전별), /var/lib/tagger(데이터), /etc/tagger(설정)를 만든다
#   4. systemd 서비스와 Nginx 사이트를 설치한다 (서비스 시작은 server-up.sh 가 한다)
# 하지 않는 일: 인증서 발급(certbot), 보안 그룹 변경. 끝에 다음 할 일을 알려 준다.
set -euo pipefail

DOMAIN="${1:-}"
# 도메인을 안 넣으면 지난번에 쓴 도메인을 쓴다. 기록이 없으면 지금 Nginx 사이트의 이름을 읽는다.
if [[ -z "$DOMAIN" ]]; then
  DOMAIN="$(cat /etc/tagger/domain 2>/dev/null || true)"
fi
if [[ -z "$DOMAIN" && -f /etc/nginx/sites-available/tagger ]]; then
  DOMAIN="$(grep -m1 -oP 'server_name\s+\K[^; ]+' /etc/nginx/sites-available/tagger || true)"
  [[ "$DOMAIN" == "tagger.local" || "$DOMAIN" == "localhost" ]] && DOMAIN=""
fi
if [[ -z "$DOMAIN" ]]; then
  echo "사용법: $0 <도메인>   (예: $0 tagger.example.com)" >&2
  exit 1
fi
# https:// 나 끝의 / 를 붙여 넣어도 이름만 쓴다.
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%/*}"
echo "도메인: $DOMAIN"
if [[ ! "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "도메인에 쓸 수 없는 글자가 있습니다: $DOMAIN" >&2
  exit 1
fi
if [[ "$(uname -s)" != "Linux" ]] || ! command -v systemctl >/dev/null; then
  echo "이 스크립트는 systemd를 쓰는 Linux 서버에서만 실행합니다." >&2
  exit 1
fi
if [[ "$(id -u)" -eq 0 ]]; then
  echo "root로 실행하지 마세요. 일반 사용자(sudo 가능)로 실행합니다." >&2
  exit 1
fi
for cmd in nginx node rsync curl; do
  command -v "$cmd" >/dev/null || { echo "$cmd 가 없습니다. 먼저 설치하세요." >&2; exit 1; }
done
if [[ "$(command -v node)" != "/usr/bin/node" ]]; then
  echo "주의: node 경로가 /usr/bin/node 가 아닙니다 ($(command -v node)). tagger-api.service 의 ExecStart 를 맞춰 주세요." >&2
fi

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "== 1. 자원 점검"
free -m
df -h /
echo "(available 메모리가 600MB 아래이거나 스왑을 많이 쓰고 있으면 올리지 않는 것이 좋습니다)"

echo "== 2. 전용 사용자 tagger"
if id tagger >/dev/null 2>&1; then
  echo "이미 있음"
else
  sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin tagger
  echo "만듦"
fi

echo "== 3. 폴더"
sudo install -d -o root -g root -m 0755 /opt/tagger /opt/tagger/releases /var/www/tagger-releases /etc/tagger
sudo install -d -o tagger -g www-data -m 0700 /var/lib/tagger
if [[ ! -f /etc/tagger/tagger.env ]]; then
  sudo install -o root -g tagger -m 0640 "$DEPLOY_DIR/tagger.env.example" /etc/tagger/tagger.env
  echo "/etc/tagger/tagger.env 를 만들었습니다 (비밀 값 없음)"
else
  echo "/etc/tagger/tagger.env 는 이미 있어 그대로 둡니다"
fi
# 버전별 폴더 + 링크 구조. /var/www/tagger 와 /opt/tagger/current 는 지금 버전을 가리키는 링크다.
# 예전 방식으로 만든 진짜 폴더가 있으면 첫 버전(initial)으로 옮긴다.
if [[ -d /var/www/tagger && ! -L /var/www/tagger ]]; then
  sudo mv /var/www/tagger /var/www/tagger-releases/initial
fi
# 화면 폴더가 비어 있으면 Nginx의 try_files가 500을 낸다. 첫 배포 전까지 안내 페이지를 둔다.
sudo install -d -o root -g root -m 0755 /var/www/tagger-releases/initial /opt/tagger/releases/initial
if [[ ! -f /var/www/tagger-releases/initial/index.html ]]; then
  echo '<!doctype html><meta charset="utf-8"><title>준비 중</title><p>준비 중입니다.</p>' | sudo tee /var/www/tagger-releases/initial/index.html >/dev/null
fi
[[ -e /var/www/tagger ]] || sudo ln -s /var/www/tagger-releases/initial /var/www/tagger
[[ -e /opt/tagger/current ]] || sudo ln -s /opt/tagger/releases/initial /opt/tagger/current

echo "== 4. systemd 서비스"
sudo install -o root -g root -m 0644 "$DEPLOY_DIR/tagger-api.service" /etc/systemd/system/tagger-api.service
sudo systemctl daemon-reload
sudo systemctl enable tagger-api >/dev/null
echo "tagger-api 를 등록했습니다 (시작은 server-up.sh 가 합니다)"

echo "== 5. Nginx"
sudo install -o root -g root -m 0644 "$DEPLOY_DIR/nginx-tagger-ratelimit.conf" /etc/nginx/conf.d/tagger-ratelimit.conf
if [[ -f /etc/nginx/sites-available/tagger ]] && grep -q "listen 443" /etc/nginx/sites-available/tagger; then
  echo "사이트 설정에 이미 HTTPS(certbot)가 들어 있어 덮어쓰지 않습니다"
else
  sed "s/__DOMAIN__/$DOMAIN/g" "$DEPLOY_DIR/nginx-tagger.conf" | sudo tee /etc/nginx/sites-available/tagger >/dev/null
fi
sudo ln -sfn /etc/nginx/sites-available/tagger /etc/nginx/sites-enabled/tagger
sudo nginx -t
sudo systemctl reload nginx
# 다음에 도메인 없이 실행해도 같은 도메인을 쓰도록 기록한다. (pnpm server:status 도 이 값을 쓴다)
echo "$DOMAIN" | sudo tee /etc/tagger/domain >/dev/null

cat <<EOF

설치 자리를 만들었습니다. 다음 순서로 진행하세요.
  1. 배포:            pnpm server:up
  2. HTTPS:           sudo certbot --nginx -d $DOMAIN
  3. 확인:            pnpm server:status
EOF
