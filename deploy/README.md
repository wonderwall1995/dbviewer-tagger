# Web 배포 (EC2, Ubuntu)

DBViewer-tagger의 Web을 서버 한 대(Ubuntu, Nginx, Node 22)에 올리는 방법입니다. 데스크톱 설치본은 이 문서와 상관없습니다 (`pnpm dist:win`, `pnpm dist:mac`).

- 서버에서 스크립트 하나(`deploy/server-up.sh`)로 배포합니다. GitHub Actions와 Release는 쓰지 않습니다.
- main에 병합된 코드만 배포됩니다. 브랜치는 PR로 main에 병합합니다.
- 이 저장소는 공개입니다. 서버 주소, 도메인, 키는 이 저장소에 쓰지 않습니다.

## 서버에 놓이는 것

| 위치 | 내용 | 주인 |
|---|---|---|
| `~/projects/tagger` | 이 저장소 (빌드하는 곳) | ubuntu |
| `/opt/tagger` | 서버 파일 2개 (`tagger-server.js`, `tagger-admin.js`) | root, 읽기 전용 |
| `/var/www/tagger` | 화면 파일 | root, 읽기 전용 |
| `/var/lib/tagger` | 면접관 세션 폴더, 입장 코드(해시), 견본 데이터, 배포 기록 | tagger, 0700 |
| `/etc/tagger/tagger.env` | 설정 (비밀 값 없음) | root:tagger, 0640 |
| `/run/tagger/tagger.sock` | Nginx ↔ 서버 연결 (소켓 파일) | tagger:www-data |

서비스(`tagger-api`)는 sudo가 없는 전용 사용자 `tagger`로 돕니다. 홈 폴더를 볼 수 없고, 루프백·사설망·클라우드 메타데이터 주소로 나가는 연결이 막혀 있습니다. TCP 포트를 열지 않으므로 보안 그룹은 바꿀 것이 없습니다.

## 처음 한 번

1. **하위 도메인**의 A 레코드가 서버 IP를 가리키게 합니다.
2. 서버에서 저장소를 받습니다.
   ```bash
   mkdir -p ~/projects && cd ~/projects
   git clone https://github.com/wonderwall1995/dbviewer-tagger.git tagger
   cd tagger
   ```
3. 설치 자리를 만듭니다. (전용 사용자, 폴더, 서비스, Nginx 사이트)
   ```bash
   deploy/setup-server.sh <도메인>
   ```
4. 첫 배포를 합니다.
   ```bash
   deploy/server-up.sh
   ```
5. 입장 코드를 만듭니다. 코드는 이때 **한 번만** 보입니다. 면접관에게 이 코드를 건넵니다.
   ```bash
   deploy/tagger-admin.sh set-code          # 기본 60일
   ```
6. HTTPS를 붙입니다. "HTTP를 HTTPS로 돌려보낼지" 물으면 돌려보내는 쪽을 고릅니다.
   ```bash
   sudo certbot --nginx -d <도메인>
   ```

## 배포할 때마다

```bash
cd ~/projects/tagger && deploy/server-up.sh
```

main을 받아 빌드하고, 서버 파일과 화면을 바꾼 뒤 서비스를 다시 시작합니다. 다시 시작하는 동안 몇 초 끊깁니다. 이때 들어와 있던 면접관의 세션은 사라집니다 (세션은 메모리에만 있습니다).

## 되돌리기

```bash
sudo cat /var/lib/tagger/deploy-history.log      # 배포에 성공한 커밋 목록
deploy/server-up.sh <이전 커밋>                   # 그 커밋으로 배포
```

다음에 인자 없이 실행하면 다시 main의 최신 커밋을 배포합니다.

## 입장 코드

```bash
deploy/tagger-admin.sh status                   # 있는지, 언제 만료되는지
deploy/tagger-admin.sh set-code --days 30       # 새 코드 (이전 코드는 바로 못 씀)
deploy/tagger-admin.sh revoke                   # 새 입장을 막음
```

서비스를 다시 시작할 필요는 없습니다.

## 확인과 로그

```bash
systemctl status tagger-api --no-pager
journalctl -u tagger-api -n 50 --no-pager
curl -s --unix-socket /run/tagger/tagger.sock http://localhost/api/health
sudo tail -n 30 /var/log/nginx/error.log
```

## 설정 (`/etc/tagger/tagger.env`)

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `TAGGER_MAX_SESSIONS` | 10 | 동시에 들어올 수 있는 면접관 수 |
| `TAGGER_SESSION_MB` | 200 | 면접관 한 명이 쓸 수 있는 디스크 |
| `TAGGER_SESSION_IDLE_HOURS` | 24 | 이 시간 동안 쓰지 않으면 세션을 지움 |
| `TAGGER_UPLOAD_MB` | 20 | CSV 한 개의 최대 크기 (Nginx는 25MB까지 넘겨줌) |

바꾼 뒤에는 `sudo systemctl restart tagger-api`.
