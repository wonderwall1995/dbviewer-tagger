# 제품 뷰어 (커스텀 테이블) - 보류

상태: 보류. 2026-10-14에 `src/legacy/`로 옮겼다.
이 폴더는 빌드와 typecheck에 포함되지 않는다 (`tsconfig.json`은 `src/renderer`만, `tsconfig.main.json`은 `src/main`만 포함한다).

## 기능

앵커 Key 하나를 기준으로 여러 CSV의 컬럼 값을 한 테이블에 모은다. 저장, 자동저장, 복원, 폴더 분류, 별도 창 열기를 지원한다.

## 파일

| 파일 | 원래 위치 |
|---|---|
| `ProductViewer.tsx` | `src/renderer/components/` |
| `ProductViewerWindow.tsx` | `src/renderer/components/` |
| `main-handlers.ts` | `src/main/main.ts` (`customtable:*` 핸들러 12개와 `CUSTOMTABLE_BASE`) |
| `preload-entries.ts` | `src/main/preload.ts` (`customtable*` 항목) |
| `electron-types.d.ts` | `src/renderer/electron.d.ts` (`customtable*` 항목과 `CustomTable*` 타입) |
| `product-viewer.css` | `src/renderer/styles.css` (`.pview-*` 규칙) |

## 복원 순서

1. 두 `.tsx` 파일을 `src/renderer/components/`로 옮긴다.
2. `main-handlers.ts`의 내용을 `src/main/main.ts`에 붙인다. `let productViewerWin: BrowserWindow | null = null`도 선언한다.
3. `preload-entries.ts`의 항목을 `preload.ts`의 객체에 붙인다.
4. `electron-types.d.ts`의 항목과 타입을 `electron.d.ts`에 붙인다.
5. `product-viewer.css`의 규칙을 `styles.css`에 붙인다.
6. `App.tsx`에서 `ProductViewer`를 import하고, 제품 뷰어 토글 버튼에 상태(`editorOpen`)를 연결한다.
7. `main.tsx`에서 `?productViewer` 인자로 `ProductViewerWindow`를 그리는 분기를 추가한다.
8. 이 파일들의 상단 `LEGACY` 주석을 지운다.

## 데이터

저장된 커스텀 테이블은 `local/customtable/{제품 또는 none}/`에 남아 있다. 이 구역에서는 삭제하지 않았다.
