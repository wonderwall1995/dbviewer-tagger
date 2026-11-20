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
- [x] A7. main.ts 덩어리를 core로 하나씩 옮김 (한 땀 = 한 덩어리): local/프리셋/다운로드 → 캐시/CSV 통계 → Lorebook → DB 슬롯 → DB/SSH → Keyinfo/연관/Key 노트/자동 후보 → CED/백업 → Hermes/CED 보내기(데스크톱 전용 쪽에 둠).
- [~] A8. (코드 끝. 데스크톱 수동 점검은 User에게 요청함) main.ts = 창 만들기 + IPC↔core 연결만. 데스크톱 수동 점검.
- [x] A9. Web 서버 뼈대 (node:http): `127.0.0.1` 고정 포트, `/api/health`, `POST /api/<함수>` 표 연결, SSE 진행률.
- [x] A10. 화면 쪽 `httpApi` + Web용 Vite 빌드 진입점.
- [x] A10b. Web의 CED "Local 저장" = **화면에서 보기 + zip 내려받기** (User 결정 2026-11-20). 미리보기 창(제품 목차 + Key 문서 목록, 마크다운 읽기)과 zip. Web에서는 톱니(저장 폴더)·`ced:setDir`·`ced:pickDir`·`ced:reveal` 없음.
- [x] A11. 모노레포 폴더 이동 (`apps/desktop`, `apps/server`, `packages/core|shared|ui`). 스크립트 `dev:desktop|web`, `build:desktop|web`. Web 설치 시 Electron 바이너리 생략.
- [ ] A12. Stage A 확인: 데스크톱 수동 점검 + 내 PC Web 모드에서 견본 CSV 열기·Keyinfo·CED 생성.

수동 점검 목록 (Stage 끝마다, 데스크톱): ① 앱 실행 ② CSV 파일 선택으로 열기 ③ CSV 끌어다 놓기 ④ DB 슬롯 연결 확인·스키마 목록 ⑤ Keyinfo 열기·핀 ⑥ Lorebook 쓰기 ⑦ Key 노트 저장 ⑧ CED 생성 ⑨ 백업 저장·복원 ⑩ 작업 폴더 바꾸기. GUI 조작은 User 도움이 필요할 수 있음.

### 3-B. 웹 배포 위험 고치기 (안쪽 울타리) 🔒

각 항목은 시험을 같이 남긴다 (`scripts/` 또는 패키지별 test).

- [x] B1. (A7에서 찾은 구멍: keynote:sampleRows·keyinfo:reindex/index의 파일 경로, 프리셋 이름 load/save/delete, `lorebook:setCategories` 제품 이름, `lorebook:newPath` product) 경로 가두기 `resolveInside(ws.root, p)`: 절대 경로·`..`·심볼릭 링크 탈출 거절. **모든** 파일 핸들러가 거치게. 화면에는 절대 경로 대신 작업 폴더 기준 상대 경로만 오가게.
- [x] B2. (A9에서 이미 됨: Web 채널 표 = core만. server.test가 hermes/ssh/workspace/ced:setDir/dialog 404 확인) Web 빌드에서 SSH(`ssh2`, `sshAlias`의 `spawn`), pem 선택, Hermes, CED 보내기, 작업 폴더 고르기 경로를 **등록 자체를 안 함**. 시험: 그 경로 요청 → 404.
- [x] B3. DB 연결 검사 (Web): 호스트 이름 풀기 → 루프백·사설망·링크 로컬·메타데이터 주소 거절 → 검사한 IP로 그대로 연결. 읽기 전용 세션, `statement_timeout`, 연결 시간 제한, 내보내기 행 수·바이트 상한.
- [x] B4. (A9에서 이미 됨: 세션 메모리 slots) Web의 DB 접속 정보는 메모리에만 (세션 끝나면 버림). 디스크 저장 경로는 데스크톱 전용.
- [x] B5. 자원 상한: 업로드 크기, 파일 통째 읽기(`readFileSync` 21곳) 중 큰 CSV 경로는 스트리밍 또는 크기 거절, 세션별 디스크 상한 검사 지점.
- [x] B6. 세션별 작업 폴더 만들기·지우기 함수 (견본 폴더 복사, 수명 지나면 삭제). 입장 방식(초대 코드)은 Stage D — 지금은 함수와 시험만.
- [x] B7. 오류·로그에 접속 정보, 절대 경로, 본문, 오류 원문을 남기지 않음 (`cedTransfer.ts` 규칙과 같게).
- [x] B8. 운영 설정 검사: 필수 환경 변수 없으면 시작 거부, 개발 모드로 공개 실행 거부.
- [x] B9. Stage B 확인: 🔒 시험 묶음 — 다른 세션 폴더 읽기, `../`, 절대 경로, `127.0.0.1`/메타데이터 DB 연결, 막힌 경로 요청이 모두 실패.

