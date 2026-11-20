# ui-ids (초안: 1차 메인 창, 2차 모달)

화면 요소에 붙일 ID 목록이다. 대화에서 "SB.tree의 위쪽" 같이 가리키는 데 쓴다.
상태: 코드에 반영됨 (2026-10-14). 선택 칸이 비어 있어 추천 ID를 모두 채택했다. 이후 이름을 바꾸려면 이 표와 코드를 함께 고친다 (아래 "ID 바꾸는 방법").

## 확정된 규칙

- 형식: `영역코드.슬러그` (예: `SB.tree`). 영역 코드는 대문자 2자, 슬러그는 영어 소문자와 `-`.
- 세부 수준: 영역과 주요 컨트롤. 행·셀 같은 반복 항목은 패턴 ID 하나를 쓰고, Inspector가 호버 때 인스턴스 이름을 덧붙인다 (예: `SB.file` + `AccountPayment.csv`).
- 한 번 정한 ID는 번호를 다시 매기지 않고 이름을 함부로 바꾸지 않는다. 바꿀 때는 이 표에 "이전 ID" 칸을 만들어 남긴다.
- Inspector: 헤더 제목 옆 토글. 호버할 때만 ID, 컴포넌트, 파일, 상위 ID 경로를 보여 준다. **요소를 클릭하면 ID가 클립보드에 복사된다.** 개발 모드에서만 포함한다.
- 모달은 모달마다 영역 코드를 따로 둔다 (아래 2차). 공용 `Modal` 컴포넌트는 `uiId` 값을 받아 `{코드}.frame`, `{코드}.title`, `{코드}.close`를 자동으로 붙인다.
- 모달 배경(오버레이)은 `ModalOverlay` 컴포넌트로 만든다. 배경에 `onClick`으로 직접 닫지 않는다. 모달 안에서 시작한 드래그가 배경에서 끝나도 모달이 닫히지 않게 하는 규칙이 이 컴포넌트에 있다.
- 팝업과 우클릭 메뉴가 특정 영역에 속하면 그 영역 코드를 쓴다 (예: 컬럼 우클릭 메뉴는 `MN.grid-menu`).

## 영역 코드 (제안)

| 코드 | 영역 | 메모 |
|---|---|---|
| HD | 상단 헤더 (제목 줄) | |
| SB | 왼쪽 사이드바 | |
| MN | 메인 영역 (제품 버튼 줄, 툴바, 시트 탭, 패널, 테이블) | 테이블 내부는 `MN.grid-*` |
| FT | 하단 푸터 | |
| (2차) | 모달 15종 | 모달마다 코드를 따로 둔다 (아래 2차) |

## 사용 방법

각 행의 **선택** 칸에 다음 중 하나를 적는다.
- `추천` (또는 비워 둠 = 추천 채택)
- `A` 또는 `B` (대안 채택)
- 직접 입력한 ID
- `삭제` (이 요소에는 ID를 달지 않는다)

"위치/설명"은 화면에서 어디인지, "코드"는 현재 `className` 또는 컴포넌트다.

---

## HD 상단 헤더

| 추천 | 대안 A | 대안 B | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|---|
| HD.bar | HD.root | HD.top | 헤더 줄 전체 (36px). 구분선 2개로 왼쪽, 가운데, 오른쪽 세 영역으로 나뉨 | `logo-header` | |
| HD.zone-left | HD.left | HD.zone-a | 왼쪽 영역 (앱 제목, ID 버튼) | `header-zone--left` | |
| HD.divider | HD.sep | HD.line | 영역 사이 구분선 (2개: 인스턴스 1, 2) | `header-divider` | |
| HD.zone-center | HD.middle | HD.zone-b | 가운데 영역 (긴 빈 공간, 버튼을 옮겨 둘 자리) | `header-zone--center` | |
| HD.zone-right | HD.right | HD.zone-c | 오른쪽 영역 (GitHub 버튼) | `header-zone--right` | |
| HD.title | HD.name | HD.logo | 앱 제목 "DBViewer-tagger" | `logo-header-title` | |
| HD.inspector | HD.ids | HD.tag | Inspector 토글 버튼 (제목 바로 옆 자리에 겹쳐 띄운 위젯, 모달이 열려 있어도 보임) | (없음) | |
| HD.keynote | HD.notes | HD.key-note-btn | "Key 노트" 버튼. 가운데 영역(`HD.zone-center`)의 "이중 뷰" 버튼 오른쪽. 누르면 Keyinfo 창을 Key 노트 탭으로 바로 연다 (푸터 K 버튼과 같은 창) | `split-toggle-btn--header` | |
| HD.github | HD.link | HD.credit | 오른쪽 영역의 "GitHub" 버튼 | `logo-copyright` | |

## SB 사이드바

