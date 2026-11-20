# Web 배포 (EC2, Ubuntu)

DBViewer-tagger의 Web을 서버 한 대(Ubuntu, Nginx, Node 22)에 올리는 방법입니다. 데스크톱 설치본은 이 문서와 상관없습니다 (`pnpm dist:win`, `pnpm dist:mac`).

- 서버에서 명령 하나(`pnpm server:up` = `deploy/server-up.sh`)로 배포합니다. GitHub Actions와 Release는 쓰지 않습니다.
- **main에 병합된 커밋만** 배포됩니다. 브랜치는 PR로 main에 병합하고, 병합 전에 개발 PC에서 `pnpm test`를 돌립니다. (서버는 시험을 돌리지 않고 빌드와 타입 검사만 합니다)
- 이 저장소는 공개입니다. 서버 주소, 도메인, 키는 이 저장소에 쓰지 않습니다.
- Web은 **체험판**입니다. 면접관은 공용 입장 코드로 들어오고, 작업은 24시간 쓰지 않거나 서비스를 다시 시작하면 지워집니다.

## 명령 (서버에서, 저장소 폴더 안에서)

| 명령 | 같은 스크립트 | 하는 일 |
|---|---|---|
| `pnpm server:setup <도메인>` | `deploy/setup-server.sh` | 처음 한 번: 전용 사용자, 폴더, 서비스, Nginx 사이트 |
| `pnpm server:up` | `deploy/server-up.sh` | main을 받아 빌드하고 배포 (응답 없으면 자동 되돌림) |
| `pnpm server:up <커밋>` | | main에 들어 있는 그 커밋으로 배포 |
| `pnpm server:rollback` | `deploy/server-up.sh --rollback` | 빌드 없이 바로 전 버전으로 |
| `pnpm server:code <set-code\|status\|revoke>` | `deploy/tagger-admin.sh` | 입장 코드 관리 |
| `pnpm server:status` | `deploy/status.sh` | 상태 한눈에 보기 (주소, 지금 버전, 응답, 세션 수, 입장 코드 만료, 메모리·디스크) |
| `pnpm server:logs` | | 서비스 로그 80줄 |
| `pnpm server:help` | `deploy/help.sh` | 이 명령 목록 |

- `pnpm server:setup`은 도메인을 기억합니다(`/etc/tagger/domain`). 두 번째부터는 도메인 없이 쳐도 됩니다.
- `pnpm server:up`은 main을 직접 받습니다. `git pull`을 따로 하지 않아도 됩니다. 받아 온 main에서 배포 스크립트가 바뀌었으면 새 스크립트로 스스로 다시 실행합니다.

- 처음 `pnpm`을 실행하면 corepack이 pnpm 12를 내려받을지 묻습니다. `Y`를 누릅니다. (묻지 않게 하려면 `export COREPACK_ENABLE_DOWNLOAD_PROMPT=0`)
- `pnpm` 명령은 실행 전에 패키지를 자동으로 설치하지 않습니다 (`pnpm-workspace.yaml`의 `verifyDepsBeforeRun: false`). 서버에는 `server:up`이 Web에 필요한 패키지만 설치합니다.

## 서버에 놓이는 것