### 3-C. 기록 옮기기 (Stage B 뒤)

- [x] C1. (User가 처음에 "B 다음에 llms.md에 실록해줘"라고 지시 = 허락) User에게 `llms.md` 수정 허락 받기 (llms.md 규칙).
- [x] C2. 6장 역제안을 `llms.md` Backlogs에 한 줄씩. 서버 구성 세부는 빼고 일반 표현으로.
- [x] C3. 7장 User 고민을 `llms.md` To-do에 `[IMPORTANT]`로 한 줄씩. 보안 세부는 빼고 "무엇을 정해야 하는지"만.
- [x] C4. Stage A·B에서 알아낸 것 중 User가 알아야 할 것을 채팅으로 요약 → Stage D 의논 시작.

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

- 2026-11-20 A7-2(csv): `core/csv.ts` = cache:load/save, csv:stats + `recordSnapshotStats(ctx,...)`(DB 내보내기가 부름). 통계 캐시 `csvStatsMemory/LoadedFrom/Timer` → `ctx.state.csvStats`. 저장 타이머는 예약 시점의 작업 폴더로 고정 (예전엔 2초 뒤의 WS를 씀 → 그사이 작업 폴더를 바꾸면 새 폴더에 옛 캐시를 쓸 수 있었음, 작은 버그 같이 고침). 시험 4개 추가 → 31/31 → 다음: A7-3 (Lorebook).

- 2026-11-20 A7-3(lorebook): `core/lorebook.ts` = lorebook:* 8개 + product:loadConfig/saveConfig (10채널). 이제부터 옮기기는 스크래치패드의 `move-section.cjs`(ipcMain.handle→표, WS.→ctx.ws., 도우미에 ctx 추가)와 `check-channels.cjs`(중복·빠짐 점검)로 함. **Git Bash 주의: `//`로 시작하는 인자를 `/`로 바꿈 → `MSYS_NO_PATHCONV=1` 필요** (한 번 깨져서 손으로 고침). 시험 3개 → 34/34 → 알아낸 것: **`lorebook:setCategories`의 제품 이름에 경로 검사 없음** → `../../x`로 제품 폴더 밖 .json을 만들고 **지울** 수 있음. `lorebook:newPath`의 product도 검사 없음(쓰기는 withinLorebookRoot가 막음). B1에 넣음 → 다음: A7-4 (DB 슬롯).

- 2026-11-20 A7-4(db): `core/db.ts` = 슬롯 타입·`normalizeSlots`·`safeSegment` + db:listSlots/loadSlot/saveSlot/testConnection/listSchemas/listTables/abortExport/exportTables/exportSchemas (9채널). `Ctx`에 `slots`(저장소)와 `tunnel?`(SSH) 추가. 데스크톱은 암호화 파일 + ensureTunnel/closeTunnel, Web은 메모리 저장소 + 터널 없음 → SSH 슬롯은 "이 환경에서는 SSH 터널을 쓸 수 없습니다". 진행률은 `ctx.emit`, 중단 표시는 `ctx.state.exportAborted`. main.ts에 남은 것: 암호화 파일 읽기/쓰기, SSH 터널(Hermes도 씀), db:closeTunnel, ssh:pickPemFile. 시험 5개 → 39/39 → 알아낸 것: B3(DB 주소 검사)는 `withDb` 한 곳에 넣으면 testConnection·조회·내보내기 모두에 걸림. 연결 직전에 `ctx.connectGuard?(host, port)` 같은 부품으로 두면 데스크톱은 없음, Web은 주소 검사 → 다음: A7-5 (Keyinfo·연관·Key 노트·자동 후보).

