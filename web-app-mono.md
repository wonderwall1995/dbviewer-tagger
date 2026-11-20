# web-app-mono — LLM 작업 노트

**독자: LLM만.** User는 이 문서를 읽지 않는다 (User가 못박음, 2026-11-20). User에게 알릴 것은 채팅이나 `llms.md`로 한다.
**쓰는 법:** 땀수 놓듯이. 한 땀(작은 작업 하나) 하면 바로 "4. 땀 기록"에 한 줄, 알아낸 것이 있으면 "5. 우려 재점검"을 고친다.
**브랜치:** `feat/web-app-mono`

> 공개 저장소다. 서버 IP, 도메인, 키 경로, 비밀 값, 서버 구성 세부를 쓰지 않는다. 서버 정보는 저장소 밖 `../server-context.md`에만 있다. 규칙만 따르고 내용은 옮기지 않는다.

---

## 0. 세션 시작할 때

1. "4. 땀 기록"의 마지막 줄을 읽는다 → 어디까지 했고 다음이 무엇인지.
2. "3. 작업 목록"에서 지금 Stage의 첫 `[ ]`를 고른다.
3. 동작이 바뀌는 결정(User가 화면에서 느끼는 변화, 기능 제거)은 User에게 자연어로 묻는다. 그 밖의 구현 선택은 혼자 정하고 땀 기록에 이유를 남긴다.
4. 매 땀 뒤: typecheck · build · `node --test scripts/`. Stage 끝에는 데스크톱 수동 점검.
5. 커밋은 User가 하라고 할 때만. 그만둔 항목은 `[~] (Drop: 이유)`.

표시: `[ ]` 할 일 · `[x]` 끝 · `[~]` 그만둠 · `⏸` User 결정 필요 · `🔒` 보안

## 1. 합의한 순서 (2026-11-20)

| Stage | 내용 | 끝나는 조건 |
|---|---|---|
| **A** | Web–App 분리. 화면은 `TaggerApi`만 알고, 로직은 Electron 없는 core로. 데스크톱은 그대로 동작 | 데스크톱 수동 점검 통과 + 내 PC에서 Web 모드로 견본 CSV가 열림 |
| **B** | 웹 배포에서 문제를 일으키는 것을 **앱 코드 안에서** 대대적으로 고침 (안쪽 울타리) | "3-B"의 🔒 시험이 모두 통과 |
| **C** | 기록 옮기기: 역제안(6장) → `llms.md` Backlogs, User의 고민(7장) → `llms.md` To-do에 `[IMPORTANT]` | `llms.md` 반영 (User 허락 받음. 한 줄 작문, 보안 세부 금지) |
| **D** | User와 의논. 그 뒤 서버 배포·CI/Release·초대 코드·systemd 울타리를 정함 | — |

**Stage D 전에는 하지 않는다:** 서버 접속, 서버 설정 파일, GitHub Actions, 초대 코드/로그인, systemd 울타리. (6장 백로그에만 둔다)

## 2. 지금 상태 (코드에서 확인한 사실)