| 추천 | 대안 A | 대안 B | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|---|
| SB.root | SB.panel | SB.left | 사이드바 전체 | `l-sidebar` | |
| SB.head | SB.actions | SB.top | 맨 위 버튼 줄 (DB, File, 저장된 파일) | `sidebar-header` | |
| SB.db | SB.db-load | SB.db-open | DB 버튼 (Database 아이콘) | `DBButton` / `db-browse-btn` | |
| SB.open | SB.open-csv | SB.file-open | 아이콘 버튼 (CSV 열기, 글자 없음). 헤더에서 DB 버튼 오른쪽, `SB.saved` 왼쪽 | `btn-open` | |
| SB.saved | SB.downloads | SB.local-files | "Local" 버튼 (저장된 파일, Archive 아이콘). 헤더에서 `SB.open` 오른쪽, `SB.workspace` 왼쪽 | `LocalFilesBrowser` / `lf-trigger-btn` | |
| SB.workspace | SB.workspace-btn | SB.folder-settings | 작업 폴더 버튼 (FolderCog 아이콘). 헤더 맨 오른쪽 | `db-browse-btn` | |
| SB.preset | SB.save-load | SB.preset-bar | Preset Save / Preset Load 버튼 묶음 | `save-load-group` | |
| SB.preset-save | SB.save | SB.save-btn | "Preset Save" 버튼 | `save-load-btn` (첫 번째) | |
| SB.preset-load | SB.load | SB.load-btn | "Preset Load" 버튼 | `save-load-btn` (두 번째) | |
| SB.preset-name | SB.json-name | SB.current-preset | 현재 프리셋 파일 이름 표시 | `tree-json-name` | |
| SB.search | SB.find | SB.filter | 파일명 검색 줄 전체 | `sidebar-search` | |
| SB.search-input | SB.find-input | SB.filter-input | 검색 입력칸 (Enter로 적용) | `search-input` | |
| SB.tree | SB.files | SB.list | 파일 트리 영역 전체 | `file-tree` | |
| SB.tree-head | SB.folder-bar | SB.files-head | 트리 맨 위 줄 ("새 폴더" 버튼이 있음) | `tree-list-header` | |
| SB.folder-new | SB.new-folder | SB.folder-add | 새 폴더 버튼 / 이름 입력 줄 | `tree-new-folder-inline-btn`, `tree-folder-create-row` | |
| SB.folder | SB.folder-row | SB.dir | 폴더 행 (반복). 끌어서 폴더 순서를 바꿈 | `tree-folder-header` | |
| SB.file | SB.file-row | SB.item | 파일 행 (반복) | `tree-file-item` | |
| SB.file-comment | SB.file-note | SB.comment | 파일 행의 주석 줄 | `tree-file-meta` / `tree-comment-input` | |
| SB.root-drop | SB.drop-area | SB.outside | 폴더 밖 드롭 영역 ("루트" 안내) | `tree-root-drop` | |
| SB.foot | SB.toggles | SB.bottom | 사이드바 아래 토글 묶음 | `sidebar-footer` | |
| SB.toggle-hidden | SB.hide-toggle | SB.tg-hidden | "숨김 표기" (기본 켜짐, 끄면 숨김 파일이 실종 여부와 관계없이 목록에서 빠짐) | `sf-toggle-row` (1번째) | |
| SB.toggle-comment | SB.note-toggle | SB.tg-comment | "주석 Only" (켜면 주석이 있는 파일만 보임, 기본 꺼짐) | `sf-toggle-row` (2번째) | |
| SB.toggle-missing | SB.missing-toggle | SB.tg-missing | "실종 표기" (기본 켜짐, 끄면 디스크에 없는 파일이 숨김 여부와 관계없이 목록에서 빠짐). 이전 ID: `SB.toggle-3` | `sf-toggle-row` (3번째) | |

## MN 메인 영역

### 위쪽 줄: 제품 버튼 · 툴바

| 추천 | 대안 A | 대안 B | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|---|
| MN.root | MN.area | MN.right | 사이드바를 뺀 메인 전체 | `main-area` | |
| MN.top | MN.header | MN.head | 메인 위쪽 영역 전체 (제품 줄, 시트 탭) | `header-main` | |
| MN.product-bar | MN.products | MN.prod-row | "DB - Load" 버튼과 제품 버튼 줄 | `header-main-1` | |
| MN.product | MN.product-btn | MN.prod | 제품 버튼 (반복, 드래그로 순서 변경). 지금 불러온 프리셋의 제품이면 파란 테두리, 점, `aria-pressed`로 활성 표시 | `header-main-btn` (활성: `header-main-btn--active`) | |
| MN.split | MN.dual-view | MN.split-btn | "이중 뷰" 버튼. 앱 헤더 가운데 영역(`HD.zone-center`)의 왼쪽 끝. GitHub 버튼과 같은 폭 | `split-toggle-btn--header` | |

### 시트 탭 줄

| 추천 | 대안 A | 대안 B | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|---|
| MN.sheet-bar | MN.sheets | MN.tabs-row | 시트 탭 줄 전체. 높이 36px이고 아래 헤더 테두리 1px을 더하면 SB.preset(37px)과 같다 | `header-main-2` | |
| MN.sheet-save | MN.sheet-save-btn | MN.save-sheet | 시트 "저장" 버튼 (변경이 있으면 강조) | `sheet-global-save-btn` | |
| MN.sheet-reset | MN.sheet-restore | MN.reset-sheet | "R" 버튼 (저장된 시트 설정으로 복원) | `sheet-reset-btn` | |
| MN.sheet-tabs | MN.tabs | MN.sheet-list | 탭 목록 ("default" 탭이 있는 고정 쪽) | `sheet-tabs` | |
| MN.sheet-tabs-custom | MN.tabs-scroll | MN.sheet-list-2 | 스크롤 영역의 사용자 시트 탭 목록 | `sheet-tabs--custom` | |
| MN.sheet-tab | MN.tab | MN.sheet | 시트 탭 하나 (반복, "default" 포함) | `sheet-tab` | |
| MN.sheet-add | MN.tab-add | MN.add-sheet | "＋" 시트 추가 버튼 | `sheet-tab-add` | |

### 패널과 테이블

