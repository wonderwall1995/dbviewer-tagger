// 보류 (LEGACY): 이 파일은 2026-10-14에 src/legacy로 옮겼다.
// 이유: 화면에서 호출하는 곳이 없다 (EditorOverlay 컴포넌트가 이미 없다).
// 이 폴더는 빌드와 typecheck에 포함되지 않는다.
// 복원 방법은 같은 폴더의 README.md를 참조한다.

// 원래 위치: src/main/preload.ts, contextBridge.exposeInMainWorld('electronAPI', {...}) 객체 안
  editorListTemplates: () => ipcRenderer.invoke('editor:listTemplates'),
  editorLoadTemplate: (id: string) => ipcRenderer.invoke('editor:loadTemplate', id),
  editorSaveTemplate: (template: unknown) => ipcRenderer.invoke('editor:saveTemplate', template),
  editorDeleteTemplate: (id: string) => ipcRenderer.invoke('editor:deleteTemplate', id),