| 위치 | 내용 | 주인 |
|---|---|---|
| `~/projects/tagger` | 이 저장소 (빌드하는 곳) | ubuntu |
| `/opt/tagger/releases/<커밋>/` | 서버 파일 2개 (`tagger-server.js`, `tagger-admin.js`) | root, 읽기 전용 |
| `/opt/tagger/current` | 지금 버전을 가리키는 링크 | root |
| `/var/www/tagger-releases/<커밋>/` | 화면 파일 | root, 읽기 전용 |
| `/var/www/tagger` | 지금 버전을 가리키는 링크 (Nginx root) | root |
| `/var/lib/tagger` | 면접관 세션 폴더, 입장 코드(해시), 견본 데이터, 배포 기록 | tagger, 0700 |
| `/etc/tagger/tagger.env` | 설정 (비밀 값 없음) | root:tagger, 0640 |
| `/run/tagger/tagger.sock` | Nginx ↔ 서버 연결 (소켓 파일) | tagger:www-data, 0660 |

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
   pnpm server:setup <도메인>
   ```
4. 첫 배포를 합니다.
   ```bash
   pnpm server:up
   ```
5. 입장 코드를 만듭니다. 코드는 이때 **한 번만** 보입니다. 면접관에게 이 코드를 건넵니다.
   ```bash
   pnpm server:code set-code              # 기본 60일
   ```
6. HTTPS를 붙입니다. "HTTP를 HTTPS로 돌려보낼지" 물으면 돌려보내는 쪽을 고릅니다. 운영 모드의 쿠키는 HTTPS에서만 보내지므로, **HTTPS를 붙이기 전에는 입장이 되지 않습니다.**
   ```bash
   sudo certbot --nginx -d <도메인>
   ```
7. 아래 **첫 배포 확인 목록**을 확인합니다.

## 배포할 때마다

PR을 main에 병합한 뒤, EC2의 저장소 폴더에서 이것 하나만 칩니다.

```bash
pnpm server:up
```

끝에 `배포했습니다: <커밋>`이 나오면 성공입니다. 확인은 `pnpm server:status`.

1. main을 받습니다.
2. Web에 필요한 패키지만 설치합니다 (Electron 제외).
3. 타입 검사와 빌드를 합니다.
4. 새 버전 폴더를 준비합니다.
5. 링크를 바꿔 끼우고 서비스를 다시 시작합니다.

다시 시작한 뒤에는 소켓으로 직접, 그리고 Nginx를 거쳐(HTTPS가 있으면 HTTPS로) 응답을 확인합니다. **응답이 없으면 자동으로 이전 버전으로 되돌립니다.** 다시 시작하는 동안 몇 초 끊기고, 그때 들어와 있던 면접관의 세션은 사라집니다 (세션은 메모리에만 있습니다).

## 되돌리기

```bash
pnpm server:rollback                             # 빌드 없이 바로 전 버전으로
sudo cat /var/lib/tagger/deploy-history.log      # 배포에 성공한 커밋 목록
pnpm server:up <커밋>                            # 그 커밋으로 다시 빌드해 배포 (main에 들어 있는 커밋만)
```

서버에는 최근 버전 몇 개만 남깁니다. 다음에 인자 없이 실행하면 다시 main의 최신 커밋을 배포합니다.

## 입장 코드

```bash
pnpm server:code status                       # 있는지, 언제 만료되는지
pnpm server:code set-code --days 30           # 새 코드 (이전 코드는 바로 못 씀)
pnpm server:code revoke                       # 새 입장을 막음
```

서비스를 다시 시작할 필요는 없습니다. 코드를 바꾸거나 지워도 **이미 들어와 있는 사람의 세션은 끝나지 않습니다.** 바로 내보내야 하면 `sudo systemctl restart tagger-api`로 모든 세션을 끝냅니다.

## 확인과 로그

```bash
systemctl status tagger-api --no-pager
journalctl -u tagger-api -n 50 --no-pager
sudo curl -s --unix-socket /run/tagger/tagger.sock http://localhost/api/health
sudo tail -n 30 /var/log/nginx/error.log
```

## 설정 (`/etc/tagger/tagger.env`)

| 이름 | 기본값 | 뜻 |
|---|---|---|
| `TAGGER_MAX_SESSIONS` | 10 | 동시에 들어올 수 있는 면접관 수 |
| `TAGGER_SESSION_MB` | 200 | 면접관 한 명이 쓸 수 있는 디스크. 넘으면 쓰기를 거절합니다 (요청 하나 크기만큼 넘을 수 있음) |
| `TAGGER_SESSION_IDLE_HOURS` | 24 | 이 시간 동안 쓰지 않으면 세션을 지움 |
| `TAGGER_UPLOAD_MB` | 20 | CSV 한 개의 최대 크기 (Nginx는 25MB까지 넘겨줌) |

바꾼 뒤에는 `sudo systemctl restart tagger-api`. 세션 수 × 세션 디스크(기본 10 × 200MB = 2GB)가 서버 디스크 여유보다 충분히 작아야 합니다.

## 첫 배포 확인 목록

설정 파일만 보고 적용됐다고 짐작하지 않고, 실제 서버에서 확인합니다.

- **서비스 권한**
  - `ps -o user,group -C node`가 `tagger www-data`인지 확인합니다.
  - `/opt/tagger/current`와 `/var/www/tagger`가 root 소유의 읽기 전용인지, `/var/lib/tagger`가 0700인지 봅니다.
  - `/run/tagger/tagger.sock`이 `tagger:www-data 0660`인지 봅니다.
- **나가는 연결 차단:** 서비스와 같은 조건에서 시험합니다.
  ```bash
  sudo systemd-run -p User=tagger -p IPAddressDeny="localhost link-local 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16" -p IPAddressAllow=127.0.0.53/32 --wait --pipe \
    /usr/bin/node -e "require('net').connect(5432,'127.0.0.1').on('error',e=>{console.log('막힘',e.code);process.exit(0)}).on('connect',()=>{console.log('뚫림');process.exit(1)})"
  ```
  - "막힘"이 나와야 합니다. `169.254.169.254:80`(메타데이터)도 같은 방법으로 확인합니다.
  - 공인 DB와 DNS(`node -e "require('dns').lookup('example.com',console.log)"`)는 되는지도 봅니다.
  - `IPAddressAllow=127.0.0.53/32`는 DNS 포트만이 아니라 **그 주소 전체**를 허용합니다. 그 주소에는 systemd-resolved만 떠 있어야 합니다(`sudo ss -ltnup | grep 127.0.0.53`).
- **클라우드:** IMDSv2 필수, 인스턴스 역할(IAM)은 최소 권한 또는 없음, 보안 그룹은 22(내 IP)/80/443만 엽니다. 디스크 여유와 로그 보존 기간도 봅니다.
- **프록시**
  - HTTPS 인증서와 HTTP → HTTPS 돌려보내기를 확인합니다.
  - 브라우저 개발자 도구에서 쿠키에 `Secure; HttpOnly`가 붙는지 봅니다.
  - 서로 다른 두 곳에서 입장할 때 실패 제한이 따로 걸리는지 확인합니다 (X-Real-IP 전달).
  - 업로드 20MB, 진행률 알림(SSE)이 끊기지 않는지, 1분 넘는 DB 내보내기가 끝까지 되는지 봅니다.
- **전체 흐름:** HTTPS 접속 → 입장 → 견본 CSV 열기 → 다른 브라우저에서 따로 입장해 서로 수정이 섞이지 않는지 → Key 노트 → Local 저장(zip 내려받기).
- **자원:** 면접관 몇 명이 동시에 쓸 때 `free -m`, `df -h /`, 같은 서버의 다른 서비스 응답을 봅니다.
- **복구:** 일부러 잘못된 커밋을 배포해 자동 되돌리기를 확인합니다. `--rollback`이 되는지도 봅니다.