| 추천 | 대안 A | 대안 B | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|---|
| MN.body | MN.content | MN.main | 패널과 오른쪽 빈 사이드바를 감싸는 영역 | `main-body` | |
| MN.panes | MN.pane-area | MN.split-area | 패널 A/B가 놓이는 영역 | `main-content-area` | |
| MN.pane-a | MN.left | MN.pane-1 | 패널 A | `main-pane` (id A) | |
| MN.pane-b | MN.right-pane | MN.pane-2 | 패널 B (이중 뷰일 때) | `main-pane` (id B) | |
| MN.pane-head | MN.pane-bar | MN.pane-top | 패널 위쪽 줄 (A/B, 시트 이름, 파일 이름) | `pane-header` | |
| MN.pane-pin | MN.pin | MN.sheet-pin | 패널의 핀 버튼 (시트 고정) | `pane-pin-btn` | |
| MN.pane-close | MN.close-b | MN.pane-x | 패널 B 닫기 (✕) | `pane-close-btn` | |
| MN.dropzone | MN.drop | MN.empty | 파일이 없을 때의 드롭 영역 | `DropZone` | |
| MN.grid | MN.table | MN.data | CSV 테이블 전체 | `grid-wrapper` | |
| MN.grid-stats | MN.stats | MN.summary | 테이블 위 통계 줄 (행 수, 열 수, 필터) | `stats-bar` | |
| MN.grid-legend | MN.legend | MN.col-list | 통계 줄의 컬럼 타입 범례 | `col-legend` | |
| MN.grid-scroll | MN.scroll | MN.grid-body | 스크롤되는 표 영역 | `table-scroll` | |
| MN.grid-col | MN.col-head | MN.col | 컬럼 헤더 하나 (반복) | `col-header` | |
| MN.grid-sort | MN.sort | MN.sort-btn | 컬럼 헤더의 정렬 버튼 (반복) | `sort-btn` | |
| MN.grid-resize | MN.resize | MN.col-resize | 컬럼 너비 조절 손잡이 (반복) | `resize-handle` | |
| MN.grid-row | MN.row | MN.record | 데이터 행 (반복) | `data-table` > `tr` | |
| MN.grid-cell | MN.cell | MN.data-cell | 데이터 칸 (반복). 클릭하면 값이 클립보드에 복사됨 | `data-cell` | |
| MN.grid-pager | MN.pager | MN.pages | 테이블 아래 페이지 줄 전체 | `pagination-bar` | |
| MN.grid-pager-nav | MN.pager-nav | MN.page-btns | 첫/이전/다음/마지막 버튼 묶음 | `pagination-nav` | |
| MN.grid-pagesize | MN.page-size | MN.size | 페이지 크기 선택 | `pagination-size` | |
| MN.side-right | MN.r-sidebar | MN.empty-side | 메인 오른쪽의 빈 사이드바 | `r-sidebar` | |

## FT 푸터

| 추천 | 대안 A | 대안 B | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|---|
| FT.bar | FT.root | FT.bottom | 푸터 줄 전체 | `main-footer` | |
| FT.hermes | FT.ai | FT.chat | Hermes 버튼 | `footer-hermes-btn` | |
| FT.lorebook | FT.lore | FT.notes | "L" 버튼 | `footer-lorebook-btn` | |
| FT.product | FT.products | FT.prod | "P" 버튼 | `footer-product-btn` | |
| FT.keyinfo | FT.key | FT.keys | "K" 버튼 | `footer-keyinfo-btn` | |
| FT.task | FT.status | FT.bg-task | 백그라운드 작업 이름과 진행 수 | `footer-progress-area` (라벨) | |
| FT.backup | FT.snapshot | FT.bk | "B" 버튼 | `footer-backup-btn` | |
| FT.clear | FT.reset | FT.wipe | "C" 버튼 | `footer-clear-btn` | |
| FT.progress | FT.bar-fill | FT.pbar | 진행 막대 | `footer-progress-bar` | |

---

## 구현 메모

- 모든 ID는 `{...uiId('ID')}`로 붙는다 (`src/renderer/ui/uiId.ts`). 개발 모드에서만 속성이 생긴다.
- `Modal` 컴포넌트를 쓰는 모달은 `uiCode`로 `frame`, `title`, `close`가 자동으로 붙는다: BC, BK, CL, CR, CW, HM, KI, LB, LD, LM, LN, PD, RM, SV.
- `Modal`을 쓰지 않는 창은 같은 3개를 직접 붙였다: DB(`db-panel`, `db-header-title`, `browser-close-btn`), LF(`browser-panel`, 루트 화면의 제목, 닫기 버튼 2곳).
- 팝업 확인창(`*.confirm`)은 `confirm-modal-body`에 붙였다. 확인창의 카드 자체에는 ID가 없다.
- 컴포넌트 안쪽에 붙인 것: `SB.db`(DBButton), `MN.dropzone`(DropZone), `SV.product`와 `LN.product`(CategoryDropdown의 `uiIdValue`).
- 반복 항목: `MN.product`, `KI.product-chip`은 항목 이름도 함께 넘긴다. 나머지 반복 항목은 ID만 붙고 항목 이름은 아직 없다 (Inspector에서 "항목" 줄이 안 나옴).

## ID 바꾸는 방법

1. 코드에서 `uiId('옛ID')`를 새 ID로 바꾼다 (`Modal`은 `uiCode`, 일부는 `uiIdValue`).
2. 이 표의 해당 행도 같이 고친다. 바꾼 내역은 "이전 ID"로 이 문서에 남긴다.
3. 코드의 ID와 표가 맞는지 확인한다 (Claude Code에게 "ID 대조"를 요청한다).

## 기록할 것

- "3 토글"은 "실종 표기"로 이름과 ID(`SB.toggle-3` -> `SB.toggle-missing`)를 바꿨다.
- 우클릭 메뉴와 팝업은 항상 보이지 않는다. Inspector를 켠 상태에서 메뉴를 열면 호버로 확인할 수 있어야 한다.

---

# 2차: 모달

2차는 대안을 하나(대안)만 둔다. 선택 칸 사용법은 1차와 같다 (`추천`, `대안`, 직접 입력, `삭제`).
`Modal` 컴포넌트를 쓰는 모달은 `{코드}.frame`(카드), `{코드}.title`(제목 줄), `{코드}.close`(닫기 ✕)를 공통으로 갖는다. 이 세 개는 아래 표에서 따로 묻지 않는다. 바꾸고 싶으면 알려 달라.
"(반복)"은 목록 항목이다.

## 영역 코드 (제안)