- 2026-11-20 A7-5(keyinfo): `core/keyinfo.ts` = Keyinfo·백업·연관 그룹·Key 노트·CED 생성·자동 후보·표본 행 (20채널). `Ctx.cedDir()` 추가 (데스크톱 = 톱니 설정, Web = 작업 폴더 CED/). `keyNoteMigratedFor`, `sampleCache` → `ctx.state`. 진행률 `sender`는 `{ send: ctx.emit }`. 데스크톱 전용 CED 폴더 설정(ced:getDir/pickDir/setDir/reveal)은 main.ts에 남김. main.ts 2,800줄 → 795줄. 시험 2개 → 41/41 → 알아낸 것: ① `ced-index.test.cjs`는 가짜 electron으로 main.js를 불러 `event` 없이 핸들러를 부름 → `registerCore`가 `event.sender`에서 죽음 → `event?.sender`로 고침. 이 시험은 main 연결까지 확인해 줘서 유용. ② `keynote:sampleRows`, `keyinfo:reindex/index`가 화면에서 받은 파일 경로를 그대로 읽음 → B1 목록에 추가 → 다음: A7-6 (Hermes·CED 보내기는 데스크톱 전용이라 main.ts에 그대로 둠 → 사실상 A7 끝, A8 확인).

- 2026-11-20 A7·A8 마감: core에 electron/ssh2/child_process import 없음 확인. main.ts에 남은 22채널 = 모두 데스크톱 전용 (dialog:openCsv, local:importFile, app:openGithub, workspace:*, local:openDownloads, hermes:*, ced:send, ssh:pickPemFile, db:closeTunnel, ced:getDir/pickDir/setDir/reveal). core 57채널. **리팩터링이 크므로 Web 서버(A9) 전에 User에게 데스크톱 수동 점검(앱 실행, CSV 열기, DB 연결, Key 노트, CED 저장, 백업)을 부탁함** → 다음: User 점검 결과 확인 뒤 A9.

- 2026-11-20 User 확인: 데스크톱 "대강 잘 동작". User 요청 3건 처리 → ① 톱니를 Keyinfo 창 머리글 제목 오른쪽으로 (CedSaveButton / CedDirSettings로 나눔, 머리글은 끌기 손잡이라 설정 창 안 mousedown 막음) ② 전송 버튼 이름 "Obsidian Vault 전송" ③ **방침 변경: 이 도구가 기준. 볼트에서 사람이 고친 문서도 덮어쓰고 `overwritten` 경고** (cedTransfer, 시험, llms.md 백로그에 [결정함] 표시) → A9 시작. D2 결정(LLM 판단): Express 대신 node:http (경로 4개뿐, 의존성·메모리·공격면 줄임). Stage D에서 다시 봄.

- 2026-11-20 A9: `src/server/server.ts`(`createTaggerServer`) + `index.ts`(127.0.0.1, TAGGER_PORT 기본 6201, 포트 쓰이면 멈춤, TAGGER_DATA_DIR 기본 local/web-data). 경로 4개: health, `POST /api/call/<채널>`({args}), `GET /api/events`(SSE, 세션별), `POST /api/upload?name=`(임시 파일 → rename, 크기 제한). 채널 표 = core 5개 표만 (hasOwnProperty로 `__proto__` 등 막음). 세션 = 쿠키 `tagger_sid`(HttpOnly, SameSite=Lax; Secure는 HTTPS 붙일 때) → `<dataDir>/sessions/<id>/`, 슬롯은 세션 메모리. `tsconfig.server.json` → `dist/server`. `pnpm build:server`, `pnpm start:server`. 시험 `scripts/server.test.cjs` 6개 → 47/47 → 알아낸 것: ① 413 때 `req.destroy()`하면 브라우저가 응답을 못 받음 → 응답 뒤에 닫기로 고침. ② **core 오류 메시지에 서버 절대 경로가 들어감** (fs의 ENOENT 메시지 등) → B7에서 Web 응답의 오류 문구를 거르기. ③ 잘못된 JSON 본문 → 지금 500 → 400으로 (B8). ④ 세션을 아무나 만들 수 있음 (입장 방식은 Stage D) — 지금은 개발용. 세션 수 상한·만료 없음 → B5/B6 → 다음: A10 (화면 httpApi).

