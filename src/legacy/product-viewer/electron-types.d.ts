// 보류 (LEGACY): 이 파일은 2026-10-14에 src/legacy로 옮겼다.
// 이유: 커스텀 테이블(제품 뷰어) 기능은 현재 범위에서 제외했다.
// 이 폴더는 빌드와 typecheck에 포함되지 않는다.
// 복원 방법은 같은 폴더의 README.md를 참조한다.

// 원래 위치: src/renderer/electron.d.ts (Window.electronAPI 타입과 같은 declare global 블록)
// [1] electronAPI 항목
      customtableOpenViewer: (product: string | null, tableId?: string) => Promise<void>
      customtableHasAutosave: (product: string | null, id: string) => Promise<boolean>
      customtableRestore: (product: string | null, id: string) => Promise<CustomTable | null>
      customtableList: (product: string | null) => Promise<CustomTableMeta[]>
      customtableListFolders: (product: string | null) => Promise<CustomTableFolder[]>
      customtableSaveFolder: (product: string | null, folder: CustomTableFolder) => Promise<void>
      customtableDeleteFolder: (product: string | null, folderId: string) => Promise<void>
      customtableAssignFolder: (product: string | null, tableId: string, folderId: string | null) => Promise<void>
      customtableLoad: (product: string | null, id: string) => Promise<CustomTable | null>
      customtableSave: (table: CustomTable) => Promise<CustomTable>
      customtableAutosave: (table: CustomTable) => Promise<void>
      customtableDelete: (product: string | null, id: string) => Promise<void>

// [2] 도메인 타입
  interface CustomTableColumn {
    id: string
    keyinfoKey: string
    csvFile: string | null
    csvColumn: string | null
    isAnchor: boolean
    label: string | null
  }

  interface CustomTable {
    id: string
    name: string
    product: string | null
    columns: CustomTableColumn[]
    rows: Record<string, string>[]
    folderId?: string | null
  }

  interface CustomTableMeta {
    id: string
    name: string
    product: string | null
    columnCount: number
    rowCount: number
    folderId?: string | null
  }

  interface CustomTableFolder {
    id: string
    name: string
  }