| 코드 | 모달 | 어디서 여는가 |
|---|---|---|
| KI | Keyinfo | 푸터 K 버튼 |
| LB | Lorebook (조회/수정) | 푸터 L 버튼 |
| LN | Lorebook 항목 만들기 (단건) | 컬럼 헤더 |
| LM | Lorebook 항목 만들기 (일괄) | Lorebook 모달 |
| DB | DB 불러오기 창 | 사이드바 DB 버튼 |
| LF | 저장된 파일 창 | 사이드바 Archive 버튼 (`SB.saved`) |
| WS | 작업 폴더 창 | 사이드바 헤더 버튼 (`SB.workspace`), DB 창과 Local 창 위쪽 버튼. 처음 실행하면 자동으로 열림 |
| HM | Hermes | 푸터 Hermes 버튼 |
| PD | Products | 푸터 P 버튼 |
| BK | Backup | 푸터 B 버튼 |
| CL | Clear | 푸터 C 버튼 |
| SV | 프리셋 저장 | 사이드바 "저장" |
| LD | 프리셋 불러오기 | 사이드바 "불러오기" |
| LG | 로딩 표시 | 파일 불러오는 중 |
| BC | 주석 일괄 입력 | 사이드바 파일 우클릭 (2개 이상 선택) |
| RM | 목록에서 제거 확인 | 사이드바 파일 우클릭 (2개 이상 선택) |
| CW | 컬럼 너비 조정 | 컬럼 우클릭 메뉴 |
| CR | 숨김/삭제 초기화 | 컬럼 우클릭 메뉴 |

코드가 마음에 안 들면 이 표에서 먼저 바꿔 달라. 아래 ID의 앞부분이 모두 따라 바뀐다.

## KI Keyinfo

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| KI.ced-save | KI.save-context | Obsidian Vault 전송 버튼 바로 왼쪽의 "Local 저장" 버튼. 지금 고른 제품의 CED를 저장 폴더/<제품>/ 에 씀 (Hermes로 보내지 않음) | `ced-save-btn` | |
| KI.ced-dir | KI.ced-dir-gear | Keyinfo 창 머리글의 제목 오른쪽 톱니. CED 저장 폴더 설정. 이 PC의 폴더를 고를 수 있는 환경에서만 보임 | `ced-dir-btn` | |
| KI.ced-dir-panel | KI.ced-dir-popover | 톱니로 여는 작은 창: 지금 폴더, 폴더 고르기, 기본값으로 | `ced-dir-panel` | |
| KI.export | KI.send-context | 제품 줄 오른쪽 "Obsidian Vault 전송" 버튼. 지금 고른 제품의 맥락 문서(CED)를 만들어 Hermes 서버의 Obsidian 볼트 CED 폴더로 SFTP 전송 (볼트에서 고친 파일도 덮어쓰고 경고로 알림) | `keyinfo-export-btn` | |
| CP.frame | CP.root | Web의 CED 미리보기 창 (Local 저장을 누르면 열림). CP.title, CP.close 포함 | `ced-preview-card` | |
| CP.list | CP.files | 왼쪽 문서 목록 (목차가 맨 위) | `ced-preview-list` | |
| CP.text | CP.content | 오른쪽 마크다운 원문 | `ced-preview-text` | |
| CP.download | CP.zip | "zip 내려받기" 버튼. 제품 폴더 하나로 묶은 zip | `modal-btn--save` | |
| WG.frame | WG.root | Web 입장 화면 전체 (입장 전에만). 데스크톱에는 없음 | `web-gate` | |
| WG.card | WG.form | 입장 카드 (제목, 안내, 코드 칸, 버튼) | `web-gate-card` | |
| WG.notice | WG.trial-notice | 체험판 안내 (24시간·점검 시 삭제, zip으로 받기, DB 접속 정보는 메모리·읽기 전용) | `web-gate-notice` | |
| WG.code | WG.input | 입장 코드 칸 | `web-gate-input` | |
| WG.error | WG.message | 입장 실패 문구 (틀림, 만료, 여러 번 틀림, 세션 끝남) | `web-gate-error` | |
| WG.enter | WG.submit | "들어가기" 버튼 | `web-gate-btn` | |
| KI.product-bar | KI.products | 위쪽 제품 선택 칩 줄 | `keyinfo-product-bar` | |
| KI.product-chip | KI.product | 제품 칩 하나 (반복, 현재 제품은 점 표시) | `keyinfo-product-bar` 안의 버튼 | |
| KI.issue-count | KI.warn-count | 제품 미지정 핀 경고 수 | `keyinfo-issue-count` | |
| KI.tabs | KI.tab-bar | 제품 줄 오른쪽의 탭 (핀 보기 / Key 노트) | `keyinfo-tabs` | |
| KI.left | KI.pins | 왼쪽 핀 목록 영역 전체 | `keyinfo-left` | |
| KI.left-head | KI.pins-head | 왼쪽 위 줄 (새 폴더 버튼, 읽기 전용 배지) | `keyinfo-left-header` | |
| KI.folder-new | KI.new-folder | 새 폴더 버튼 | `keyinfo-new-folder-btn` | |
| KI.readonly | KI.readonly-badge | "읽기 전용" 배지 (다른 제품 조회 시) | `keyinfo-readonly-badge` | |
| KI.list | KI.tree | 폴더와 핀 목록 | `keyinfo-list` | |
| KI.folder | KI.folder-row | 폴더 행 (반복) | `keyinfo-folder-item` | |
| KI.folder-delete | KI.folder-del | 폴더 삭제 버튼 (반복) | `keyinfo-folder-delete` | |
| KI.pin | KI.pin-row | 핀 행 (반복) | `keyinfo-item-info` | |
| KI.right | KI.detail-area | 오른쪽 상세 영역 전체 | `keyinfo-right` | |
| KI.detail | KI.detail-card | 선택한 핀의 상세 | `keyinfo-detail` | |
| KI.detail-comment | KI.pin-comment | 핀 주석 표시 (누르면 편집) | `keyinfo-pin-comment-display` | |
| KI.constraints | KI.schema | PK/FK/타입 제약 목록 | `keyinfo-constraints` | |
| KI.cross | KI.same-key | 다른 제품의 같은 Key 목록 | `keyinfo-cross` | |
| KI.cross-actions | KI.cross-btns | 같은 Key 목록의 액션 버튼들 | `keyinfo-cross-actions` | |
| KI.notes | KI.key-notes | Key 노트 탭 화면 전체 | `kn-pane` | |
| KI.candidates-head | KI.cand-head | 후보 목록 제목 줄 | `kn-section-title` | |
| KI.refresh | KI.note-refresh | 후보 제목 줄 오른쪽 새로고침 버튼. 새 테이블을 색인하고 노트의 출현 목록과 후보를 갱신 | `kn-refresh` | |
| KI.candidates | KI.cand-list | 후보 목록 (수락만 있음. 핀으로 고정한 키의 후보와 보류한 노트가 나옴) | `kn-candidates` | |
| KI.candidate | KI.cand-row | 후보 한 줄 (반복) | `kn-cand` | |
| KI.notelist-head | KI.note-head | 노트 목록 제목 줄과 진행 표시 | `kn-section-title` | |
| KI.progress | KI.note-progress | "Key N개 중 M개 확인됨" 표시 | `kn-progress` | |
| KI.notelist | KI.note-list | 노트 목록 | `kn-notes` | |
| KI.note | KI.note-row | 노트 한 줄 (반복) | `kn-note` | |
| KI.note-editor | KI.note-edit | 오른쪽 노트 편집 영역 | `kn-right` | |
| KI.note-head | KI.note-title-row | 편집 영역 맨 위 줄. 제목(읽기 전용)과 한 줄 정의를 한 줄에 둠 | `kn-row` | |
| KI.keywords | KI.keyword-row | 키워드 줄. 입력 칸과 + 버튼이 왼쪽, 추가한 키워드가 오른쪽에 한 줄로 붙음 | `kn-keywords` | |
| KI.meaning-row | KI.meaning-examples | 값 의미(왼쪽)와 값 예시(오른쪽)를 한 줄에 둔 영역 | `kn-row--meaning` | |
| KI.examples | KI.value-examples | 값 예시 영역. 고른 테이블의 이 Key 컬럼 값을 CSV 앞 20행에서 읽어 작은 표로 보여 줌 (읽기 전용, 셀을 누르면 복사) | `kn-field--examples` | |
| KI.examples-table | KI.examples-select | 값 예시의 테이블 선택 | `kn-ex-select` | |
| KI.examples-skip | KI.examples-filter | 값 예시의 "빈 값·0 제외" 체크박스. 켜면 고른 컬럼 값이 비었거나 0인 행을 뺀 20행을 보여 줌 | `kn-ex-toggle` | |
| KI.examples-refresh | KI.examples-reload | 값 예시 오른쪽 위 작은 새로고침 버튼. CSV를 다시 읽어 예시를 갱신 | `kn-ex-refresh` | |
| KI.examples-grid | KI.examples-table-grid | 값 예시 표. 컬럼 머리글을 누르면 정렬 (작은 값부터, 큰 값부터, 해제). 스크롤하면 50행씩 파일 끝까지 이어 불러옴 | `kn-ex-grid` | |
| KI.note-status | KI.status-switch | 초안 / 확인됨 전환 | `kn-status-switch` | |
| KI.note-suspend | KI.note-pause | "작업 일시 중단" 버튼. 노트를 후보 목록으로 옮김 (적은 내용은 보존) | `kn-link` | |
| KI.summary | KI.product-panel | 아래쪽 제품 요약 패널 | `keyinfo-product-panel` | |
| KI.summary-card | KI.product-card | 제품 요약 카드 (반복) | `keyinfo-product-card` | |
| KI.comment | KI.comment-popup | 핀 주석 편집 팝업 | `keyinfo-comment-modal-body` | |
| KI.confirm | KI.confirm-popup | 삭제 확인 팝업 | `confirm-modal-body` | |