- 화면 ↔ main 연결은 [src/main/preload.ts](src/main/preload.ts)의 `window.electronAPI` 하나. 함수 약 77개 (invoke 75 + 진행률 구독).
- [src/main/main.ts](src/main/main.ts) 약 2,800줄. `// ── ... ──` 머리로 덩어리가 나뉨: 작업 폴더(20) · local(98) · 프리셋 · 파일 선택(255) · 다운로드(275) · 캐시(442) · CSV 통계(497) · Lorebook(670) · DB 슬롯(801) · Hermes(887) · CED 보내기(1106) · DB/SSH(1348) · Keyinfo(1886) · 백업(1998) · 연관 그룹(2028) · Key 노트(2044) · CED(2219) · 자동 후보(2333).
- Electron 없이 도는 파일: `cedIndex.ts`, `cedTransfer.ts`(의존성 주입), `sshAlias.ts`, `workspaceBackup.ts`. 시험은 `scripts/*.test.cjs`가 `dist/main/*.js`를 불러옴.
- Electron 전용: `dialog`, `shell`, `safeStorage`, `app.getPath`, `webContents.send`, 끌어다 놓기 `File.path`([App.tsx:986](src/renderer/App.tsx#L986)).
- 창은 하나 (`createWindow`). `contextIsolation: true`, `nodeIntegration: false`.
- `local:readFile`은 아무 절대 경로나 읽음. `local:deleteDownload`, `lorebook:*`는 경로 검사 있음.
- 작업 폴더가 **모듈 전역 `let DATA_ROOT`**와 거기서 만든 전역 경로들(`S3_DOWNLOADS_ROOT` 등)이다. → Web의 세션별 작업 폴더와 정면으로 충돌 (5장 참고).

## 3. 작업 목록

### 3-A. Web–App 분리

- [x] A0. 기준선: `pnpm install`, typecheck, build, 시험 결과 기록. 데스크톱 수동 점검 목록 만들기 (CSV 열기, 끌어다 놓기, DB 연결, Keyinfo, Lorebook, Key 노트, CED 생성, 백업).
- [x] A1. `TaggerApi` 타입 (preload 모양 그대로) + `electron.d.ts` 정리.
- [x] A2. 화면에 `api` 모듈. `window.electronAPI.x` → `api.x` 일괄 교체. 동작 변화 없음.
- [x] A3. `capabilities()` 추가. 환경별 버튼(작업 폴더 고르기, 폴더 열기, Hermes, SSH, CED 보내기)을 이 값으로 감쌈.
- [x] A4. 끌어다 놓기·파일 선택을 `api.importFiles(File[])`로 감쌈. 데스크톱은 `webUtils.getPathForFile`, Web은 업로드.
- [x] A5. 🔑 **작업 폴더 문맥(Workspace) 도입.** core 함수는 전역 `DATA_ROOT` 대신 `ws`(그 요청의 작업 폴더 경로 묶음)를 받는다. 데스크톱은 늘 같은 `ws` 하나, Web은 세션마다 다른 `ws`.
- [x] A6. `Platform` 주입: `secrets`(safeStorage 대체 가능), `emit`(진행률), `pickFile`/`openPath`(데스크톱만).
- [ ] A7. main.ts 덩어리를 core로 하나씩 옮김 (한 땀 = 한 덩어리): local/프리셋/다운로드 → 캐시/CSV 통계 → Lorebook → DB 슬롯 → DB/SSH → Keyinfo/연관/Key 노트/자동 후보 → CED/백업 → Hermes/CED 보내기(데스크톱 전용 쪽에 둠).
- [ ] A8. main.ts = 창 만들기 + IPC↔core 연결만. 데스크톱 수동 점검.
- [ ] A9. Web 서버 뼈대 (Express. D2는 이 초안으로 진행, Stage D에서 다시 봄): `127.0.0.1` 고정 포트, `/api/health`, `POST /api/<함수>` 표 연결, SSE 진행률.
- [ ] A10. 화면 쪽 `httpApi` + Web용 Vite 빌드 진입점.
- [ ] A10b. Web의 CED "Local 저장" = **화면에서 보기 + zip 내려받기** (User 결정 2026-11-20). 미리보기 창(제품 목차 + Key 문서 목록, 마크다운 읽기)과 zip. Web에서는 톱니(저장 폴더)·`ced:setDir`·`ced:pickDir`·`ced:reveal` 없음.
- [ ] A11. 모노레포 폴더 이동 (`apps/desktop`, `apps/server`, `packages/core|shared|ui`). 스크립트 `dev:desktop|web`, `build:desktop|web`. Web 설치 시 Electron 바이너리 생략.
- [ ] A12. Stage A 확인: 데스크톱 수동 점검 + 내 PC Web 모드에서 견본 CSV 열기·Keyinfo·CED 생성.

수동 점검 목록 (Stage 끝마다, 데스크톱): ① 앱 실행 ② CSV 파일 선택으로 열기 ③ CSV 끌어다 놓기 ④ DB 슬롯 연결 확인·스키마 목록 ⑤ Keyinfo 열기·핀 ⑥ Lorebook 쓰기 ⑦ Key 노트 저장 ⑧ CED 생성 ⑨ 백업 저장·복원 ⑩ 작업 폴더 바꾸기. GUI 조작은 User 도움이 필요할 수 있음.

### 3-B. 웹 배포 위험 고치기 (안쪽 울타리) 🔒

각 항목은 시험을 같이 남긴다 (`scripts/` 또는 패키지별 test).

- [ ] B1. 경로 가두기 `resolveInside(ws.root, p)`: 절대 경로·`..`·심볼릭 링크 탈출 거절. **모든** 파일 핸들러가 거치게. 화면에는 절대 경로 대신 작업 폴더 기준 상대 경로만 오가게.
- [ ] B2. Web 빌드에서 SSH(`ssh2`, `sshAlias`의 `spawn`), pem 선택, Hermes, CED 보내기, 작업 폴더 고르기 경로를 **등록 자체를 안 함**. 시험: 그 경로 요청 → 404.
- [ ] B3. DB 연결 검사 (Web): 호스트 이름 풀기 → 루프백·사설망·링크 로컬·메타데이터 주소 거절 → 검사한 IP로 그대로 연결. 읽기 전용 세션, `statement_timeout`, 연결 시간 제한, 내보내기 행 수·바이트 상한.
- [ ] B4. Web의 DB 접속 정보는 메모리에만 (세션 끝나면 버림). 디스크 저장 경로는 데스크톱 전용.
- [ ] B5. 자원 상한: 업로드 크기, 파일 통째 읽기(`readFileSync` 21곳) 중 큰 CSV 경로는 스트리밍 또는 크기 거절, 세션별 디스크 상한 검사 지점.
- [ ] B6. 세션별 작업 폴더 만들기·지우기 함수 (견본 폴더 복사, 수명 지나면 삭제). 입장 방식(초대 코드)은 Stage D — 지금은 함수와 시험만.
- [ ] B7. 오류·로그에 접속 정보, 절대 경로, 본문, 오류 원문을 남기지 않음 (`cedTransfer.ts` 규칙과 같게).
- [ ] B8. 운영 설정 검사: 필수 환경 변수 없으면 시작 거부, 개발 모드로 공개 실행 거부.
- [ ] B9. Stage B 확인: 🔒 시험 묶음 — 다른 세션 폴더 읽기, `../`, 절대 경로, `127.0.0.1`/메타데이터 DB 연결, 막힌 경로 요청이 모두 실패.

### 3-C. 기록 옮기기 (Stage B 뒤)

- [ ] C1. User에게 `llms.md` 수정 허락 받기 (llms.md 규칙).
- [ ] C2. 6장 역제안을 `llms.md` Backlogs에 한 줄씩. 서버 구성 세부는 빼고 일반 표현으로.
- [ ] C3. 7장 User 고민을 `llms.md` To-do에 `[IMPORTANT]`로 한 줄씩. 보안 세부는 빼고 "무엇을 정해야 하는지"만.
- [ ] C4. Stage A·B에서 알아낸 것 중 User가 알아야 할 것을 채팅으로 요약 → Stage D 의논 시작.

## 4. 땀 기록 (최신이 아래, 한 줄씩: 한 일 → 알아낸 것 → 다음)

- 2026-11-20 브랜치 생성, 노트 작성 → 전역 `DATA_ROOT`가 세션별 작업 폴더의 가장 큰 걸림돌 → 다음: A0.
- 2026-11-20 User와 순서 합의 (A 분리 → B 위험 고치기 → C 기록 옮기기 → D 의논). D1 결정. 노트를 LLM 전용으로 재구성 → 다음: A0.

- 2026-11-20 A0: typecheck 통과, build 통과, 시험 18/18 통과 (Node 24). `node --test scripts/`는 Node 24에서 폴더를 파일로 읽어 실패 → `pnpm test`(build:electron 뒤 `scripts/*.test.cjs`) 추가. ssh2 선택 바인딩 빌드 실패는 무해(선택 모듈). `.gitattributes` 추가(저장소 75개 파일 모두 LF라 정규화 변화 없음) → 다음: A1.

- 2026-11-20 A1·A2: `electron.d.ts`의 익명 객체를 전역 `interface TaggerApi`로 이름 붙임. `src/renderer/api.ts` 추가, 16개 파일 117곳 `window.electronAPI.` → `api.`. 지역 변수 `api`와 겹침 없음 확인. typecheck·build 통과 → 알아낸 것: 타입이 `declare global` 전역 선언이라 A11(모노레포)에서 `packages/shared`의 모듈 export로 바꿔야 함 → 다음: A3.

- 2026-11-20 A3: `api.ts`에 `caps`(workspace·revealInOs·hermes·ssh) 추가. 작업 폴더 버튼 3곳은 이미 `onOpenWorkspace &&` 구조라 App에서 넘기지 않는 것으로 끝. 첫 실행 안내도 caps로 막음. Hermes 푸터 버튼·모달, CED 보내기 버튼, DB 창 SSH 칸, Local 창 탐색기 버튼을 caps로 감쌈 → 알아낸 것: **`cedGenerate`(CED를 작업 폴더에 쓰기)는 화면 어디에서도 안 부름.** CED는 "보내기" 버튼 안에서만 만들어짐 → Web에서 hermes를 끄면 CED를 볼 방법이 없음. User 판단 필요 (질문함) → 다음: A4.

- 2026-11-20 A4: `localImportFile(sourcePath)` → `importDroppedFile(file: File)`. preload에서 `webUtils.getPathForFile`로 경로를 구함 (sandbox preload에서도 webUtils 사용 가능). 경로를 받는 함수 하나를 화면 약속에서 없앰 → B1 범위가 하나 줄어듦. IPC 채널 `local:importFile`은 그대로. 끌어다 놓기 실제 동작은 User에게 확인 요청 → 다음: A5 (작업 폴더 문맥).

- 2026-11-20 (A 중간 끼워 넣기, User 요청) CED "Local 저장" 버튼 + 톱니 저장 폴더 설정. Hermes 전송 버튼 바로 왼쪽. 설정은 `userData/ced.json` (백업에 안 들어감), 없으면 작업 폴더 `CED/`. `generateCed`가 `cedBaseDir()`을 씀 → Hermes 전송도 이 폴더에 먼저 만든 파일을 보냄. IPC `ced:getDir|pickDir|setDir|reveal` (reveal은 경로를 화면에서 받지 않음). Hermes 전송 설정 건은 `llms.md` Backlogs에 한 줄 (User 요청) → 알아낸 것: 지우기는 manifest에 있던 파일만이라 사용자 폴더를 골라도 안전. 다만 `<폴더>/<제품>/`에 같은 이름 .md가 이미 있으면 덮어씀 (User에게 알림) → 다음: A5.

- 2026-11-20 A5: `src/main/core/workspace.ts` (`Workspace`, `makeWorkspace`). 전역 경로 변수 13개(약 80곳) → `WS.<경로>`. `applyDataRoot`는 `WS = makeWorkspace(root)` 한 줄. 동작 변화 없음, 시험 18/18 → 알아낸 것: ① **기존 버그** `PRODUCT_CONFIG`가 시작 때 한 번만 계산돼 작업 폴더를 바꿔도 이전 폴더에 저장 → `WS.productConfigFile`로 고침 (fix 커밋 따로). ② 경로 말고도 **모듈 전역 상태**가 있음 → 아래 "세션 상태 목록". A7에서 core로 옮길 때 `ctx = { ws, state, platform }`로 넘긴다. 셸 주의: Bash 도구에서 `node -e` 안 `\b` 이스케이프가 깨짐 → 정규식은 스크립트 파일 + 역슬래시 없는 lookaround로. → 다음: A6 (Platform + 세션 상태 묶음).

- 2026-11-20 A6 + A7-1(local): `core/context.ts` = `Ctx { ws, state, emit, allowOutsidePaths }`, `SessionState`, `userPath`/`resolveInside`(심볼릭 링크 실제 위치까지 확인), `Handlers` 표 타입. `core/local.ts` = sheet·local·프리셋·readFile·다운로드 목록/트리/삭제·eraseColumn 15채널. main.ts는 `desktopCtx()` + `registerCore(표)`. 데스크톱 전용(dialog:openCsv, local:importFile, local:openDownloads, workspace:*)은 main.ts에 남김. 시험 `scripts/core-local.test.cjs` 9개 (사용자별 분리, 밖 경로 거절, junction 탈출 거절) → 27/27 → 알아낸 것: ① **화면↔main이 절대 경로를 주고받음** (fileSources, 다운로드 목록의 path). Web도 같은 약속을 쓰면 서버 경로가 화면에 보임 → B1에서 "화면엔 상대 경로"로 바꿀지, `userPath`로 막기만 할지 정해야 함 (지금 판단: 막기만 + 세션 폴더 경로가 보이는 것은 낮은 위험. B1에서 다시 봄). ② **프리셋 이름(`loadPreset`, `deletePreset`, `savePreset`)에 경로 검사 없음** → `../` 통과. 데스크톱에서도 버그. B1에서 고침. ③ 진행률 `emit`은 데스크톱에서 "마지막으로 요청한 창"으로 보냄 (창이 하나라 문제없음) → 다음: A7-2 (캐시, CSV 통계).

### 세션 상태 목록 (main.ts 모듈 전역, A5에서 찾음)

| 상태 | 줄(대략) | Web에서 | 처리 |
|---|---|---|---|
| `csvStatsMemory`, `csvStatsLoadedFrom`, `csvStatsTimer` | 570 | 작업 폴더별 캐시 | ctx.state로 |
| `exportAborted` | 1616 | **한 사람이 중단하면 모두 중단됨** | ctx.state로 (필수) |
| `keyNoteMigratedFor` | 2122 | 작업 폴더별 1회 이전 표시 | ctx.state로 |
| `sampleCache` | 2647 | 파일별 표본 캐시 | ctx.state로 (메모리 상한 고려) |
| `activeTunnels`, `pendingAliasTunnels` | 1316, 1370 | SSH = 데스크톱 전용 | 데스크톱에 남김 |
| `hermesVerified` | 862 | Hermes = 데스크톱 전용 | 데스크톱에 남김 |
| DB 슬롯 설정 (`userData` 파일, safeStorage) | 801~ | **PC 하나에 하나 = 모든 면접관 공유가 됨** | Web은 ctx.state 메모리 (B4) |
| `KEY_NAME_EXCLUDED` | 2370 | 상수 | 그대로 |

## 5. 우려 재점검 (코드 작업하며 갱신)

| 우려 | 처음 판단 | 코드 보고 바뀐 점 | 상태 |
|---|---|---|---|
| 세션 분리 | 폴더만 나누면 됨 | 경로는 A5에서 `WS` 하나로 모음. 경로 말고 전역 상태 7종 더 있음 (세션 상태 목록). 특히 `exportAborted`, DB 슬롯 | 진행 중 |
| 경로 조작 | `local:readFile` 하나 | `localImportFile`은 A4에서 화면 약속에서 빠짐. 아직 전수 조사 안 함. 경로를 받는 핸들러 목록 필요 (B1 전에) | 열림 |
| SSRF (DB 연결) | 앱 검사 + OS 차단 두 겹 | — | 열림 |
| 서버 계정 권한 | 전용 사용자로 실행 | Stage D (서버 쪽) | 백로그 |
| 메모리 | CSV 통째 읽기 | `readFileSync` 21곳, 어느 것이 큰 CSV인지 미확인 | 열림 |
| `safeStorage` 평문 대체 | 데스크톱 Linux에서 평문 | Web은 디스크 저장 안 함(B4)이라 Web 쪽은 해소 예정 | 열림 |

## 6. 백로그 — 역제안 (Stage C에서 llms.md로 옮김)

- Web은 회원 사이트가 아니라 체험판. 입장은 초대 코드, 관리자는 처음엔 서버 명령줄 도구로만.
- 입장마다 같은 견본 폴더를 복사해 세션 전용 폴더. 수명 24시간 뒤 삭제. 면접관 DB 연결은 선택·읽기 전용.
- 바깥 울타리 (systemd): sudo 없는 전용 사용자, 쓰기는 앱 데이터 폴더 하나, `IPAddressDeny`로 내부 주소 차단, `MemoryMax`.
- CI/CD: PR마다 Actions로 typecheck·시험·빌드. 태그 푸시 → 설치본 3종(Win/Mac/Linux) + Web 묶음을 GitHub Release로.
- 서버는 빌드하지 않고 Release의 Web 묶음을 내려받아 교체 (체크섬 확인). 되돌리기 = 이전 태그 배포.
- 배포 실행은 집 PC에서 SSH (서버 SSH가 집 IP만 허용). `pnpm ship` = 시험 → main 병합 → 태그 푸시 → web/desktop/둘 다/안 함 고르기.
- 데스크톱: `safeStorage` 평문 대체 시 경고, 코드 서명 없음 안내, 설치본 `ssh2` 동작 확인.
- 남은 결정: D2 서버 프레임워크(초안 Express), D6 견본 데이터(저장소의 일부 Docs 사용으로 이해함, 확인 필요), D7 업로드 크기·세션 수명·동시 세션 수, D8 병합 방식·데스크톱 Release 방식, D9 이름·포트·하위 도메인.

## 7. User의 고민 (Stage C에서 llms.md To-do에 `[IMPORTANT]`로)

- Web은 누구나 쓰는 곳이라 로그인이 필요한가.
- 면접관 2명 이상이 동시에 써도 서로 침해하지 않게 분리되는가. 같은 견본으로 동시에 시작하되 서로 영향이 없어야 함.
- Web 배포가 EC2 서버 자체의 침해로 이어지지 않게 막을 수 있는가.
- 관리자 계정을 처음부터 둘지.
- 서버가 망가질 위험이 크면 GitHub Release 중심 배포로 갈지 (CI/CD도 보여 줄 겸).
- Web 배포에 적극적이지만, App도 배포될 수 있음을 감안함.
- 저장소의 일부 견본 Docs는 지워져도 되는 정보로 공개해도 됨.

## 8. 결정

| ID | 내용 | 결정 |
|---|---|---|
| D1 | `apps/`+`packages/`로 완전히 나눔. 코드 분리 먼저, 폴더 이동은 나중에 한 번에 | ✅ 2026-11-20 |
| D2 | Web 서버 프레임워크 | 초안 Express로 진행, Stage D에서 다시 봄 |
| D3~D9 | 6장 마지막 줄 참고 | Stage D |
