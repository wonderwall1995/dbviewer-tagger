# CSV Inspector

CSV 파일 품질 검사에서 출발해, 제품별 작업공간 관리 · 커스텀 테이블 빌더 · DB 직접 연결 · AI 어시스턴트까지 갖춘 종합 데이터 워크스페이스로 발전했습니다.

---

## 기술 스택

| 영역 | 기술 |
|---|---|
| 런타임 | Electron 30 + TypeScript |
| 렌더러 | React 18 + Vite |
| 패키지 매니저 | pnpm |
| CSV 파싱 | PapaParse |
| UI 컴포넌트 | lucide-react, sonner (토스트) |
| 배포 | electron-builder |

---

## 주요 기능

### CSV 검수
- 로컬 파일과 PostgreSQL DB에서 CSV 불러오기
- 셀 단위 이슈 하이라이팅 (null · 빈값 · 타입 불일치 · ID 중복 · 의심값 · 포맷 이상)
- 컬럼별 타입 자동 추론 (`id` / `phone` / `email` / `date` / `boolean` / `number` / `text`)
- 컬럼 숨기기 · 너비 조정 · 파일별 필터링

### 시트 & 프리셋
- 멀티 시트 레이아웃 — 시트별로 독립적인 파일 구성 저장
- 프리셋 저장 / 불러오기 / 삭제
- 작업공간 전체 스냅샷 백업 및 복원

### Keyinfo (키 컬럼 스키마)
- 제품별 주요 컬럼 핀 고정 및 폴더 분류
- DB 스키마 연동: 타입 · PK / FK · 유니크 · NOT NULL · 역참조 자동 색인
- 교차 제품 컬럼 관계 그룹 관리

### 커스텀 테이블 (Product Viewer)
- CSV 파일과 Keyinfo 키를 조합해 사용자 정의 비교 테이블 구성
- 자동 저장 (autosave) + 수동 저장 + 복원 기능
- 전체보기 버튼으로 독립 Electron 창에서 Product Viewer 실행

### DB 연결
- SSH 터널을 통한 PostgreSQL 연결 (dev / prod 환경 분리)
- 스키마 · 테이블 탐색 및 CSV 내보내기 (스트리밍 진행 표시)

### Lorebook (컬럼 주석)
- CSV 파일 · 컬럼 단위 주석 작성 및 관리
- 카테고리 분류, 일괄 생성 지원

### Hermes (AI 어시스턴트)
- 내장 AI 채팅 인터페이스 (세션 관리, 스트리밍 응답)
- 외부 Hermes API 서버와 연동

---

## 프로젝트 구조

```
src/
├── main/
│   ├── main.ts        # BrowserWindow 생성, 전체 IPC 핸들러
│   └── preload.ts     # contextBridge — renderer ↔ main 브릿지
└── renderer/
    ├── main.tsx        # 렌더러 진입점 (URL 파라미터로 창 분기)
    ├── App.tsx         # 메인 앱 레이아웃
    ├── styles.css      # 전역 스타일
    ├── electron.d.ts   # window.electronAPI 타입 선언
    └── components/
        ├── DataGrid.tsx              # CSV 테이블 뷰 + 이슈 하이라이팅
        ├── Sidebar.tsx               # 파일 목록, 필터, 검색
        ├── ProductViewer.tsx         # 커스텀 테이블 빌더 + 폴더 뷰어
        ├── ProductViewerWindow.tsx   # Product Viewer 독립 창 래퍼
        ├── KeyinfoModal.tsx          # Keyinfo 관리 모달
        ├── LorebookModal.tsx         # Lorebook 조회/편집 모달
        ├── HermesModal.tsx           # AI 채팅 모달
        ├── BackupModal.tsx           # 백업 관리 모달
        ├── LocalFilesBrowser.tsx     # 로컬 다운로드 파일 탐색기
        └── ...                       # 기타 모달 및 유틸 컴포넌트
```

### IPC 채널 네임스페이스

| 네임스페이스 | 기능 |
|---|---|
| `local:*` | 로컬 파일 저장/로드, 프리셋, 다운로드 관리 |
| `db:*` | PostgreSQL 연결, 스키마/테이블 조회, CSV 내보내기 |
| `ssh:*` | SSH 터널 설정 관리 |
| `sheet:*` | 멀티 시트 레이아웃 저장/로드 |
| `keyinfo:*` | 키 컬럼 핀/폴더/관계 관리, DB 스키마 색인 |
| `customtable:*` | 커스텀 테이블 CRUD, 폴더 관리, 자동 저장/복원 |
| `lorebook:*` | 컬럼 주석 CRUD, 카테고리 관리 |
| `backup:*` | 작업공간 스냅샷 저장/복원/삭제 |
| `hermes:*` | Hermes 연결 설정과 세션 읽기 (읽기 전용) |
| `keynote:*` | Key 노트 저장, 자동 후보 제안, 수락과 거절 |
| `editor:*` | A/B 비교 에디터 템플릿 관리 |
| `product:*` | 제품별 창 열기, 설정 관리 |
| `cache:*` | 파싱 캐시 저장/로드 |

---

## 로컬 데이터 저장 위치

CSV, 프리셋, 키 문서는 **작업 폴더**에 저장됩니다.

- 설치한 앱은 처음 실행할 때 작업 폴더를 정하게 안내합니다. 기본값은 `문서\DBViewer-tagger`입니다.
- 작업 폴더는 푸터의 `W` 버튼에서 확인하고 바꿀 수 있습니다. 바꾸면 화면이 새로고침되며 바로 적용됩니다. 기존 파일은 새 폴더로 옮겨지지 않습니다.
- 개발 모드에서 따로 정하지 않으면 프로젝트 폴더를 사용합니다 (`.gitignore` 처리됨).
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
└── backups/               # 작업공간 백업
```

---

## DB 접속 설정

DB 접속 정보는 .env가 아니라 앱 화면에서 입력합니다. DB 창에는 슬롯 4개(DB1~DB4)가 있습니다.
슬롯마다 이름, DB 호스트, 포트, DB 이름, 사용자, 비밀번호, SSH 터널(선택)을 저장합니다.
저장한 정보는 사용자 PC의 앱 데이터 폴더에 암호화되어 보관됩니다.

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

## 개발 실행

```bash
pnpm install
pnpm dev
```

## 빌드 / 패키징

```bash
pnpm dist          # 현재 플랫폼
pnpm dist:win      # Windows
pnpm dist:mac      # macOS
pnpm dist:linux    # Linux
```
