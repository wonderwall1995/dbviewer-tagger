// 보류 (LEGACY): 이 파일은 2026-10-14에 src/legacy로 옮겼다.
// 이유: 화면에서 호출하는 곳이 없다 (EditorOverlay 컴포넌트가 이미 없다).
// 이 폴더는 빌드와 typecheck에 포함되지 않는다.
// 복원 방법은 같은 폴더의 README.md를 참조한다.

// 원래 위치: src/renderer/electron.d.ts
// [1] electronAPI 항목
      editorListTemplates: () => Promise<EditorTemplateMeta[]>
      editorLoadTemplate: (id: string) => Promise<EditorTemplate | null>
      editorSaveTemplate: (template: EditorTemplate) => Promise<EditorTemplate>
      editorDeleteTemplate: (id: string) => Promise<void>
    editorView?: EditorViewState

// [2] 도메인 타입
  interface EditorViewState {
    leftSheetId: string | null
    rightSheetId: string | null
    leftFile: string | null
    rightFile: string | null
    keyFields: Array<{ leftCol: string; rightCol: string }>
  }

  interface EditorTableGroup {
    id: string
    label: string
    aTable: string | null
    bTable: string | null
  }

  interface EditorKeyBinding {
    id: string
    label: string
    aCol: string
    bCol: string
    value: string
    tables: EditorTableGroup[]
  }

  interface EditorTemplate {
    id: string
    name: string
    createdAt: string
    updatedAt: string
    sheetA: string | null
    sheetAName: string | null
    sheetB: string | null
    sheetBName: string | null
    keyBindings: EditorKeyBinding[]
  }

  interface EditorTemplateMeta {
    id: string
    name: string
    updatedAt: string
    sheetAName: string | null
    sheetBName: string | null
  }


// [3] LocalPreset 인터페이스에 있던 항목
//   editorView?: EditorViewState
