# DBViewer-tagger

DB와 CSV를 탐색하고, 제품별 Key의 의미와 관계를 정리하여 Context Enrichment Docs(CED)를 작성하는 도구입니다.

같은 화면과 로직을 두 가지로 씁니다.

| | 데스크톱 앱 (Electron) | Web 체험판 |
|---|---|---|
| 대상 | 내 PC에서 실제 작업 | 면접관이 브라우저로 써 보기 |
| 데이터 | 내 PC의 작업 폴더 | 들어올 때마다 견본 데이터의 복사본. 24시간 쓰지 않거나 서버를 다시 시작하면 지워짐 |
| 입장 | 없음 | 공용 입장 코드 |
| DB 연결 | 직접 연결, SSH 터널 | 공인 주소의 DB만, 읽기 전용, SSH 터널 없음 |
| CED | Local 저장(폴더 선택), Obsidian Vault 전송 | Local 저장 = 화면에서 보기 + zip 내려받기 |
| Hermes 연결 | 있음 | 없음 |

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 화면 | React 18 + Vite (`packages/ui`) |
| 로직 | TypeScript, Electron과 HTTP를 모름 (`packages/core`) |
| 데스크톱 | Electron 30 + electron-builder (`apps/desktop`) |
| Web 서버 | Node 22 기본 `http`, esbuild로 파일 하나로 묶음 (`apps/server`) |
| DB | PostgreSQL (`pg`), SSH 터널 (`ssh2`) |
| CSV | PapaParse |
| 패키지 관리 | pnpm 12 워크스페이스 (의존성 끌어올림 `shamefullyHoist`) |

---

# DBViewer-tagger, DB 기반 LLM 맥락 문서 작성 도구

DB 테이블 스냅샷 기반 DB 컬럼 대상 정보 색인, DB Key 정보 작성, 문서화 및 LLM 맥락 문서 작성, Hermes Agent - Obsidian 환경 전송

| 구분 | 링크 |
|---|---|
| GitHub Repo (이 저장소) | https://github.com/wonderwall1995/dbviewer-tagger |
| 배포 주소 | https://dbtagger.hwk-resume.web.chickenkiller.com/ |
| 이력서 | https://resume-hwk.ltwayne0.workers.dev/main |

## 시연 코드

**63PB-6HPM-R5KK** <<< 시연 웹을 **체험할 경우 필요한 공통 코드**입니다.

<!-- 실행 방법, 기술 스택, 폴더 구조 같은 안내는 이 아래에 직접 채운다. -->

## 문제 프레임

재직 중 사내 서비스 중에서 디자인을 공통으로 사용하는 시스템 자체는 있었으나,
**동물병원 및 의료 차트 도메인** 측면에서 사용되는 **도메인 용어**에 대한 시스템은 없다는 점을 확인.
이런 니즈가 OJT 문서 그리고 기획 명세를 이해하는 데 필요하다고 판단되어 구축하는 중, 사내 DB에서 개별 Table이 가진 값이 도메인 용어나 다름없다는 점에서 개별 값에 대한 의미, 의도, 작동 방식 그와 같은 **정보를 문서 중앙화하는 작업**을 할 수 있게끔 본 프로젝트를 시작하게 되었습니다.

## 설계

DB 컬럼 자체가 일종의 도메인 용어라는 점에 착안하여 DB 스냅샷을 CSV로 불러오는 방식을 채택했습니다. **개별 컬럼에 대한 설명을 User가 직접 작성하여 .JSON으로 파싱하고, 파일을 모아 일종의 백과를 만듭니다.** 어떤 스키마 - 테이블에 쓰였는지, 따로 기획 명세 키워드, 값 의미에 대해서 작성하는 구조로 작성 구조가 단순합니다.

User는 이를 통해 DB에서 발췌한 용어들로 하여금 OJT 문서를 만드는 것부터 LLM에게 작업 전 참조시킬 수 있을 제품 도메인 용어에 대한 참조 문서를 좀 더 쉽게 만들 수 있는 환경을 갖습니다.

시연된 내용은 이러한 CED(Context Enrichment Docs)를 Local로 다운로드 받는 기능만 있지만,
**의도로는 CED를 Hermes와 연동된 Obsidian Vault로 보내는 것을 상정**합니다.
\*시연에 따른 몇 가지 기능들은 일부러 비활성화시킨 상태입니다.

