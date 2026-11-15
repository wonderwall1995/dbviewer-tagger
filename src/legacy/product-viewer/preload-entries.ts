// 보류 (LEGACY): 이 파일은 2026-10-14에 src/legacy로 옮겼다.
// 이유: 커스텀 테이블(제품 뷰어) 기능은 현재 범위에서 제외했다.
// 이 폴더는 빌드와 typecheck에 포함되지 않는다.
// 복원 방법은 같은 폴더의 README.md를 참조한다.

// 원래 위치: src/main/preload.ts, contextBridge.exposeInMainWorld('electronAPI', {...}) 객체 안
  customtableOpenViewer: (product: string | null, tableId?: string) => ipcRenderer.invoke('customtable:openViewer', { product, tableId }),
  customtableHasAutosave: (product: string | null, id: string) => ipcRenderer.invoke('customtable:hasAutosave', product, id),
  customtableRestore: (product: string | null, id: string) => ipcRenderer.invoke('customtable:restore', product, id),
  customtableList: (product: string | null) => ipcRenderer.invoke('customtable:list', product),
  customtableListFolders: (product: string | null) => ipcRenderer.invoke('customtable:listFolders', product),
  customtableSaveFolder: (product: string | null, folder: unknown) => ipcRenderer.invoke('customtable:saveFolder', product, folder),
  customtableDeleteFolder: (product: string | null, folderId: string) => ipcRenderer.invoke('customtable:deleteFolder', product, folderId),
  customtableAssignFolder: (product: string | null, tableId: string, folderId: string | null) => ipcRenderer.invoke('customtable:assignFolder', product, tableId, folderId),
  customtableLoad: (product: string | null, id: string) => ipcRenderer.invoke('customtable:load', product, id),
  customtableSave: (table: unknown) => ipcRenderer.invoke('customtable:save', table),
  customtableAutosave: (table: unknown) => ipcRenderer.invoke('customtable:autosave', table),
  customtableDelete: (product: string | null, id: string) => ipcRenderer.invoke('customtable:delete', product, id),
