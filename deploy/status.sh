#!/usr/bin/env bash
# 서버 상태를 한눈에 보여 준다. 아무것도 바꾸지 않는다.   (pnpm server:status)
set -uo pipefail

if ! systemctl cat tagger-api >/dev/null 2>&1; then
  echo "tagger-api 서비스가 없습니다. 이 서버에서 pnpm server:setup <도메인> 을 먼저 실행하세요."
  exit 1
fi

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
domain="$(cat /etc/tagger/domain 2>/dev/null || true)"
ok() { [[ "$1" == 0 ]] && echo "정상" || echo "응답 없음"; }

echo "주소         : ${domain:+https://$domain}${domain:-(모름: pnpm server:setup <도메인> 을 한 번 실행하세요)}"
echo "서비스       : $(systemctl is-active tagger-api)"

rev="$(basename "$(readlink -f /opt/tagger/current 2>/dev/null)" 2>/dev/null)"
subject="$(git -C "$REPO" log -1 --format=%s "$rev" 2>/dev/null || true)"
echo "지금 버전    : ${rev:-없음}${subject:+  ($subject)}"

sudo curl -fsS --max-time 3 --unix-socket /run/tagger/tagger.sock http://localhost/api/health >/dev/null 2>&1
echo "서버 응답    : $(ok $?)"
if [[ -n "$domain" ]]; then
  curl -fsS --max-time 5 "https://$domain/api/health" >/dev/null 2>&1
  echo "HTTPS 응답   : $(ok $?)"
fi

sessions="$(sudo find /var/lib/tagger/sessions -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)"
echo "면접관 세션  : ${sessions}개 (들어와 있는 사람 수)"

if [[ -f /opt/tagger/current/tagger-admin.js ]]; then
  echo "입장 코드    : $(bash "$REPO/deploy/tagger-admin.sh" status 2>/dev/null | sed 's/^입장 코드: //')"
fi

echo "최근 배포    :"
sudo tail -n 3 /var/lib/tagger/deploy-history.log 2>/dev/null | sed 's/^/  /' || echo "  (기록 없음)"

echo "메모리       : $(free -m | awk '/^Mem:/ {print "사용 가능 " $7 "MB / 전체 " $2 "MB"}')"
echo "디스크       : $(df -h / | awk 'NR==2 {print "남은 공간 " $4 " / 전체 " $2}')"