- 2026-11-20 A10: `src/renderer/platform/httpApi.ts` (`createHttpApi`: 일반 = POST /api/call, 진행률 = EventSource 하나를 채널별로, openCsv = 브라우저 파일 선택 + 업로드, importDroppedFile = 업로드, openGithub = 새 탭). `platform/channels.ts` = preload에서 뽑은 함수→채널 표 79개 + 드리프트 시험 `scripts/channels.test.cjs`. **`api.ts`는 실행 중에 고른다: `window.electronAPI` 있으면 데스크톱, 없으면 Web** → 화면 빌드 하나를 둘이 같이 씀 (Web 전용 Vite 진입점 불필요). caps도 같은 방식. vite.config에 `/api` → 127.0.0.1:6201 프록시. `pnpm dev:web`(서버 + vite), `pnpm build:web`. 48/48. 실제 확인: dev:web 띄워 localhost:6200 페이지, /api/health, local:load, db:listSlots 프록시 통과, hermes:loadConfig 거절 → 알아낸 것: Vite는 IPv6 localhost에만 붙음 (127.0.0.1로 물으면 응답 없음, 서버 배포와는 무관). 브라우저 화면 조작은 User 확인 필요 → 다음: A10b (Web CED 보기 + zip).

- 2026-11-20 A10b: core `ced:read`(만들고 내용 반환, folder는 제품 폴더 이름만). 화면 `platform/zip.ts`(STORE zip, UTF-8 이름 플래그 0x800, 의존성 없음) + `CedPreviewModal`(왼쪽 목록·목차 맨 위, 오른쪽 마크다운 원문, zip 내려받기). Web의 Local 저장 = 미리보기 창. 데스크톱은 그대로. zip은 python zipfile로 CRC·한글 이름·내용 확인. 서버 시험에 경로 누출 없음 확인 추가 → 49/49 → 다음: A11 (모노레포 폴더 이동) 또는 A12. **판단: A11은 B 전에 할지 User에게 물을 것** (폴더 이동은 diff가 크고, B는 지금 구조에서도 가능).

- 2026-11-20 실수 기록: 시험 결과를 grep으로만 보고 `&&`로 커밋까지 이어서, 서버 시험 파일 문법 오류(heredoc 안 역슬래시가 Bash 도구에서 줄어듦)인 채로 e1f0b71 커밋됨 → 바로 fix 커밋. **앞으로: 시험과 커밋을 한 명령에 잇지 않는다. 역슬래시가 든 코드는 heredoc 말고 Write/Edit 도구로.** 49/49.

- 2026-11-20 버그(User 보고: Web 흰 화면): vite 프록시 키 `/api`가 앞부분 일치라 화면 모듈 `/api.ts`까지 서버로 넘김 → 404 → 화면 못 뜸. 키를 `/api/`로. 배포 Nginx는 `location /api/`라 무관. **디버그 방법(기억):** 브라우저 조작 도구가 없을 때 → ① 모듈 주소를 curl로 하나씩 요청해 상태 코드 보기 ② headless Edge `msedge.exe --headless=new --screenshot=<png> --timeout=8000 --window-size=1400,850 --user-data-dir=<scratchpad>` 를 `timeout 25`로 감싸 실행하고 PNG를 Read로 봄 (`--dump-dom --virtual-time-budget`은 SSE 때문에 끝나지 않음). User가 띄운 dev:web(12:42 시작)은 끄지 않고 그대로 씀. 확인: Web 화면 뜸, Hermes 버튼 숨김 → 다음: B단계 (User 지시: B 먼저, 그 뒤 A11).