## LB Lorebook (조회/수정)

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| LB.back | LB.back-btn | 수정 화면에서 목록으로 돌아가기 | `lb-back-btn` | |
| LB.filter | LB.filter-bar | 제품 선택과 검색이 있는 줄 | `lb-filter-bar` | |
| LB.product | LB.product-select | 제품 선택 | `lb-product-select` | |
| LB.search | LB.find | 검색 입력 | `lb-search-wrap` | |
| LB.list | LB.items | 항목 목록 | `lb-list` | |
| LB.group | LB.accordion | 파일 단위 접이식 그룹 (반복) | `lb-accordion` | |
| LB.item | LB.entry | 항목 하나 (반복) | `lb-item` | |
| LB.item-actions | LB.entry-btns | 항목의 수정/삭제 버튼 | `lb-item-actions` | |
| LB.form | LB.edit | 항목 수정 폼 (이름, 내용) | `lb-edit-form` | |
| LB.footer | LB.buttons | 아래 버튼 줄 (저장 등) | `modal-footer` | |
| LB.confirm | LB.confirm-popup | 삭제 확인 팝업 | `confirm-modal-body` | |

## LN Lorebook 항목 만들기 (단건)

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| LN.context | LN.target | 대상 파일과 컬럼 배지 | `lb-create-context` | |
| LN.form | LN.fields | 입력 폼 전체 (제품, 이름, 내용) | `lb-edit-form` | |
| LN.product | LN.category | 제품 선택 드롭다운 | `CategoryDropdown` | |
| LN.name | LN.title-input | 항목 이름 입력 | `lb-input` | |
| LN.content | LN.text | 내용 입력 | `lb-textarea` | |
| LN.footer | LN.buttons | 아래 버튼 줄 (저장) | `modal-footer` | |

## LM Lorebook 항목 만들기 (일괄)

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| LM.value | LM.key | 기준 컬럼 값 표시 | `lore-many-value--key` | |
| LM.product | LM.product-value | 제품명 표시 | `lore-many-value` (2번째) | |
| LM.text | LM.content | 공통 내용 입력 | `lore-many-textarea` | |
| LM.targets | LM.files | 적용 대상 파일 목록 | `lore-many-targets` | |
| LM.target | LM.file | 대상 파일 하나 (반복) | `lore-many-file-item` | |
| LM.footer | LM.buttons | 아래 버튼 줄 | `lore-many-footer` | |

