#!/usr/bin/env bash
# 처음 한 번만 실행한다: 이 서버에 DBViewer-tagger Web을 올릴 자리를 만든다.
#   사용법: deploy/setup-server.sh <도메인>
# 하는 일 (여러 번 실행해도 안전하다):
#   1. 자원 점검 결과를 보여 준다 (메모리, 디스크)
#   2. 전용 사용자 tagger 를 만든다 (로그인 불가, sudo 없음)
#   3. /opt/tagger(서버 파일), /var/www/tagger(화면), /var/lib/tagger(데이터), /etc/tagger(설정)를 만든다
#   4. systemd 서비스와 Nginx 사이트를 설치한다 (서비스 시작은 server-up.sh 가 한다)
# 하지 않는 일: 인증서 발급(certbot), 입장 코드 만들기, 보안 그룹 변경. 끝에 다음 할 일을 알려 준다.
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "사용법: $0 <도메인>   (예: $0 tagger.example.com)" >&2
  exit 1
fi
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
sudo install -d -o root -g root -m 0755 /opt/tagger /var/www/tagger /etc/tagger
sudo install -d -o tagger -g www-data -m 0700 /var/lib/tagger
if [[ ! -f /etc/tagger/tagger.env ]]; then
  sudo install -o root -g tagger -m 0640 "$DEPLOY_DIR/tagger.env.example" /etc/tagger/tagger.env
  echo "/etc/tagger/tagger.env 를 만들었습니다 (비밀 값 없음)"
else
  echo "/etc/tagger/tagger.env 는 이미 있어 그대로 둡니다"
fi
# 화면 폴더가 비어 있으면 Nginx의 try_files가 500을 낸다. 첫 배포 전까지 안내 페이지를 둔다.
if [[ ! -f /var/www/tagger/index.html ]]; then
  echo '<!doctype html><meta charset="utf-8"><title>준비 중</title><p>준비 중입니다.</p>' | sudo tee /var/www/tagger/index.html >/dev/null
fi

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

cat <<EOF

설치 자리를 만들었습니다. 다음 순서로 진행하세요.
  1. 배포:            deploy/server-up.sh
  2. 입장 코드:        deploy/tagger-admin.sh set-code
  3. HTTPS:           sudo certbot --nginx -d $DOMAIN
  4. 확인:            curl -I https://$DOMAIN
EOF