- 2026-11-20 B1: `context.ts`에 `checkName`(이름 한 칸: 구분자·./..·제어 문자·빈 이름·120자 초과 거절)과 `tryUserPath`. 적용: **`productDirName`(새로 찾은 가장 큰 구멍: 제품 이름이 검사 없이 경로 → Keyinfo/Key 노트를 작업 폴더 밖에 쓸 수 있었음, 거의 모든 기능이 거침)**, getKeyinfoPath도 productDirName 경유, 프리셋 이름(save/load/delete), lorebook setCategories(하나라도 틀리면 아무것도 안 바꿈)·newPath, keynote:sampleRows·keyinfo:reindex/index 파일 경로(어기면 그 파일만 건너뜀). DB 내보내기 SQL 식별자 `quoteIdent`(큰따옴표 이스케이프) — 경로는 원래 safeSegment로 안전. 시험 `scripts/security-paths.test.cjs` 6개(바깥 폴더에 아무것도 안 생기는지까지) → 55/55. 데스크톱 영향: 이상한 이름(/, .. 포함)만 거절, 정상 이름은 그대로. "화면엔 상대 경로" 전환은 안 함(막기만으로 충분, 세션 폴더 경로 노출은 B7에서 오류 문구만 거름) → 다음: B2.

- 2026-11-20 B3: `core/netguard.ts` (`isPublicAddress` IPv4 14개 범위 + IPv6 ::1/::/fc00::/7/fe80::/10/ff00::/8/::ffff:v4/64:ff9b/2001:db8, `isAllowedDbPort` = 5432 또는 1024~65535 (LLM 판단: 22·80·443 같은 서비스 두드리기 막기), `resolvePublicHost` = lookup all → 하나라도 비공인이면 거절 → 첫 주소 반환). `Ctx.dbGuard?` → `withDb`가 연결 직전에 부르고 **검사한 IP로 접속**(DNS 바꿔치기 대비). Web 옵션: connectionTimeoutMillis 8s, statement_timeout 30s, query_timeout 35s, `-c default_transaction_read_only=on`. 데스크톱은 dbGuard 없음 = 그대로. 시험 `scripts/security-db.test.cjs` 5개 (Web 서버 끝까지 127.0.0.1·localhost 거절 포함) → 60/60 → 남은 점: 호스트를 IP로 바꿔 접속하면 DB가 TLS(SNI)를 요구할 때 문제될 수 있음 — 지금은 ssl 옵션 자체를 안 씀. 면접관 DB가 TLS 필수면 Stage D에서 ssl+servername 처리 → 다음: B4.

- 2026-11-20 B5·B6·B7: 서버 옵션 maxSessions(10, 넘으면 503), sessionDiskBytes(200MB), sessionIdleMs(24h), sweepIntervalMs(10분), sampleDir(새 세션에 cpSync). 용량: `ensureRoom` = 추정치로 넘치면 dirSize로 실제 재고 그래도 넘치면 507. 적용 = 업로드(content-length 먼저, 받는 상한 = min(업로드 상한, 남은 용량)), DB 내보내기 청크(`ctx.reserveDisk`), 64KB 넘는 call 본문. 작은 요청(지우기·목록)은 차도 됨. 서버 시작 때 `<dataDir>/sessions` 비움(세션은 메모리라 주인 없음). `publicError`: dataDir 문자열 + 따옴표 안 절대 경로를 가림. 잘못된 JSON → 400. httpError(status, expose)로 사용자에게 보여 줄 문구만 내보냄. 시험 `scripts/security-limits.test.cjs` 8개 → 68/68 → 남은 점: ① 세션당 메모리(sampleCache 최대 32MB 읽기, CSV 파싱)는 상한 없음 → Stage D systemd MemoryMax로 가둠 + maxSessions로 간접 제한. ② 세션을 누구나 만듦(입장 방식 Stage D) → maxSessions를 봇이 채우면 면접관이 못 들어옴 = 초대 코드가 필요한 이유. User에게 알릴 것 → 다음: B8.

- 2026-11-20 B8·B9 (**Stage B 끝**): `src/server/config.ts` `loadConfig(env)` — TAGGER_PORT(1024~65535)·DATA_DIR(운영은 절대 경로 필수)·SAMPLE_DIR·MAX_SESSIONS·SESSION_MB·SESSION_IDLE_HOURS·UPLOAD_MB, 범위 밖이면 throw → index.ts가 "설정 오류" 찍고 exit 1. NODE_ENV=production이면 쿠키 Secure. 모든 JSON 응답에 Cache-Control: no-store, X-Content-Type-Options: nosniff. B9: 교차 세션 공격(A가 B의 경로로 readFile·csv:stats·eraseColumn·deleteDownload) 시험 추가. 시험 묶음: security-paths(6), security-db(5), security-limits(8), server-config(5), server(8) → 전체 74/74 → 다음: A11 (User 지시: B 다음 A11, 그 뒤 C).

