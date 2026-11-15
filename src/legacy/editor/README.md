# A/B 비교 에디터 - 보류

상태: 보류. 2026-10-14에 `src/legacy/`로 옮겼다.
이 폴더는 빌드와 typecheck에 포함되지 않는다.

## 기능

시트 두 개의 CSV를 키 바인딩으로 비교하는 템플릿 에디터. 화면 컴포넌트(`EditorOverlay`)는 이미 삭제된 상태였고, 저장소(IPC)와 타입, CSS만 남아 있었다.

## 파일

| 파일 | 원래 위치 |
|---|---|
| `main-handlers.ts` | `src/main/main.ts` (`editor:*` 핸들러 4개와 `EDITOR_DIR`) |
| `preload-entries.ts` | `src/main/preload.ts` (`editor*` 항목) |
| `electron-types.d.ts` | `src/renderer/electron.d.ts` (`editor*` 항목, `Editor*` 타입, `LocalPreset.editorView`) |
| `editor.css` | `src/renderer/styles.css` (`.editor-*` 규칙) |

## App.tsx에서 제거한 것

- `EditorViewState` 상태와 기본값
- 작업공간 저장 시 `editorView` 필드 (`localSave`, 프리셋 저장)
- 프리셋 불러오기 시 `editorView` 복원

기존 프리셋 JSON에 `editorView` 필드가 있어도 불러오기에는 문제가 없다. 앱이 이 필드를 읽지 않는다. 다음에 저장하면 이 필드는 사라진다.

## 복원 순서

1. 각 파일의 내용을 원래 위치에 붙인다.
2. `App.tsx`에 `EditorViewState` 상태와 저장/불러오기 연결을 다시 넣는다.
3. 컴포넌트(`EditorOverlay`)는 Git 히스토리에서 찾는다.

## 데이터

`local/editor/{id}.editor.json` 파일은 삭제하지 않았다.
