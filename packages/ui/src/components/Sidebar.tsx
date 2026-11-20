import { useState, useMemo, useRef, useEffect } from 'react'
import {
  FolderOpen,
  Folder,
  FileText,
  Search,
  Plus,
  ChevronRight,
  ChevronDown,
  Loader2,
  FolderCog,
  FileX,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { ParsedCsv, FolderItem } from '@tagger/shared'
import type { PendingFileEntry } from '../App'
import { uiId } from '../ui/uiId'

// 폴더 순서를 바꾸는 드래그에만 쓰는 형식. 파일 드래그(fileNames)와 구분한다.
const FOLDER_DRAG_TYPE = 'application/x-dbviewer-folder'
import { Modal } from './Modal'

interface SidebarProps {
  files: ParsedCsv[]
  pendingFiles: Record<string, PendingFileEntry>
  activeFile: string | null
  onSelectFile: (name: string) => void
  onOpenDialog: () => void
  searchQuery: string
  onSearchChange: (q: string) => void
  actions?: ReactNode
  // 작업 폴더 창을 여는 함수. 헤더 맨 오른쪽 버튼에 쓴다.
  onOpenWorkspace?: () => void
  folders: FolderItem[]
  fileToFolder: Record<string, string>
  onCreateFolder: (name: string) => void
  onRenameFolder: (folderId: string, name: string) => void
  onMoveFile: (fileName: string, folderId: string | null) => void
  // 폴더 순서 바꾸기: draggedId 폴더를 targetId 폴더의 앞(before) 또는 뒤(after)로 옮긴다.
  onReorderFolders: (draggedId: string, targetId: string, side: 'before' | 'after') => void
  onToggleFolder: (folderId: string) => void
  onRemoveFile: (name: string) => void
  onDeleteFolder: (folderId: string) => void
  onSaveClick: () => void
  onLoadClick: () => void
  currentJsonName?: string | null
  // 이름 표기에 마우스를 올렸을 때 보여줄 설명. 없으면 이름을 보여준다.
  currentJsonTitle?: string
  disableLoad?: boolean
  selectedFileNames: Set<string>
  onSelectionChange: (names: Set<string>) => void
  localFilesBrowser?: ReactNode
  hiddenFiles: Set<string>
  // 파일을 열지 않고 센 행 수, 열 수. undefined는 계산 중, null은 계산하지 못함.
  fileStats?: Record<string, CsvStats | null>
  fileComments: Record<string, string>
  // 이름 목록의 숨김 상태를 한 번에 정한다 (hidden=true면 숨김, false면 해제).
  onSetFilesHidden: (names: string[], hidden: boolean) => void
  onCommentSave: (name: string, text: string) => void
  // 이름 목록의 파일 모두에 같은 주석을 넣는다.
  onCommentSaveMany: (names: string[], text: string) => void
  sidebarDirty: boolean
}

// ── Context menu ──────────────────────────────────────────────────────────────

type CtxTarget =
  | { kind: 'file'; names: string[]; x: number; y: number }
  | { kind: 'folder'; id: string; name: string; x: number; y: number }

function SidebarContextMenu({
  target,
  onNewFolder,
  onRenameFolder,
  hiddenFiles,
  onRemoveFiles,
  onDeleteFolder,
  onToggleHidden,
  onCommentFiles,
  onClose,
}: {
  target: CtxTarget
  onNewFolder: () => void
  onRenameFolder: (id: string) => void
  hiddenFiles: Set<string>
  onRemoveFiles: (names: string[]) => void
  onDeleteFolder: (id: string) => void
  onToggleHidden: (names: string[]) => void
  onCommentFiles: (names: string[]) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const didMount = useRef(false)
  if (!didMount.current) {
    didMount.current = true
    setTimeout(() => {
      const onDown = (e: MouseEvent) => {
        if (ref.current && !ref.current.contains(e.target as Node)) {
          onCloseRef.current(); cleanup()
        }
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { onCloseRef.current(); cleanup() }
      }
      const cleanup = () => {
        document.removeEventListener('mousedown', onDown)
        document.removeEventListener('keydown', onKey)
      }
      document.addEventListener('mousedown', onDown)
      document.addEventListener('keydown', onKey)
    }, 0)
  }

  const left = Math.min(target.x, window.innerWidth - 180)
  const top = Math.min(target.y, window.innerHeight - 160)

  return (
    <div ref={ref} className="col-ctx-menu" {...uiId('SB.menu')} style={{ left, top }}>
      {target.kind === 'folder' && (
        <>
          <button className="col-ctx-item" {...uiId('SB.menu-item')} onClick={() => { onNewFolder(); onClose() }}>
            새 폴더
          </button>
          <button className="col-ctx-item" {...uiId('SB.menu-item')} onClick={() => { onRenameFolder(target.id); onClose() }}>
            이름 변경
          </button>
          <div className="col-ctx-divider" />
          <button className="col-ctx-item col-ctx-danger" {...uiId('SB.menu-item')} onClick={() => { onDeleteFolder(target.id); onClose() }}>
            폴더 삭제
          </button>
        </>
      )}
      {target.kind === 'file' && (() => {
        const { names } = target
        const suffix = names.length > 1 ? ` (${names.length}개)` : ''
        // 보이는 파일이 하나라도 있으면 전부 숨기고, 전부 숨겨져 있으면 전부 해제한다.
        const willHide = names.some((n) => !hiddenFiles.has(n))
        return (
          <>
            <button className="col-ctx-item" {...uiId('SB.menu-item')} onClick={() => { onCommentFiles(names); onClose() }}>
              {names.length > 1 ? `주석 일괄 입력${suffix}` : '주석'}
            </button>
            <button className="col-ctx-item col-ctx-warn" {...uiId('SB.menu-item')} onClick={() => { onToggleHidden(names); onClose() }}>
              {willHide ? '숨김 처리' : '숨김 해제'}{suffix}
            </button>
            <div className="col-ctx-divider" />
            <button className="col-ctx-item col-ctx-danger" {...uiId('SB.menu-item')} onClick={() => { onRemoveFiles(names); onClose() }}>
              목록에서 제거{suffix}
            </button>
          </>
        )
      })()}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export function Sidebar({
  files,
  pendingFiles,
  activeFile,
  onSelectFile,
  onOpenDialog,
  searchQuery,
  onSearchChange,
  actions,
  onOpenWorkspace,
  folders,
  fileToFolder,
  onCreateFolder,
  onRenameFolder,
  onMoveFile,
  onReorderFolders,
  onToggleFolder,
  onRemoveFile,
  onDeleteFolder,
  onSaveClick,
  onLoadClick,
  currentJsonName,
  currentJsonTitle,
  disableLoad = false,
  selectedFileNames,
  onSelectionChange,
  localFilesBrowser,
  hiddenFiles,
  fileStats,
  fileComments,
  onSetFilesHidden,
  onCommentSave,
  onCommentSaveMany,
  sidebarDirty,
}: SidebarProps) {
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderName, setRenameFolderName] = useState('')
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragCount, setDragCount] = useState(0)
  // 폴더 순서 바꾸기 드래그 상태: 끌고 있는 폴더, 놓을 위치(대상 폴더의 앞 또는 뒤)
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null)
  const [folderDrop, setFolderDrop] = useState<{ id: string; side: 'before' | 'after' } | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxTarget | null>(null)
  const lastClickedRef = useRef<string | null>(null)
  const dragCounterRef = useRef<Record<string, number>>({})

  const [editingComment, setEditingComment] = useState<string | null>(null)
  // 여러 파일에 같은 주석을 넣는 창과 제거 확인 창의 대상 파일 이름 목록
  const [commentBatch, setCommentBatch] = useState<string[] | null>(null)
  const [commentBatchText, setCommentBatchText] = useState('')
  const [removeConfirm, setRemoveConfirm] = useState<string[] | null>(null)
  // 숨김 표기, 실종 표기: 기본은 켜짐이다. 끄면 그 상태의 파일이 목록에서 빠진다.
  // 가리는 조건은 OR로 묶는다. 숨김이면서 실종인 파일은 두 토글 중 하나라도 꺼져 있으면 빠진다.
  const [showHidden, setShowHidden] = useState(true)
  const [showMissing, setShowMissing] = useState(true)
  // 주석 Only: 켜면 주석이 있는 파일만 보여준다. 기본은 꺼짐이다.
  const [showOnlyCommented, setShowOnlyCommented] = useState(false)

  const [searchInput, setSearchInput] = useState('')
  const [fileNameFilter, setFileNameFilter] = useState('')

  const { filesByFolder, rootFiles } = useMemo(() => {
    const fileSet = new Set<string>(files.map((f) => f.fileName))
    const q = fileNameFilter.toLowerCase()
    const allNames = [
      ...Object.keys(pendingFiles),
      ...[...fileSet].filter((n) => !pendingFiles[n]),
    ].filter((n) => {
      if (q && !n.toLowerCase().includes(q)) return false
      const isHiddenFile = hiddenFiles.has(n)
      const isMissingFile = !!fileStats?.[n]?.missing
      if ((isHiddenFile && !showHidden) || (isMissingFile && !showMissing)) return false
      if (showOnlyCommented && !fileComments[n]) return false
      return true
    })

    const byFolder: Record<string, string[]> = {}
    const root: string[] = []
    for (const name of allNames) {
      const fid = fileToFolder[name]
      if (fid) byFolder[fid] = [...(byFolder[fid] ?? []), name]
      else root.push(name)
    }
    return { filesByFolder: byFolder, rootFiles: root }
  }, [files, fileToFolder, pendingFiles, hiddenFiles, fileComments, fileStats, showHidden, showMissing, showOnlyCommented, fileNameFilter])

  // shift-select 범위: 보이는 파일만 (expanded 폴더 + root)
  const allFileNames = useMemo(() => {
    const result: string[] = []
    for (const folder of folders) {
      if (folder.expanded) {
        for (const name of (filesByFolder[folder.id] ?? [])) result.push(name)
      }
    }
    for (const name of rootFiles) result.push(name)
    return result
  }, [folders, filesByFolder, rootFiles])

  // 클릭 규칙 (탐색기 방식)
  //  - 일반 클릭: 그 파일 하나를 선택하고 연다. 이 파일이 Shift 범위의 기준점이 된다.
  //  - Ctrl 클릭: 그 파일을 선택에 넣거나 뺀다. 열린 파일은 바꾸지 않는다.
  //  - Shift 클릭: 기준점부터 클릭한 파일까지 범위를 선택한다. 기준점은 바꾸지 않는다.
  //  - Ctrl+Shift 클릭: 범위를 기존 선택에 더한다.
  // 목록에서 사라진 파일(제거, 프리셋 불러오기 등)이 선택에 남지 않도록 정리한다.
  useEffect(() => {
    if (selectedFileNames.size === 0) return
    const existing = new Set<string>([...files.map((f) => f.fileName), ...Object.keys(pendingFiles)])
    const kept = [...selectedFileNames].filter((n) => existing.has(n))
    if (kept.length !== selectedFileNames.size) onSelectionChange(new Set(kept))
  }, [files, pendingFiles, selectedFileNames, onSelectionChange])

  const handleFileClick = (name: string, e: React.MouseEvent) => {
    const additive = e.ctrlKey || e.metaKey
    // 선택이 비어 있어도 열려 있는 파일은 선택된 것으로 본다.
    const base = selectedFileNames.size === 0 && activeFile ? new Set([activeFile]) : selectedFileNames
    const anchor = lastClickedRef.current ?? activeFile
    const canRange = !!anchor && allFileNames.includes(anchor) && allFileNames.includes(name)

    if (e.shiftKey && canRange) {
      e.preventDefault()
      const from = allFileNames.indexOf(anchor as string)
      const to = allFileNames.indexOf(name)
      const range = allFileNames.slice(Math.min(from, to), Math.max(from, to) + 1)
      onSelectionChange(additive ? new Set([...base, ...range]) : new Set(range))
    } else if (additive) {
      e.preventDefault()
      const next = new Set(base)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      lastClickedRef.current = name
      onSelectionChange(next)
    } else {
      lastClickedRef.current = name
      onSelectionChange(new Set([name]))
      onSelectFile(name)
    }
  }

  const startCreatingFolder = () => {
    setCreatingFolder(true)
    setNewFolderName('')
  }

  const submitNewFolder = () => {
    const name = newFolderName.trim()
    if (name) onCreateFolder(name)
    setCreatingFolder(false)
    setNewFolderName('')
  }

  const startRenamingFolder = (folder: FolderItem) => {
    setRenamingFolderId(folder.id)
    setRenameFolderName(folder.name)
  }

  const commitRenameFolder = (folderId: string, currentName: string) => {
    const name = renameFolderName.trim()
    onRenameFolder(folderId, name || currentName)
    setRenamingFolderId(null)
  }

  // 폴더 순서 바꾸기 드래그인지 판단한다. 파일 드래그와 구분하기 위해 전용 형식을 쓴다.
  const isFolderDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(FOLDER_DRAG_TYPE)

  const resetFolderDrag = () => {
    setDraggingFolderId(null)
    setFolderDrop(null)
  }

  // 폴더 위를 지나갈 때: 폴더 제목줄의 위쪽 절반이면 앞, 아래쪽 절반(펼친 안쪽 포함)이면 뒤에 놓는다.
  const handleFolderDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!draggingFolderId || draggingFolderId === folderId) {
      setFolderDrop(null)
      return
    }
    const header = e.currentTarget.querySelector('.tree-folder-header')
    if (!header) return
    const rect = header.getBoundingClientRect()
    const side: 'before' | 'after' = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    setFolderDrop((prev) => (prev && prev.id === folderId && prev.side === side ? prev : { id: folderId, side }))
  }

  const handleFolderDrop = (e: React.DragEvent, folderId: string) => {
    e.preventDefault()
    e.stopPropagation()
    const dragged = e.dataTransfer.getData(FOLDER_DRAG_TYPE) || draggingFolderId
    const drop = folderDrop
    resetFolderDrag()
    if (!dragged || dragged === folderId) return
    onReorderFolders(dragged, folderId, drop && drop.id === folderId ? drop.side : 'after')
  }

  // DnD: dragCounter로 enter/leave 플리커 방지
  const dndEnter = (id: string) => {
    dragCounterRef.current[id] = (dragCounterRef.current[id] ?? 0) + 1
    setDragOverId(id)
  }

  const dndLeave = (id: string) => {
    dragCounterRef.current[id] = Math.max(0, (dragCounterRef.current[id] ?? 0) - 1)
    if (dragCounterRef.current[id] === 0) setDragOverId(null)
  }

  const dndDrop = (id: string, e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault()
    dragCounterRef.current[id] = 0
    setDragOverId(null)
    setDragCount(0)
    const raw = e.dataTransfer.getData('fileNames')
    if (raw) {
      try { (JSON.parse(raw) as string[]).forEach((n) => onMoveFile(n, targetFolderId)) } catch {}
    }
  }

  // 우클릭 규칙
  //  - 선택된 파일(2개 이상 선택 중)을 우클릭하면 선택한 파일 전체가 대상이다.
  //  - 선택되지 않은 파일을 우클릭하면 그 파일만 선택하고 그 파일 하나가 대상이다. 파일은 열지 않는다.
  const handleFileCtx = (name: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    let names: string[]
    if (selectedFileNames.has(name) && selectedFileNames.size > 1) {
      // 화면에 보이는 순서로 정렬한다. 접힌 폴더 안의 파일은 대상에서 뺀다.
      names = allFileNames.filter((n) => selectedFileNames.has(n))
      if (names.length === 0) names = [name]
    } else {
      names = [name]
      lastClickedRef.current = name
      onSelectionChange(new Set([name]))
    }
    setCtxMenu({ kind: 'file', names, x: e.clientX, y: e.clientY })
  }

  const toggleHiddenFor = (names: string[]) => {
    const willHide = names.some((n) => !hiddenFiles.has(n))
    onSetFilesHidden(names, willHide)
  }

  const removeNow = (names: string[]) => {
    names.forEach((n) => onRemoveFile(n))
    onSelectionChange(new Set([...selectedFileNames].filter((n) => !names.includes(n))))
  }

  // 2개 이상은 확인창을 거친다. 디스크의 파일은 지우지 않는다.
  const requestRemove = (names: string[]) => {
    if (names.length >= 2) setRemoveConfirm(names)
    else removeNow(names)
  }

  const requestComment = (names: string[]) => {
    if (names.length === 1) {
      setEditingComment(names[0])
      return
    }
    // 모두 같은 주석이면 그 내용을 미리 채워 준다.
    const texts = new Set(names.map((n) => fileComments[n] ?? ''))
    setCommentBatchText(texts.size === 1 ? [...texts][0] : '')
    setCommentBatch(names)
  }

  const handleFolderCtx = (folder: FolderItem) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ kind: 'folder', id: folder.id, name: folder.name, x: e.clientX, y: e.clientY })
  }

  const isEmpty =
    files.length === 0 &&
    Object.keys(pendingFiles).length === 0 &&
    folders.length === 0

  const renderFileItem = (name: string) => {
    const handleDragStart = (e: React.DragEvent) => {
      const isInSelection = selectedFileNames.has(name) && selectedFileNames.size > 1
      const names = isInSelection ? [...selectedFileNames] : [name]
      e.dataTransfer.setData('fileNames', JSON.stringify(names))
      e.dataTransfer.effectAllowed = 'move'
      setDragCount(names.length)
    }

    const isHidden = hiddenFiles.has(name)
    const comment = fileComments[name] ?? ''
    const isEditingComment = editingComment === name

    const loaded = files.find((f) => f.fileName === name)
    if (loaded) {
      return (
        <TreeFileItem
          key={name}
          file={loaded}
          isActive={name === activeFile}
          isSelected={selectedFileNames.has(name)}
          isHidden={isHidden}
          comment={comment}
          isEditingComment={isEditingComment}
          onCommentSave={(text) => { onCommentSave(name, text); setEditingComment(null) }}
          onClick={(e) => handleFileClick(name, e)}
          onContextMenu={handleFileCtx(name)}
          onDragStart={handleDragStart}
        />
      )
    }
    const pending = pendingFiles[name]
    if (pending) {
      return (
        <TreePendingItem
          key={name}
          name={name}
          status={pending.status}
          stats={fileStats?.[name]}
          isActive={name === activeFile}
          isSelected={selectedFileNames.has(name)}
          isHidden={isHidden}
          comment={comment}
          isEditingComment={isEditingComment}
          onCommentSave={(text) => { onCommentSave(name, text); setEditingComment(null) }}
          onClick={(e) => handleFileClick(name, e)}
          onContextMenu={handleFileCtx(name)}
          onDragStart={handleDragStart}
        />
      )
    }
    return null
  }

  return (
    <aside
      className="l-sidebar" {...uiId('SB.root')}
      onDragEnd={() => {
        dragCounterRef.current = {}
        setDragOverId(null)
        setDragCount(0)
        resetFolderDrag()
      }}
    >
      <div className="sidebar-header" {...uiId('SB.head')}>
        {actions}
        <button className="btn-open" {...uiId('SB.open')} onClick={onOpenDialog} title="CSV 파일 열기" aria-label="CSV 파일 열기">
          <FolderOpen size={16} />
        </button>
        {localFilesBrowser}
        {onOpenWorkspace && (
          <button className="db-browse-btn" {...uiId('SB.workspace')} onClick={onOpenWorkspace} title="작업 폴더" aria-label="작업 폴더">
            <FolderCog size={15} />
          </button>
        )}
      </div>

      <div className="save-load-group" {...uiId('SB.preset')}>
        <button className={`save-load-btn${sidebarDirty ? ' save-load-btn--dirty' : ''}`} {...uiId('SB.preset-save')} onClick={onSaveClick}>Preset Save</button>
        <button
          className="save-load-btn" {...uiId('SB.preset-load')}
          onClick={onLoadClick}
          disabled={disableLoad}
          title={disableLoad ? '불러오기를 사용할 수 없습니다' : undefined}
        >
          Preset Load
        </button>
      </div>

      <div className="tree-toolbar">
        <span className="tree-json-name" {...uiId('SB.preset-name')} title={currentJsonTitle ?? currentJsonName ?? ''}>
          {currentJsonName ?? '—'}
        </span>
      </div>

      <div className="sidebar-search" {...uiId('SB.search')}>
        <Search size={13} className="search-icon" />
        <input
          type="text"
          placeholder="파일명 검색 (Enter)"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setFileNameFilter(searchInput.trim())
            if (e.key === 'Escape') { setSearchInput(''); setFileNameFilter('') }
          }}
          className="search-input" {...uiId('SB.search-input')}
        />
        {fileNameFilter && (
          <button
            className="search-clear-btn"
            onClick={() => { setSearchInput(''); setFileNameFilter('') }}
            title="검색 초기화"
          >
            ×
          </button>
        )}
      </div>

      <div className="file-tree" {...uiId('SB.tree')}>
        {/* ── 새 폴더 인라인 헤더 ── */}
        <div className="tree-list-header" {...uiId('SB.tree-head')}>
          {creatingFolder ? (
            <div className="tree-folder-create-row">
              <Folder size={12} className="tree-folder-icon" style={{ flexShrink: 0 }} />
              <input
                autoFocus
                className="tree-folder-create-input"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNewFolder()
                  if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName('') }
                }}
                placeholder="폴더 이름"
              />
              <button className="tree-folder-create-confirm" onClick={submitNewFolder} title="확인">✓</button>
              <button className="tree-folder-create-cancel" onClick={() => { setCreatingFolder(false); setNewFolderName('') }} title="취소">✕</button>
            </div>
          ) : (
            <button className="tree-new-folder-inline-btn" {...uiId('SB.folder-new')} onClick={startCreatingFolder}>
              + 폴더
            </button>
          )}
        </div>

        {isEmpty && (
          <p className="tree-empty-hint">CSV를 열거나 드래그해서 올려줘</p>
        )}

        {/* ── 폴더 (항상 위) ── */}
        {folders.map((folder) => {
          const isDrop = dragOverId === folder.id
          const folderFileCount = filesByFolder[folder.id]?.length ?? 0
          const isRenaming = renamingFolderId === folder.id
          const isDragging = draggingFolderId === folder.id
          const dropSide = folderDrop && folderDrop.id === folder.id ? folderDrop.side : null

          return (
            <div
              key={folder.id}
              className={[
                'tree-folder-wrap',
                isDrop ? 'drag-over' : '',
                isDragging ? 'folder-dragging' : '',
                dropSide === 'before' ? 'folder-drop-before' : '',
                dropSide === 'after' ? 'folder-drop-after' : '',
              ].filter(Boolean).join(' ')}
              onDragOver={(e) => { if (isFolderDrag(e)) handleFolderDragOver(e, folder.id); else e.preventDefault() }}
              onDragEnter={(e) => { e.preventDefault(); if (!isFolderDrag(e)) dndEnter(folder.id) }}
              onDragLeave={(e) => {
                if (isFolderDrag(e)) {
                  // 폴더 밖으로 나가면 놓을 위치 표시를 지운다.
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setFolderDrop((prev) => (prev && prev.id === folder.id ? null : prev))
                  }
                } else {
                  dndLeave(folder.id)
                }
              }}
              onDrop={(e) => { if (isFolderDrag(e)) handleFolderDrop(e, folder.id); else dndDrop(folder.id, e, folder.id) }}
            >
              {/* 폴더 헤더 — div로 변경해 내부 interactive 요소 허용. 끌어서 폴더 순서를 바꾼다. */}
              <div
                role="button"
                tabIndex={0}
                className="tree-folder-header" {...uiId('SB.folder', folder.name)}
                draggable={!isRenaming}
                onDragStart={(e) => {
                  e.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id)
                  e.dataTransfer.effectAllowed = 'move'
                  setDraggingFolderId(folder.id)
                }}
                onClick={() => { if (!isRenaming) onToggleFolder(folder.id) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !isRenaming) onToggleFolder(folder.id) }}
                onContextMenu={handleFolderCtx(folder)}
              >
                <span className="tree-chevron">
                  {folder.expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </span>
                {folder.expanded
                  ? <FolderOpen size={13} className="tree-folder-icon" />
                  : <Folder size={13} className="tree-folder-icon" />}

                {isRenaming ? (
                  <input
                    className="tree-folder-rename-input"
                    value={renameFolderName}
                    onChange={(e) => setRenameFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') commitRenameFolder(folder.id, folder.name)
                      if (e.key === 'Escape') setRenamingFolderId(null)
                    }}
                    onBlur={() => commitRenameFolder(folder.id, folder.name)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <span
                    className="tree-folder-name"
                    onDoubleClick={(e) => { e.stopPropagation(); startRenamingFolder(folder) }}
                  >
                    {folder.name}
                  </span>
                )}

                {folderFileCount > 0 && (
                  <span className="tree-folder-count">{folderFileCount}</span>
                )}
                {isDrop && dragCount > 1 && (
                  <span className="tree-drag-count">{dragCount}개</span>
                )}
              </div>

              {folder.expanded && (
                <div className="tree-folder-body">
                  {folderFileCount === 0 ? (
                    <span className={['tree-folder-empty', isDrop ? 'tree-folder-empty--drop' : ''].filter(Boolean).join(' ')}>
                      파일을 여기로 드래그
                    </span>
                  ) : (
                    (filesByFolder[folder.id] ?? []).map(renderFileItem)
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* ── 미분류 파일 (항상 아래) ── */}
        <div
          className={['tree-root-drop', dragOverId === 'root' ? 'drag-over' : ''].filter(Boolean).join(' ')} {...uiId('SB.root-drop')}
          onDragOver={(e) => { if (!isFolderDrag(e)) e.preventDefault() }}
          onDragEnter={(e) => { if (isFolderDrag(e)) return; e.preventDefault(); dndEnter('root') }}
          onDragLeave={(e) => { if (!isFolderDrag(e)) dndLeave('root') }}
          onDrop={(e) => { if (!isFolderDrag(e)) dndDrop('root', e, null) }}
        >
          {folders.length > 0 && rootFiles.length === 0 && (
            <span className="tree-root-hint">
              {dragOverId === 'root' ? '폴더 해제' : '미분류'}
            </span>
          )}
          {rootFiles.map(renderFileItem)}
        </div>
      </div>

      {/* 사이드바 하단 footer */}
      <div className="sidebar-footer" {...uiId('SB.foot')}>
        <div className="sf-toggle-row" {...uiId('SB.toggle-hidden')}>
          <button
            className={`sf-toggle${showHidden ? ' sf-toggle--on' : ''}`}
            onClick={() => setShowHidden(v => !v)}
          />
          <span className="sf-toggle-label">숨김 표기</span>
        </div>
        <div className="sf-toggle-row" {...uiId('SB.toggle-comment')}>
          <button
            className={`sf-toggle${showOnlyCommented ? ' sf-toggle--on' : ''}`}
            onClick={() => setShowOnlyCommented(v => !v)}
          />
          <span className="sf-toggle-label">주석 Only</span>
        </div>
        <div className="sf-toggle-row" {...uiId('SB.toggle-missing')}>
          <button
            className={`sf-toggle${showMissing ? ' sf-toggle--on' : ''}`}
            onClick={() => setShowMissing(v => !v)}
          />
          <span className="sf-toggle-label">실종 표기</span>
        </div>
      </div>

      {ctxMenu && (
        <SidebarContextMenu
          target={ctxMenu}
          onNewFolder={startCreatingFolder}
          onRenameFolder={(id) => {
            const folder = folders.find(f => f.id === id)
            if (folder) startRenamingFolder(folder)
          }}
          hiddenFiles={hiddenFiles}
          onRemoveFiles={requestRemove}
          onDeleteFolder={onDeleteFolder}
          onToggleHidden={toggleHiddenFor}
          onCommentFiles={requestComment}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {commentBatch && (
        <Modal
          uiCode="BC"
          title={`주석 일괄 입력 (${commentBatch.length}개)`}
          onClose={() => setCommentBatch(null)}
          cardClassName="confirm-modal-card"
          draggable={false}
        >
          <div className="modal-body">
            <label className="modal-label">선택한 모든 파일에 같은 주석을 넣습니다. 기존 주석은 덮어씁니다.</label>
            <textarea
              autoFocus
              className="keyinfo-comment-textarea"
              rows={4}
              value={commentBatchText}
              placeholder="주석 내용을 입력하세요..."
              onChange={(e) => setCommentBatchText(e.target.value)}
              {...uiId('BC.text')}
            />
          </div>
          <div className="modal-footer" {...uiId('BC.footer')}>
            <button className="modal-btn modal-btn--cancel" onClick={() => setCommentBatch(null)}>
              취소
            </button>
            <button
              className="modal-btn modal-btn--save"
              onClick={() => {
                onCommentSaveMany(commentBatch, commentBatchText.trim())
                setCommentBatch(null)
              }}
            >
              적용
            </button>
          </div>
        </Modal>
      )}

      {removeConfirm && (
        <Modal
          uiCode="RM"
          title="목록에서 제거"
          onClose={() => setRemoveConfirm(null)}
          cardClassName="confirm-modal-card"
          draggable={false}
          showCloseButton={false}
        >
          <div className="confirm-modal-body" {...uiId('RM.confirm')}>
            <p className="confirm-modal-msg">
              선택한 <strong>{removeConfirm.length}개</strong> 파일을 목록에서 제거할까요?
            </p>
            <p className="confirm-modal-sub">디스크의 파일은 삭제되지 않습니다.</p>
          </div>
          <div className="modal-footer" {...uiId('RM.footer')}>
            <button className="modal-btn modal-btn--cancel" onClick={() => setRemoveConfirm(null)}>
              취소
            </button>
            <button
              className="modal-btn modal-btn--danger"
              onClick={() => {
                removeNow(removeConfirm)
                setRemoveConfirm(null)
              }}
            >
              제거
            </button>
          </div>
        </Modal>
      )}
    </aside>
  )
}

// ── Tree items ────────────────────────────────────────────────────────────────

function TreeFileItem({
  file,
  isActive,
  isSelected,
  isHidden,
  comment,
  isEditingComment,
  onCommentSave,
  onClick,
  onContextMenu,
  onDragStart,
}: {
  file: ParsedCsv
  isActive: boolean
  isSelected: boolean
  isHidden: boolean
  comment: string
  isEditingComment: boolean
  onCommentSave: (text: string) => void
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
}) {
  const nameRef = useRef<HTMLSpanElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null)

  const handleNameEnter = () => {
    const el = nameRef.current
    if (el && el.scrollWidth > el.offsetWidth) {
      const rect = el.getBoundingClientRect()
      setTooltip({ x: rect.left, y: rect.bottom + 6 })
    }
  }

  return (
    <>
    <div
      role="button"
      tabIndex={0}
      draggable
      className={[
        'tree-file-item',
        isActive ? 'active' : '',
        isSelected ? 'selected' : '',
        isHidden ? 'tree-file-item--hidden' : '',
      ].filter(Boolean).join(' ')} {...uiId('SB.file', file.fileName)}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => e.key === 'Enter' && onClick(e as unknown as React.MouseEvent)}
      onDragStart={onDragStart}
    >
      <FileText size={13} className="tree-file-icon" />
      <div className="tree-file-info">
        <span
          ref={nameRef}
          className="tree-file-name"
          onMouseEnter={handleNameEnter}
          onMouseLeave={() => setTooltip(null)}
        >{file.fileName}</span>
        <span className="tree-file-meta" {...uiId('SB.file-comment')}>
          {file.totalRows.toLocaleString()}행 · {file.columns.length}열
        </span>
        {isEditingComment ? (
          <input
            autoFocus
            className="tree-comment-input"
            defaultValue={comment}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Enter') onCommentSave((e.target as HTMLInputElement).value.trim())
              if (e.key === 'Escape') onCommentSave(comment)
            }}
            onBlur={e => onCommentSave(e.target.value.trim())}
          />
        ) : comment ? (
          <span className="tree-file-comment" title={comment}>{comment}</span>
        ) : null}
      </div>
    </div>
    {tooltip && (
      <div
        className="tree-filename-tooltip"
        style={{ left: Math.min(tooltip.x, window.innerWidth - 240), top: tooltip.y }}
      >
        {file.fileName}
      </div>
    )}
    </>
  )
}

function TreePendingItem({
  name,
  status,
  stats,
  isActive,
  isSelected,
  isHidden,
  comment,
  isEditingComment,
  onCommentSave,
  onClick,
  onContextMenu,
  onDragStart,
}: {
  name: string
  status: 'uploading' | 'ready' | 'parsing'
  // 파일을 열지 않고 센 행 수, 열 수. undefined는 계산 중, null은 계산하지 못함.
  stats?: CsvStats | null
  isActive: boolean
  isSelected: boolean
  isHidden: boolean
  comment: string
  isEditingComment: boolean
  onCommentSave: (text: string) => void
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
  onDragStart: (e: React.DragEvent) => void
}) {
  const nameRef = useRef<HTMLSpanElement>(null)
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null)

  const handleNameEnter = () => {
    const el = nameRef.current
    if (el && el.scrollWidth > el.offsetWidth) {
      const rect = el.getBoundingClientRect()
      setTooltip({ x: rect.left, y: rect.bottom + 6 })
    }
  }

  const isClickable = status === 'ready'

  const metaText = status === 'uploading' ? '업로드 중...' : '파싱 중...'

  // 열기 전에도 행 수와 열 수를 보여준다. 큰 파일은 앞부분만 센 값이라 숫자 뒤에 +를 붙인다.
  // 파일이 디스크에 없으면 실종 상태이다.
  const isMissing = status === 'ready' && !!stats?.missing
  const statsText = isMissing
    ? '실종 · 파일을 찾을 수 없어요'
    : stats
    ? `${stats.rows.toLocaleString()}${stats.partial ? '+' : ''}행 · ${stats.columns}열`
    : stats === null
    ? '클릭하여 열기'
    : '행 · 열 계산 중...'

  return (
    <>
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : -1}
      draggable={isClickable}
      className={[
        'tree-file-item',
        isActive ? 'active' : '',
        isSelected ? 'selected' : '',
        isHidden ? 'tree-file-item--hidden' : '',
        isMissing ? 'tree-file-item--missing' : '',
      ].filter(Boolean).join(' ')} {...uiId('SB.file', name)}
      style={{
        opacity: status === 'uploading' ? 0.4 : 0.8,
        cursor: isClickable ? 'pointer' : 'default',
        pointerEvents: status === 'uploading' ? 'none' : undefined,
      }}
      onClick={isClickable ? onClick : undefined}
      onContextMenu={status !== 'uploading' ? onContextMenu : undefined}
      onKeyDown={(e) => e.key === 'Enter' && isClickable && onClick(e as unknown as React.MouseEvent)}
      onDragStart={isClickable ? onDragStart : undefined}
    >
      {status === 'parsing' || status === 'uploading'
        ? <Loader2 size={13} className="spin tree-file-icon" />
        : isMissing
        ? <FileX size={13} className="tree-file-icon" />
        : <FileText size={13} className="tree-file-icon" />
      }
      <div className="tree-file-info">
        <span
          ref={nameRef}
          className="tree-file-name"
          onMouseEnter={handleNameEnter}
          onMouseLeave={() => setTooltip(null)}
        >{name}</span>
        {isEditingComment && status === 'ready' ? (
          <input
            autoFocus
            className="tree-comment-input"
            defaultValue={comment}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              if (e.key === 'Enter') onCommentSave((e.target as HTMLInputElement).value.trim())
              if (e.key === 'Escape') onCommentSave(comment)
            }}
            onBlur={e => onCommentSave(e.target.value.trim())}
          />
        ) : status === 'ready' ? (
          <>
            <span
              className="tree-file-meta" {...uiId('SB.file-comment')}
              style={{ fontStyle: stats ? 'normal' : 'italic' }}
              title={stats?.partial ? '파일이 커서 앞부분만 세었어요. 실제 행 수는 이보다 많아요.' : undefined}
            >
              {statsText}
            </span>
            {comment && <span className="tree-file-comment" title={comment}>{comment}</span>}
          </>
        ) : (
          <span className="tree-file-meta" {...uiId('SB.file-comment')}>
            {metaText}
          </span>
        )}
      </div>
    </div>
    {tooltip && (
      <div
        className="tree-filename-tooltip"
        style={{ left: Math.min(tooltip.x, window.innerWidth - 240), top: tooltip.y }}
      >
        {name}
      </div>
    )}
    </>
  )
}