## DB DB 불러오기 창

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| DB.header | DB.top | 창 위쪽 줄 (뒤로, 제목, 슬롯 태그, 버튼) | `db-header` | |
| DB.back | DB.back-btn | 뒤로 가기 | `browser-back-btn` | |
| DB.slot-tag | DB.slot-name | 현재 슬롯 이름 태그 | `db-slot-tag` | |
| DB.slot-grid | DB.slots | 슬롯 4개 버튼 영역 (2 x 2) | `db-slot-grid` | |
| DB.slot | DB.slot-btn | 슬롯 버튼 (반복) | `db-slot-btn` | |
| DB.workspace | DB.workspace-btn | 창 위쪽 작업 폴더 버튼 (모든 화면에서 보임) | `db-icon-btn` (1번째) | |
| DB.refresh | DB.reload | 스키마 검색 새로고침 버튼 (스키마 목록 화면에서만 보임) | `db-icon-btn` (1번째) | |
| DB.test | DB.ping | 연결 테스트 버튼 (슬롯 선택 이후 화면에서 보임) | `db-icon-btn` (2번째) | |
| DB.search | DB.schema-search | 스키마 검색 입력 | `db-search-bar` | |
| DB.schema | DB.schema-row | 스키마 행 (반복) | `browser-item` | |
| DB.schema-check | DB.schema-checkbox | 스키마 행 왼쪽 체크박스 (스키마 전체 저장 선택) | `browser-file-checkbox` (스키마 행) | |
| DB.schema-footer | DB.schema-export-bar | 선택한 스키마 개수와 저장 버튼 (스키마 목록 화면) | `browser-panel-footer` | |
| DB.schema-export | DB.schema-export-btn | 스키마 전체 "CSV 저장" 버튼 | `browser-download-btn` (스키마 화면) | |
| DB.schema-count | DB.table-count | 스키마 행 오른쪽의 테이블 개수 | `db-schema-count` | |
| DB.more | DB.load-more | 스키마 목록 아래 "더 보기" 버튼 (50개씩) | `db-more-btn` | |
| DB.table-head | DB.tables-head | 테이블 목록 위 줄 (전체 선택, 개수) | `db-table-header` | |
| DB.table | DB.table-row | 테이블 행 (반복, 체크박스) | `browser-file-row` | |
| DB.conn | DB.settings | 아래쪽 접속 설정 영역 | `db-conn-footer` | |
| DB.conn-toggle | DB.settings-toggle | 접속 설정 펼침, 접힘 버튼 | `db-conn-toggle` | |
| DB.conn-name | DB.slot-name-input | 슬롯 이름 입력 | `db-ssh-field` (접속 1번째) | |
| DB.conn-folder | DB.save-folder | 저장 폴더 이름 입력 (CSV 저장 위치의 DB 폴더) | `db-ssh-field` (접속 2번째) | |
| DB.conn-host | DB.db-host | DB 호스트 입력 | `db-ssh-field--grow` (접속) | |
| DB.conn-port | DB.db-port | DB 포트 입력 | `db-ssh-field--port` (접속) | |
| DB.conn-database | DB.db-name | DB 이름 입력 | `db-ssh-field` (접속 3번째) | |
| DB.conn-user | DB.db-user | DB 사용자 이름 입력 | `db-ssh-field--grow` (접속) | |
| DB.conn-password | DB.db-password | DB 비밀번호 입력 | `db-ssh-field--grow` (접속) | |
| DB.conn-ssl | DB.tls | "SSL/TLS로 연결 (서버 인증서 확인)" 선택 칸. 켜면 TLS로 연결하고 인증서를 확인함 | `db-ssl-row` | |
| DB.ssh | DB.tunnel | SSH 터널 소제목 | `db-conn-sub` | |
| DB.ssh-host | DB.host | SSH 호스트 입력 | `db-ssh-field--grow` | |
| DB.ssh-port | DB.port | SSH 포트 입력 | `db-ssh-field--port` | |
| DB.ssh-user | DB.user | SSH 사용자 이름 입력 | `db-ssh-field` (3번째) | |
| DB.ssh-key | DB.pem | PEM 키 경로 선택 | `db-ssh-pem-row` | |
| DB.ssh-key-field | DB.pem-field | PEM 키 칸 전체 (라벨 포함) | `db-ssh-field` (4번째) | |
| DB.footer | DB.export-bar | 선택한 테이블 개수와 내보내기 버튼 | `browser-panel-footer` | |
| DB.export | DB.export-btn | "내보내기" 버튼 | `browser-download-btn` | |
| DB.progress | DB.export-progress | 내보내기 진행 창 | `db-export-card` | |
| DB.abort | DB.cancel-export | 내보내기 중단 버튼 | `db-export-abort-btn` | |

## LF 저장된 파일 창

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| LF.back | LF.back-btn | 뒤로 가기 (최상위에서는 창 닫기) | `browser-back-btn` | |
| LF.path | LF.breadcrumb | 현재 폴더 경로 표시 (`Local\\스키마`) | `browser-panel-path` | |
| LF.workspace | LF.workspace-btn | 창 위쪽 "작업 폴더" 버튼 (작업 폴더 창 열기) | `lf-explorer-btn` (2번째) | |
| LF.explorer | LF.open-explorer | "탐색기에서 열기" 버튼 (현재 폴더를 연다) | `lf-explorer-btn` | |
| LF.search | LF.find | 검색 입력 | `browser-search-wrap` | |
| LF.select-all | LF.all | 전체 선택 체크박스 | `browser-select-all` | |
| LF.folder | LF.folder-row | 폴더 행 (반복) | `lf-folder-row` | |
| LF.folder-check | LF.schema-check | 폴더 행 왼쪽 체크박스 (DB 폴더, 스키마 폴더 모두. 하위 폴더 포함 선택) | `lf-folder-check` | |
| LF.folder-delete | LF.folder-del | 폴더 삭제 버튼 (반복) | `lf-folder-delete-btn` | |
| LF.file | LF.file-row | 파일 행 (반복, 체크박스) | `browser-file-row` | |
| LF.footer | LF.bottom | 아래 줄 (선택 개수, 삭제, 불러오기) | `browser-panel-footer` | |
| LF.delete | LF.delete-btn | 선택 삭제 버튼 | `lf-footer-delete-btn` | |
| LF.load | LF.open | "불러오기" 버튼 | `browser-download-btn` | |
| LF.confirm | LF.confirm-popup | 삭제 확인 팝업 | `confirm-modal-body` | |