- 2026-11-20 A11 (User 결정: (나) 패키지까지 나누기, 루트 명령은 그대로): 4단계 커밋. ① packages/core (@tagger/core, main/types=dist, deps pg·papaparse, index.ts 배럴) ② apps/server (@tagger/server) ③ packages/ui (@tagger/ui, vite root=src, outDir=packages/ui/dist) + packages/shared (@tagger/shared, 타입만, main=src/types.ts) ④ apps/desktop (@tagger/desktop, deps core·ssh2). **설치본은 루트 package.json이 앱**: main=apps/desktop/dist/main.js, build.files = desktop dist·core dist·ui dist·node_modules. 루트 스크립트는 pnpm --filter <pkg>... run build로 위임. **알아낸 것: pnpm 12는 .npmrc의 shamefully-hoist를 안 읽음 → 그동안 끌어올림이 꺼져 있었음 (publicHoistPattern [])** → pnpm-workspace.yaml에 shamefullyHoist: true, autoInstallPeers: true로 옮기고 .npmrc 삭제. 그 전 설치본은 pg-protocol·asn1 등 하위 의존성이 빠져 있었을 것 (llms.md To-do 2 "설치본 확인"이 안 된 이유일 수 있음). 확인: electron-builder --win --dir → asar에 core·pg(+pg-protocol/pool/types/pgpass)·ssh2(+asn1/bcrypt-pbkdf)·papaparse 있음, electron/react/vite/typescript 없음 (5.8MB). 설치본 exe를 ELECTRON_RUN_AS_NODE=1로 돌려 asar 안에서 모듈 require 성공. TaskStop은 Windows에서 자식(vite, server)을 안 죽임 → 포트 주인 확인 후 직접 종료. report.html(11:44, User 또는 다른 도구가 만든 보고서)은 커밋 안 함. 74/74 → 다음: Stage C (llms.md 기록 옮기기) → Stage D 의논.