(CED를 받아 쓰는 쪽: hermes-ced-taker, https://github.com/wonderwall1995/hermes-ced-taker)

## 아쉬운 점

아쉬운 점은 본 프로젝트가 완성되기 직전 퇴사하여 다른 인원의 평가나 피드백을 받지 못한 점입니다.
추가로 UI 설계에서 Datagrid 이외, 기능 확장성의 여지를 남겨 두었으면 하는 아쉬운 점이 있습니다.

## 회고 (KPT)

### Keep
- 본 프로젝트로 하여금 Glue Work를 쉽게 할 수 있다는 자신이 생겼습니다.
- 업무에 있어 자신에게 발생하는 니즈가 인사이트가 될 수 있음을 자각했습니다.

### Problem
- Electron App 실행을 최초 의도하여, 일부 기능에서의 Disabled가 필요했습니다.

### Try
- 본 프로젝트 기준으로 '프레임워크 단위'의 QA 프레임워크 발전 가능성을 모색해야겠습니다.
- Grafana, Hermes 보드, Pull Request의 Clone 형태 read-only 보드, etc를 상정해봅니다.

---

## 주요 기능

### CSV 탐색
- 로컬 파일과 PostgreSQL DB에서 CSV 불러오기
- 셀 단위 이슈 하이라이팅 (null · 빈값 · 타입 불일치 · ID 중복 · 의심값 · 포맷 이상)
- 컬럼별 타입 자동 추론 (`id` / `phone` / `email` / `date` / `boolean` / `number` / `text`)
- 컬럼 숨기기 · 너비 조정 · 파일별 필터링

### 시트 & 프리셋
- 멀티 시트 레이아웃: 시트별로 독립적인 파일 구성 저장
- 프리셋 저장 / 불러오기 / 삭제
- Local 설정, Keyinfo, Lorebook 백업 및 복원

### Keyinfo와 Key 노트
- 제품별 주요 컬럼 핀 고정 및 폴더 분류
- DB 스키마 연동: 타입 · PK / FK · 유니크 · NOT NULL · 역참조 자동 색인
- Key 자동 후보 제안, Key 노트 작성 (초안 / 확인 / 보류)
- 교차 제품 컬럼 관계 그룹 관리

### CED 작성
- 확인된 Key 노트로 제품 목차와 Key별 Markdown 문서를 만듭니다.
- **Local 저장:** 데스크톱은 정한 폴더(Keyinfo 창 머리글의 톱니)에 쓰고, Web은 화면에서 보여 주고 zip으로 내려받게 합니다.
- **Obsidian Vault 전송 (데스크톱):** Hermes 서버의 볼트로 보냅니다. 이 도구의 내용이 기준이라 볼트에서 고친 문서도 덮어쓰고 경고합니다.
- 목차 내용이 같으면 파일과 `generated` 시각을 유지하고, 바뀌면 갱신합니다.

### DB 연결
- 슬롯 4개(DB1~DB4). 슬롯마다 접속 정보, 저장 폴더 이름, SSL/TLS(서버 인증서 확인), SSH 터널(데스크톱)을 둡니다.
- 스키마 · 테이블 탐색과 CSV 내보내기 (진행률 표시, 중단 가능)
- 내보내기는 테이블마다 읽기 전용 스냅샷 트랜잭션 안에서 커서로 읽고, 임시 파일에 다 쓴 뒤 바꿔 끼웁니다. 실패하거나 중단해도 이전에 받은 CSV는 남습니다.

### Lorebook (컬럼 주석)
- CSV 파일 · 컬럼 단위 주석 작성 및 관리
- 카테고리 분류, 일괄 생성 지원

### Hermes 연결 (데스크톱)
- Hermes 서버의 대화 세션 보기 (읽기 전용)
- 프로필별 접속 주소와 SSH 터널

---

## 프로젝트 구조

```
apps/
  desktop/   @tagger/desktop   Electron main·preload. core를 IPC로 연결하고 데스크톱 전용 기능을 둔다
  server/    @tagger/server    Web API 서버. core를 HTTP로 연결하고 면접관(세션)마다 작업 폴더를 나눈다
packages/
  core/      @tagger/core      로직. Electron도 HTTP도 모른다 (파일, CSV, Keyinfo, CED, DB)
  ui/        @tagger/ui        화면. 데스크톱과 Web이 같은 빌드를 쓴다 (api.ts가 실행 환경을 고른다)
  shared/    @tagger/shared    공용 데이터 타입
deploy/      Web 서버 배포 스크립트와 설정 견본 (deploy/README.md)
samples/     Web 견본 작업 폴더 (가짜 데이터)
scripts/     시험(node:test)과 견본 생성 스크립트
```

화면은 `TaggerApi` 약속 하나로 로직을 부릅니다. 데스크톱은 preload(IPC)로, Web은 HTTP(`POST /api/call/<채널>`)로 같은 약속을 구현합니다.

---

## 명령

| 명령 | 하는 일 |
|---|---|
| `pnpm install` | 의존성 설치 |
| `pnpm dev` | 데스크톱 앱 개발 실행 |
| `pnpm dev:web` | Web 개발 실행 (http://localhost:6200, 입장 코드 없이 열림) |
| `pnpm build` | 화면과 데스크톱 빌드 |
| `pnpm build:web` | 화면과 Web 서버 빌드 |
| `pnpm typecheck` | 화면 타입 검사 |
| `pnpm test` | 빌드 후 전체 시험 |
| `pnpm dist:win` / `pnpm dist:mac` | 데스크톱 설치본 (`release/`) |

Web 서버 배포는 [deploy/README.md](deploy/README.md)를 봅니다.

---

## 로컬 데이터 저장 위치 (데스크톱)

CSV, 프리셋, 키 문서는 **작업 폴더**에 저장됩니다.

- 설치한 앱은 처음 실행할 때 작업 폴더를 정하게 안내합니다. 기본값은 `문서\DBViewer-tagger`입니다.
- 작업 폴더는 사이드바의 작업 폴더 버튼에서 확인하고 바꿀 수 있습니다. 바꾸면 화면이 새로고침되며 바로 적용됩니다. 기존 파일은 새 폴더로 옮겨지지 않습니다.
- 개발 모드에서 따로 정하지 않으면 저장소 루트를 사용합니다 (`.gitignore` 처리됨).
- DB 접속 정보(비밀번호 포함)는 작업 폴더가 아니라 앱 데이터 폴더에 암호화되어 저장됩니다.

```
작업 폴더/
├── DB-downloads/          # DB에서 내려받은 CSV (DB 폴더 / 스키마 폴더 / 테이블 CSV)
├── S3-downloads/          # 파일 선택으로 연 CSV의 복사본 (local-downloads). 폴더 이름은 옛 이름 그대로
├── local/
│   ├── presets/           # 저장된 프리셋, 시트 설정
│   ├── product/           # 제품 설정
│   └── tmp/               # 캐시
├── docs/
│   ├── lorebook/          # 컬럼 주석 파일
│   └── keyinfo/           # Keyinfo 문서
├── CED/                   # Local 저장의 기본 폴더
└── backups/               # Local 설정, Keyinfo, Lorebook 백업
```

---

## CSV 형식

DB에서 내보낸 CSV는 머리글 다음에 두 줄을 더 둡니다.

- **제약 행:** `[PK]`, `[FK→표.열]`, `[NN]` 등
- **타입 행:** `{integer}`, `{timestamp}` 등

이 두 줄은 `DB-downloads/` 아래의 파일에서만 찾습니다. 다른 CSV는 첫 행이 `{…}`나 `[…]` 모양이어도 데이터로 읽습니다.

| 값 | 쓰는 방법 |
|---|---|
| NULL | 빈 칸 (빈 문자열과 구분하지 않음) |
| 날짜·시간 | DB가 준 글자 그대로 |
| JSON, 배열 | JSON 글자 |
| 바이너리 | `\x` + 16진수 |
| `=`, `+`로 시작하는 값 | 그대로 둠. 스프레드시트 프로그램으로 열면 수식으로 해석될 수 있음 |

---

## 글꼴

글꼴은 모두 앱에 포함되어 있어서 PC마다 다르게 보이지 않습니다.

| 용도 | 글꼴 | 라이선스 |
|---|---|---|
| 화면 전체 | Pretendard (`pretendard` 패키지) | SIL OFL 1.1 |
| 데이터 그리드, 경로, 코드 | JetBrains Mono (`@fontsource-variable/jetbrains-mono` 패키지) | SIL OFL 1.1 |
| 앱 제목 | Pixelify Sans (`@fontsource-variable/pixelify-sans` 패키지) | SIL OFL 1.1 |

JetBrains Mono에 없는 글자(한글 등)는 Pretendard로 표시됩니다.
저작권 문구와 라이선스 전문은 [FONT-LICENSES.md](FONT-LICENSES.md)에 있으며, 설치본에도 함께 들어갑니다.

---

## 알려진 제한

- **설치본에 코드 서명이 없습니다.** Windows는 SmartScreen, macOS는 Gatekeeper 경고가 뜹니다.
- **데스크톱:** 운영체제의 암호화 저장소를 쓸 수 없는 환경(키링이 없는 Linux 등)에서는 DB 접속 정보가 암호화되지 않습니다. 직접 SSH 접속은 서버 호스트 키를 확인하지 않습니다.
- **Electron 30과 Vite 5는 지원이 끝난 버전입니다.** 올리는 작업은 따로 계획합니다.
- **Web 체험판:** 세션 데이터는 서버를 다시 시작하거나 24시간 쓰지 않으면 지워집니다. 개인 계정과 작업 보존은 없습니다.