## WS 작업 폴더 창

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| WS.frame | WS.card | 창 전체 (공용 Modal이 붙임) | `workspace-modal-card` | |
| WS.title | WS.heading | 창 제목 (공용 Modal이 붙임) | `modal-title` | |
| WS.close | WS.x | 닫기 버튼 (처음 실행 안내에서는 없음) | `modal-close-btn` | |
| WS.body | WS.content | 설명과 폴더 경로 영역 | `workspace-body` | |
| WS.path | WS.folder-path | 작업 폴더 경로 표시 | `workspace-path` | |
| WS.footer | WS.buttons | 아래 버튼 줄 | `modal-footer` | |
| WS.use-default | WS.use | "이 위치 사용" 버튼 (처음 실행 안내) | `modal-btn--save` | |
| WS.pick | WS.change | "다른 폴더 선택" 또는 "폴더 변경" 버튼 | `modal-btn` | |
| WS.open | WS.explorer | "탐색기에서 열기" 버튼 (설정 창) | `modal-btn--cancel` | |
| WS.apply | WS.change-confirm | "바꾸기" 버튼 (폴더 변경 확인, 누르면 화면이 새로고침됨) | `modal-btn--save` | |

## HM Hermes

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| HM.readonly | HM.view-only | 제목 옆 "보기 전용" 표시 | `hermes-readonly-badge` | |
| HM.profiles | HM.profile-bar | 프로필 줄 (프로필 선택, 추가) | `hermes-profile-bar` | |
| HM.profile | HM.profile-chip | 프로필 하나 (반복). 클릭하면 선택, 우클릭하면 이름 변경과 삭제 | `hermes-profile-chip` | |
| HM.profile-add | HM.add-profile | 프로필 추가 버튼 | `hermes-profile-add` | |
| HM.profile-rename | HM.rename | 프로필 이름 변경 입력 | `hermes-profile-rename` | |
| HM.profile-menu | HM.profile-ctx | 프로필 우클릭 메뉴 (이름 변경, 삭제) | `hermes-ctx` | |
| HM.profile-delete-confirm | HM.delete-bar | 프로필 삭제 확인 줄 | `hermes-delete-bar` | |
| HM.sessions | HM.side | 왼쪽 세션 목록 영역 (보기만 함) | `hermes-sidebar` | |
| HM.view-tabs | HM.read-mode | 세션 목록 위의 MD / TXT 읽기 방식 전환 | `hermes-view-tabs` | |
| HM.session | HM.session-row | 세션 하나 (반복) | `hermes-session-title` | |
| HM.main | HM.chat | 오른쪽 대화 영역 | `hermes-main` | |
| HM.config | HM.settings | 연결 설정 화면 | `hermes-config` | |
| HM.config-url | HM.url | 서버 주소 입력 | `hermes-config-input` (1번째) | |
| HM.config-key | HM.api-key | API 키 입력 | `hermes-config-input` (2번째) | |
| HM.ssh-toggle | HM.ssh-accordion | SSH 터널 접이식 제목줄 | `hermes-accordion-head` | |
| HM.ssh-alias | HM.ssh-host-alias | SSH 별칭 입력. ~/.ssh/config의 Host 이름을 적으면 시스템 ssh로 접속 | `hermes-config-input` | |
| HM.ssh | HM.ssh-area | SSH 터널 설정 영역 | `hermes-accordion-body` | |
| HM.vault-toggle | HM.vault-accordion | 볼트 전송(CED) 접이식 제목줄 | `hermes-accordion-head` | |
| HM.vault | HM.vault-area | 볼트 전송 설정 영역 (볼트 경로, 연결 시험, 구조 보기) | `hermes-accordion-body` | |
| HM.vault-path | HM.vault-input | 서버 PC의 Obsidian 볼트 절대 경로 입력 | `hermes-config-input` | |
| HM.vault-test | HM.vault-test-btn | "볼트 연결 시험" 버튼. 경로, .obsidian, 쓰기 권한을 확인 | `hermes-config-save` | |
| HM.vault-list | HM.vault-tree-btn | "구조 보기" 버튼. 볼트 폴더 이름만 두 단계까지 보여 줌 | `hermes-config-save` | |
| HM.vault-result | HM.vault-msg | 볼트 시험 결과 문구 | `hermes-test-ok`, `hermes-test-fail` | |
| HM.vault-tree | HM.vault-folders | 볼트 폴더 구조 목록 | `hermes-vault-tree` | |
| HM.logout | HM.logout-check | "앱을 끄면 로그아웃" 체크박스 | `hermes-check--logout` | |
| HM.config-test | HM.test-btn | "연결 확인" 버튼 | `hermes-config-save` | |
| HM.config-result | HM.test-result | 연결 확인 결과 문구 | `hermes-test-ok`, `hermes-test-fail` | |
| HM.messages | HM.thread | 메시지 목록 (보기만 함) | `hermes-messages` | |
| HM.message | HM.bubble | 메시지 하나 (반복) | `hermes-msg` | |
| HM.think | HM.thinking | 접히는 "Thinking ..." 블록 (생각, 도구 실행 결과) | `hermes-think` | |
| HM.message-failed | HM.bad-message | 그리지 못한 메시지 자리의 "표시할 수 없음" | `hermes-msg-failed` | |