- 2026-11-20 Stage C: llms.md To-do 8~12에 User 고민 [IMPORTANT] 5줄, To-do 6·7에 [진행함] 표시, Backlogs에 역제안 8줄, Done 7줄, Bugs 2줄([고침]). 서버 구성 세부(같은 서버의 다른 프로젝트, IP, 도메인)는 쓰지 않음 → **Stage D 의논 시작.** User에게 채팅으로 요약함.
- 2026-11-20 (1시간 쉼, 할당량) Stage D-1 입장 방식. **User 결정: 공용 비밀번호(입장 코드) 하나, 만료 전 여러 번 입장(매번 새 견본), 기본 60일.** report.html은 .gitignore (GPT 평가용). 구현: `apps/server/src/access.ts` (코드 = 헷갈리는 글자 뺀 31자 알파벳 4×3, scrypt 해시+salt만 `<dataDir>/access.json` 600, timingSafeEqual, 입력 정규화, `LoginLimiter` 10분 10번), `admin.ts` (set-code [--days], status, revoke; 코드는 set-code 때 한 번만 출력; 루트 `pnpm web:admin`). 서버: `openAccess`(개발 + 코드 파일 없음일 때만 true), `GET /api/session`(세션 안 만듦), `POST /api/login`, 세션 없으면 401. 실패 집계 키 = 루프백이면 X-Real-IP → **Nginx 견본에 X-Real-IP 넣기 필수**. 화면: `platform/WebGate.tsx` (입장 화면, 401이면 tagger:need-login 이벤트로 다시 띄움). 시험 `scripts/server-access.test.cjs` 8개 → 82/82. 고친 것: 없는 채널 404 때 본문을 안 읽고 답해 keep-alive 연결이 가끔 꼬임 → req.resume() 후 답함, 4회 연속 통과. headless 캡처는 첫 Vite 로딩이 느려 --timeout 15000 필요. node -e 안에 작은따옴표 든 문장을 넣지 말 것(또 실패) → 다음: D-4 배포 방식 (CI, Release, pnpm ship).
- 2026-11-20 Stage D-4 배포 방식. **User 결정: pnpm ship 안 만듦 (main 병합은 User가 PR로), GitHub Release·Actions 보류, EC2에서 스크립트 하나로 배포, 설치본은 Windows·macOS (EC2는 Ubuntu, Web만).** llms.md 해당 줄에 [보류]/[그만둠]/[결정함] 표시. 구현: ① 서버를 esbuild로 파일 하나씩 묶음 (`apps/server/bundle/tagger-server.js` 350KB, `tagger-admin.js`; --external:pg-native; 루트 `pnpm bundle:server`; .gitignore bundle/). ② `TAGGER_SOCKET` (유닉스 소켓, chmod 660, SIGTERM 정리) → systemd `IPAddressDeny=localhost ...`로 루프백까지 막을 수 있게 됨 (TCP면 Nginx → 앱 들어오는 연결도 막혀서 불가했음). DNS는 `IPAddressAllow=127.0.0.53/32`. ③ `deploy/`: tagger-api.service (User=tagger, Group=www-data, ProtectSystem=strict, ProtectHome, StateDirectory/RuntimeDirectory, IPAddressDeny, MemoryMax=450M, node --max-old-space-size=320), tagger.env.example (비밀 없음), nginx-tagger.conf (__DOMAIN__, /api/login limit_req, /api/events 버퍼링 끔, /api/upload 25m, X-Real-IP), nginx-tagger-ratelimit.conf (zone taggerlogin), setup-server.sh (처음 한 번, 멱등, certbot 있으면 사이트 안 덮음), server-up.sh (main 또는 커밋 지정 = 되돌리기, 성공 시 /var/lib/tagger/deploy-history.log), tagger-admin.sh, README.md. ④ **알아낸 것: (a) packageManager가 없으면 서버 corepack이 pnpm 10을 씀 → `packageManager: pnpm@12.14.0` + 잠금 파일 갱신(안 하면 frozen-lockfile 거절). (b) pnpm 12는 `--filter`·`--no-include-workspace-root`를 줘도 루트 프로젝트 의존성을 늘 설치 → electron·electron-builder를 루트에서 apps/desktop으로 옮김, 루트 dist = `pnpm --filter @tagger/desktop exec electron-builder --projectDir ../..` (electron 버전은 끌어올린 node_modules에서 스스로 찾음 30.5.1). (c) 설치가 실패한 채 pnpm run을 부르면 전체를 자동 설치함.** 깨끗한 clone에서 server-up의 설치·빌드 단계 재현: electron 없음, node_modules 668→253MB, 빌드 성공. 로컬 설치본 --dir 다시 확인 (asar 안 require 성공, electron-builder 안 들어감). 시험 `scripts/server-bundle.test.cjs` 3개 (저장소 밖 빈 폴더에서 묶음 실행, TCP·named pipe, admin) — 처음엔 정리 순서(폴더 먼저 지움)와 keep-alive 때문에 시험이 끝나지 않았음 → 프로세스 끝내고 기다린 뒤 지움, agent:false. 85/85. **실제 EC2 실행은 못 함 (User가 함)** → 다음: D-3 견본 데이터.
- 2026-11-20 Stage D-3 견본 데이터. **User 결정: 웹데모 public CSV 전부 (전부 가짜), users는 admin 행만 살리라 했으나 내려받은 users.csv에 admin 행이 없음(6명 모두 무작위 글자) → 6명 모두 넣고 User에게 알림. 완성된 예시까지(rwa Keyinfo·Key 노트).** `scripts/make-samples.cjs` → `samples/workspace/` (CSV 9, 제품 rwa+순서, keyinfo.json 핀 15, keynotes.json 확인 1·보류 1, 기본 시트 하나 = A.json 내용, activeFile 뺌). **전화번호(010-xxxx-xxxx 무작위)는 실제 번호와 겹칠 수 있어 010-0000-000N으로 바꿈** (이메일은 원래 빈칸, accountNumber는 그대로 → User에게 알림). **.gitignore의 docs/ local/ DB-downloads/ CED/ backups/ 가 모든 깊이에 걸려 견본이 무시됨 → 앞에 / 붙여 루트만.** 시험 `scripts/samples.test.cjs` 3개 (절대 경로·로그 없음, 전화번호 가짜, 견본 세션에서 CSV 열기·통계·Keyinfo·Key 노트·ced:read). **버그 찾음: 열린 모드(개발)에서 앱이 처음 동시에 보내는 요청마다 세션이 생김(한 페이지 8개) → 세션 상한에 걸림 → /api/session(열린 모드)에서 세션을 먼저 만듦.** 개발 StrictMode 때문에 페이지당 2개는 남음(개발만). **디버그 도구 기억: headless --screenshot은 데이터 오기 전에 찍을 수 있음 → scratchpad/cdp-trace.cjs (Edge --remote-debugging-port, CDP로 /api 요청·응답·예외 기록, 기다린 뒤 DOM 검사·Page.captureScreenshot).** 확인 화면: rwa 선택, 웹데모.public 9개 행·열 수. 89/89 → 다음: User에게 보고 (남은 것: 하위 도메인, PR 병합, EC2 첫 배포는 User).

### 세션 상태 목록 (main.ts 모듈 전역, A5에서 찾음)

| 상태 | 줄(대략) | Web에서 | 처리 |
|---|---|---|---|
| `csvStatsMemory`, `csvStatsLoadedFrom`, `csvStatsTimer` | 570 | 작업 폴더별 캐시 | ✅ ctx.state.csvStats (A7-2) |
| `exportAborted` | 1616 | **한 사람이 중단하면 모두 중단됨** | ✅ ctx.state.exportAborted (A7-4) |
| `keyNoteMigratedFor` | 2122 | 작업 폴더별 1회 이전 표시 | ✅ ctx.state (A7-5) |
| `sampleCache` | 2647 | 파일별 표본 캐시 | ✅ ctx.state (A7-5). 세션당 최대 32MB 읽기 → B5에서 세션 수 상한과 같이 봄 |
| `activeTunnels`, `pendingAliasTunnels` | 1316, 1370 | SSH = 데스크톱 전용 | 데스크톱에 남김 |
| `hermesVerified` | 862 | Hermes = 데스크톱 전용 | 데스크톱에 남김 |
| DB 슬롯 설정 (`userData` 파일, safeStorage) | 801~ | **PC 하나에 하나 = 모든 면접관 공유가 됨** | ✅ ctx.slots 부품화 (A7-4). Web 메모리 구현은 A9 |
| `KEY_NAME_EXCLUDED` | 2370 | 상수 | 그대로 |

## 5. 우려 재점검 (코드 작업하며 갱신)

| 우려 | 처음 판단 | 코드 보고 바뀐 점 | 상태 |
|---|---|---|---|
| 세션 분리 | 폴더만 나누면 됨 | 경로는 A5에서 `WS` 하나로 모음. 경로 말고 전역 상태 7종 더 있음 (세션 상태 목록). 특히 `exportAborted`, DB 슬롯 | 진행 중 |
| 경로 조작 (✅ B1) | `local:readFile` 하나 | `localImportFile`은 A4에서 화면 약속에서 빠짐. 아직 전수 조사 안 함. 경로를 받는 핸들러 목록 필요 (B1 전에) | 열림 |
| SSRF (DB 연결) | 앱 검사 + OS 차단 두 겹 | ✅ 앱 검사 B3. OS 차단(systemd IPAddressDeny)은 Stage D | 반쯤 닫힘 |
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
| D2 | Web 서버 프레임워크 | node:http로 진행 (LLM 판단, 2026-11-20). Stage D에서 다시 봄 |
| D3 | 입장 방식 | ✅ 공용 입장 코드 하나, 60일, 여러 번 입장 (User, 2026-11-20). 관리자 = 서버 명령줄(admin.ts) |
| D4 | 배포 방식 | ✅ EC2 스크립트 배포(deploy/server-up.sh), Release·Actions 보류, main 병합은 PR (User, 2026-11-20) |
| D5 | 서버 울타리 | ✅ systemd 견본에 넣음 (전용 사용자, ProtectHome, IPAddressDeny, MemoryMax). 실제 서버 확인 필요 |
| D6 | 견본 데이터 | ✅ 웹데모 CSV 9개(가짜, users는 admin 행 없음 → 6명 모두), 전화번호 가짜로 바꿈, rwa Keyinfo·Key 노트·기본 시트 (User, 2026-11-20) |
| D7~D9 | 이름·하위 도메인 등 | Stage D |