## PD Products

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| PD.list | PD.items | 제품 목록 | `product-list` | |
| PD.item | PD.row | 제품 행 (반복) | `product-item` | |
| PD.item-actions | PD.row-btns | 제품 행의 수정/삭제 버튼 | `product-item-actions` | |
| PD.add | PD.add-row | 새 제품 추가 줄 | `product-add-row` | |
| PD.add-input | PD.new-name | 새 제품명 입력 | `product-add-input` | |
| PD.add-btn | PD.add-button | "추가" 버튼 | `product-add-btn` | |
| PD.confirm | PD.confirm-popup | 삭제 확인 팝업 | `confirm-modal-body` | |

## BK Backup

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| BK.left | BK.list-area | 왼쪽 백업 목록 영역 | `backup-left` | |
| BK.item | BK.row | 백업 하나 (반복) | `backup-item-title` | |
| BK.right | BK.detail-area | 오른쪽 영역 | `backup-right` | |
| BK.create | BK.new-form | 새 백업 만들기 폼 | `backup-create-form` | |
| BK.create-title | BK.title-input | 백업 제목 입력 | `backup-input` | |
| BK.create-comment | BK.comment-input | 백업 주석 입력 | `backup-textarea` | |
| BK.create-btn | BK.create-confirm | 만들기 확인 버튼 | `backup-confirm-btn` | |
| BK.detail | BK.info | 선택한 백업의 상세 | `backup-detail` | |
| BK.footer | BK.buttons | 아래 버튼 줄 (복원, 삭제) | `modal-footer` | |
| BK.restore | BK.restore-btn | 복원 버튼 ("불러오기") | `modal-btn` (불러오기) | |
| BK.delete | BK.delete-btn | 삭제 버튼 | `modal-btn--danger` | |
| BK.confirm | BK.restore-warning | 복원 경고 팝업 | `backup-restore-warning` | |

## CL Clear, SV 저장, LD 불러오기, LG 로딩

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| CL.body | CL.message | Clear 안내 문구 | `clear-modal-body` | |
| CL.submit | CL.clear-btn | Clear 실행 버튼 | `clear-submit-btn` | |
| SV.wing | SV.existing | 기존 프리셋 목록 날개 | `save-modal-wing` | |
| SV.wing-search | SV.existing-search | 날개의 검색 | `save-modal-wing-search` | |
| SV.wing-sort | SV.existing-sort | 날개의 정렬 | `save-modal-wing-sort` | |
| SV.wing-item | SV.existing-row | 기존 프리셋 하나 (반복) | `save-modal-wing-item` | |
| SV.product | SV.category | 제품명 선택 | `CategoryDropdown` | |
| SV.name | SV.filename | 파일 이름 입력 | `modal-input` | |
| SV.current | SV.current-json | 현재 프리셋 이름 표시 | `modal-current-json` | |
| SV.footer | SV.buttons | 아래 버튼 줄 (저장) | `modal-footer` | |
| SV.confirm | SV.overwrite | 덮어쓰기 확인 팝업 | `confirm-modal-body` | |
| LD.group | LD.accordion | 제품별 접이식 그룹 (반복) | `load-accordion-group` | |
| LD.preset | LD.row | 프리셋 행 (반복) | `load-preset-item` | |
| LD.preset-delete | LD.row-del | 프리셋 삭제 (반복) | `load-preset-delete-btn` | |
| LD.current | LD.current-json | 현재 프리셋 이름 표시 | `load-modal-current-json` | |
| LD.footer | LD.buttons | 아래 버튼 줄 | `modal-footer` | |
| LD.confirm | LD.confirm-popup | 삭제 확인 팝업 | `confirm-modal-body` | |
| LG.card | LG.box | 로딩 카드 | `loading-modal-card` | |
| LG.message | LG.text | 로딩 메시지 | `loading-message` | |
| LG.bar | LG.progress | 로딩 막대 | `loading-bar-track` | |

## BC 주석 일괄 입력, RM 목록에서 제거 확인

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| BC.text | BC.content | 모든 선택 파일에 넣을 주석 입력 | `keyinfo-comment-textarea` | |
| BC.footer | BC.buttons | 아래 버튼 줄 (취소, 적용) | `modal-footer` | |
| RM.confirm | RM.message | 제거 확인 문구 | `confirm-modal-body` | |
| RM.footer | RM.buttons | 아래 버튼 줄 (취소, 제거) | `modal-footer` | |

## CW 컬럼 너비 조정, CR 숨김/삭제 초기화

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| CW.input | CW.width | 너비 입력 | `col-width-modal-input` | |
| CW.footer | CW.buttons | 아래 버튼 줄 | `modal-footer` | |
| CR.list | CR.columns | 되살릴 컬럼 목록 | `col-reset-list` | |
| CR.item | CR.row | 컬럼 하나 (반복) | `col-reset-item` | |
| CR.reset | CR.restore-btn | 초기화 버튼 (반복) | `col-reset-btn` | |

## 영역에 속한 팝업과 메뉴 (MN, SB에 추가)

| 추천 | 대안 | 위치/설명 | 코드 | 선택 |
|---|---|---|---|---|
| MN.grid-menu | MN.col-menu | 컬럼 헤더 우클릭 메뉴 | `col-ctx-menu` (DataGrid) | |
| MN.grid-menu-item | MN.col-menu-item | 우클릭 메뉴 항목 (반복) | `col-ctx-item` | |
| MN.grid-filter | MN.filter | 컬럼 필터 팝업 | `cfp` | |
| MN.grid-filter-search | MN.filter-search | 필터 팝업의 값 검색 | `cfp-search-row` | |
| MN.grid-filter-list | MN.filter-values | 필터 팝업의 값 목록 | `cfp-list` | |
| MN.grid-filter-foot | MN.filter-buttons | 필터 팝업 아래 버튼 (적용, 취소) | `cfp-footer` | |
| MN.grid-filter-lore | MN.filter-lorebook | 필터 팝업의 Lorebook 바 | `cfp-lorebook-bar` | |
| SB.menu | SB.ctx-menu | 사이드바 우클릭 메뉴 | `SidebarContextMenu` (`col-ctx-menu`) | |
| SB.menu-item | SB.ctx-item | 사이드바 메뉴 항목 (반복) | `col-ctx-item` | |
