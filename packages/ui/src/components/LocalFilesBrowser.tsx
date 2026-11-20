import { useState, useRef, useMemo, useEffect } from 'react'
import { Folder, FileText, ChevronRight, Loader2, Download, Search, Archive, FolderOpen, FolderCog } from 'lucide-react'
import type { FileSource } from '@tagger/shared'
import { Modal } from './Modal'
import { ModalOverlay } from './ModalOverlay'
import { uiId } from '../ui/uiId'
import { api, caps } from '../api'

interface LocalFolderItem { name: string; path: string }
interface LocalFileItem   { name: string; path: string; mtime: number; size: number }

interface DirData {
  folders: LocalFolderItem[]
  files: LocalFileItem[]
}

type ConfirmState =
  | { type: 'folder'; name: string; path: string }
  | { type: 'folders'; paths: string[] }
  | { type: 'files'; paths: string[] }

interface LocalFilesBrowserProps {
  // options.folder가 있으면 그 이름의 사이드바 폴더에 파일을 넣는다.
  onFilesLoaded: (
    files: { name: string; content: string; source?: FileSource }[],
    options?: { folder?: string },
  ) => Promise<void>
  onLoading: (message: string | null) => void
  onOpenWorkspace?: () => void
}

function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getFullYear()).slice(2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 저장 위치는 DB-downloads 하나뿐이므로 루트 선택 화면 없이 바로 연다.
const DOWNLOAD_ROOT = 'db' as const

const lastName = (p: string) => p.replace(/\\/g, '/').split('/').pop() ?? p

export function LocalFilesBrowser({ onFilesLoaded, onLoading, onOpenWorkspace }: LocalFilesBrowserProps) {
  const [open, setOpen]                     = useState(false)
  const [pathStack, setPathStack]           = useState<string[]>([])
  const [data, setData]                     = useState<DirData | null>(null)
  const [loading, setLoading]               = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [selectedFiles, setSelectedFiles]   = useState<Set<string>>(new Set())
  // 스키마 폴더 전체 선택 (최상위 화면에서만 사용)
  const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery]       = useState('')
  const [confirming, setConfirming]         = useState(false)
  const [confirmState, setConfirmState]     = useState<ConfirmState | null>(null)
  const [deleting, setDeleting]             = useState(false)
  const [basePath, setBasePath]             = useState<string>('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectAllRef   = useRef<HTMLInputElement>(null)

  const atRoot = pathStack.length === 0

  const loadDir = async (stack: string[]) => {
    setLoading(true)
    setError(null)
    setSelectedFiles(new Set())
    setSelectedFolders(new Set())
    setSearchQuery('')
    try {
      const subPath = stack.join('/')
      const result = await api.localListDownloads(DOWNLOAD_ROOT, subPath || undefined)
      setData(result)
    } catch {
      setError('폴더를 읽을 수 없습니다.')
      setData(null)
    } finally {
      setLoading(false)
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }

  const openModal = () => {
    setOpen(true)
    setPathStack([])
    setData(null)
    setError(null)
    api.localGetDownloadsPath(DOWNLOAD_ROOT).then(setBasePath).catch(() => {})
    loadDir([])
  }

  const navigate = (folder: LocalFolderItem) => {
    const next = [...pathStack, folder.name]
    setPathStack(next)
    loadDir(next)
  }

  // 최상위 화면에서 뒤로 가면 창을 닫는다.
  const goBack = () => {
    if (atRoot) {
      setOpen(false)
      return
    }
    const next = pathStack.slice(0, -1)
    setPathStack(next)
    loadDir(next)
  }

  // 현재 보고 있는 폴더를 탐색기로 연다.
  const openInExplorer = async () => {
    const message = await api.localOpenDownloads(DOWNLOAD_ROOT, pathStack.join('/') || undefined)
    if (message) setError(`탐색기를 열지 못했습니다. ${message}`)
  }

  // 전체 선택 체크박스 indeterminate 동기화 (파일이 있으면 파일, 폴더만 있으면 폴더)
  const selectFolders = !!data && data.files.length === 0 && data.folders.length > 0
  const listCount = selectFolders ? data?.folders.length ?? 0 : data?.files.length ?? 0
  const selectedCount = selectFolders ? selectedFolders.size : selectedFiles.size
  useEffect(() => {
    if (!selectAllRef.current || !data) return
    selectAllRef.current.checked       = listCount > 0 && selectedCount === listCount
    selectAllRef.current.indeterminate = selectedCount > 0 && selectedCount < listCount
  }, [selectedCount, listCount, data])

  const toggleFile = (filePath: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev)
      next.has(filePath) ? next.delete(filePath) : next.add(filePath)
      return next
    })
  }

  const toggleFolder = (folderPath: string) => {
    setSelectedFolders((prev) => {
      const next = new Set(prev)
      next.has(folderPath) ? next.delete(folderPath) : next.add(folderPath)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (!data) return
    if (selectFolders) {
      setSelectedFolders(
        selectedFolders.size === data.folders.length && data.folders.length > 0
          ? new Set()
          : new Set(data.folders.map((f) => f.path))
      )
      return
    }
    setSelectedFiles(
      selectedFiles.size === data.files.length && data.files.length > 0
        ? new Set()
        : new Set(data.files.map((f) => f.path))
    )
  }

  // 선택한 폴더와 파일을 사이드바로 불러온다.
  // 폴더는 하위 폴더까지 찾는다. CSV가 있는 폴더마다 사이드바에 폴더를 만든다.
  // 사이드바 폴더 이름은 저장 루트 기준 경로를 점으로 이은 것이다. (예: DB1.public)
  // 파일만 고른 경우는 폴더 없이 넣는다.
  const handleConfirm = async () => {
    const filePaths = Array.from(selectedFiles)
    const folderPaths = Array.from(selectedFolders)
    setConfirming(true)
    setOpen(false)
    onLoading('파일 목록 확인 중...')
    try {
      const jobs: Array<{ folder?: string; paths: string[] }> = []
      for (const folderPath of folderPaths) {
        const relative = [...pathStack, lastName(folderPath)].join('/')
        const groups = await api.localListCsvTree(DOWNLOAD_ROOT, relative)
        for (const group of groups) {
          jobs.push({
            folder: group.segments.length > 0 ? group.segments.join('.') : undefined,
            paths: group.files.map((f) => f.path),
          })
        }
      }
      if (filePaths.length > 0) jobs.push({ paths: filePaths })

      const total = jobs.reduce((sum, job) => sum + job.paths.length, 0)
      if (total === 0) {
        setOpen(true)
        setError('불러올 CSV 파일이 없습니다.')
        return
      }

      let done = 0
      onLoading(`파일 읽는 중... 0 / ${total}`)
      for (const job of jobs) {
        const results: { name: string; content: string; source: FileSource }[] = []
        for (const filePath of job.paths) {
          const content = await api.localReadFile(filePath)
          results.push({ name: lastName(filePath), content, source: { type: 'local', path: filePath } })
          done++
          onLoading(`파일 읽는 중... ${done} / ${total}`)
        }
        await onFilesLoaded(results, job.folder ? { folder: job.folder } : undefined)
      }
    } catch {
      setOpen(true)
      setError('일부 파일을 읽지 못했습니다.')
    } finally {
      setConfirming(false)
      onLoading(null)
    }
  }

  // 삭제 확인 후 실행
  const handleDeleteConfirmed = async () => {
    if (!confirmState) return
    const targets = confirmState.type === 'folder'
      ? [confirmState.path]
      : confirmState.paths
    setConfirmState(null)
    setDeleting(true)
    try {
      for (const p of targets) {
        await api.localDeleteDownload(p)
      }
      await loadDir(pathStack)
    } catch {
      setError('삭제 중 오류가 발생했습니다.')
    } finally {
      setDeleting(false)
    }
  }

  const q = searchQuery.toLowerCase()
  const filteredFolders = useMemo(
    () => (data?.folders ?? []).filter((f) => f.name.toLowerCase().includes(q)),
    [data, q]
  )
  const filteredFiles = useMemo(
    () => (data?.files ?? []).filter((f) => f.name.toLowerCase().includes(q)),
    [data, q]
  )

  const isEmpty = !loading && !error && filteredFolders.length === 0 && filteredFiles.length === 0
  const isBusy  = confirming || deleting
  const anySelected = selectedFiles.size > 0 || selectedFolders.size > 0

  const fullPath = pathStack.length > 0
    ? `${basePath}\\${pathStack.join('\\')}`
    : basePath

  return (
    <>
      <button className="lf-trigger-btn" {...uiId('SB.saved')} onClick={openModal} disabled={isBusy} title="저장된 파일">
        <Archive size={14} />
        <span>Local</span>
      </button>

      {open && (
        <ModalOverlay className="browser-overlay" onClose={() => setOpen(false)}>
          <div className="browser-panel" onClick={(e) => e.stopPropagation()} {...uiId('LF.frame')}>

            {/* 헤더 Row 1: 경로 표시, 탐색기 열기 */}
            <div className="browser-panel-header-row1">
              <button className="browser-back-btn" {...uiId('LF.back')} onClick={goBack}>←</button>
              <span className="browser-panel-path" title={fullPath} {...uiId('LF.path')}>
                Local{pathStack.length > 0 ? `\\${pathStack.join('\\')}` : ''}
              </span>
              {caps.revealInOs && <button
                className="lf-explorer-btn" {...uiId('LF.explorer')}
                onClick={openInExplorer}
                title={fullPath ? `탐색기에서 열기: ${fullPath}` : '탐색기에서 열기'}
              >
                <FolderOpen size={12} />
                <span>탐색기에서 열기</span>
              </button>}
              {onOpenWorkspace && (
                <button
                  className="lf-explorer-btn" {...uiId('LF.workspace')}
                  onClick={onOpenWorkspace}
                  title="작업 폴더 설정"
                >
                  <FolderCog size={12} />
                  <span>작업 폴더</span>
                </button>
              )}
              <button className="browser-close-btn" onClick={() => setOpen(false)} {...uiId('LF.close')}>✕</button>
            </div>

            {/* 헤더 Row 2: 검색 + 전체선택 */}
            <div className="browser-panel-header-row2">
              <div className="browser-search-wrap" {...uiId('LF.search')}>
                <Search size={11} className="browser-search-icon" />
                <input
                  ref={searchInputRef}
                  type="text"
                  className="browser-search-input"
                  placeholder="검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setSearchQuery('')}
                />
              </div>
              {data && listCount > 0 && (
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="browser-select-all" {...uiId('LF.select-all')}
                  onChange={toggleSelectAll}
                  title={selectFolders ? '폴더 전체 선택' : '전체 선택'}
                />
              )}
            </div>

            {/* 바디 */}
            <div className="browser-panel-body">
              {loading && (
                <div className="browser-loading">
                  <Loader2 size={18} className="spin" />
                  <span>읽는 중...</span>
                </div>
              )}
              {error && <div className="browser-error">{error}</div>}

              {/* 폴더 목록 (스키마) */}
              {!loading && !error && filteredFolders.map((folder) => (
                <div key={folder.path} className="lf-folder-row" {...uiId('LF.folder', folder.name)}>
                  <input
                    type="checkbox"
                    className="browser-file-checkbox lf-folder-check" {...uiId('LF.folder-check')}
                    checked={selectedFolders.has(folder.path)}
                    onChange={() => toggleFolder(folder.path)}
                    disabled={isBusy}
                    title="폴더 전체 선택 (하위 폴더 포함)"
                  />
                  <button
                    className="lf-folder-row-main"
                    onClick={() => navigate(folder)}
                    disabled={isBusy}
                  >
                    <Folder size={14} className="browser-item-icon" style={{ color: '#facc15' }} />
                    <span className="lf-folder-name" title={folder.name}>{folder.name}</span>
                  </button>
                  <button
                    className="lf-folder-delete-btn" {...uiId('LF.folder-delete')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setConfirmState({ type: 'folder', name: folder.name, path: folder.path })
                    }}
                    disabled={isBusy}
                    title="폴더 삭제"
                  >
                    삭제
                  </button>
                  <ChevronRight size={13} className="browser-item-arrow lf-folder-arrow" />
                </div>
              ))}

              {/* 파일 목록 (테이블) */}
              {!loading && !error && filteredFiles.map((file) => (
                <div
                  key={file.path}
                  className={`browser-file-row${selectedFiles.has(file.path) ? ' selected' : ''}`} {...uiId('LF.file', file.name)}
                >
                  <button
                    className="browser-file-row-main"
                    onClick={() => toggleFile(file.path)}
                    disabled={isBusy}
                  >
                    <FileText size={15} className="browser-item-icon file" />
                    <span className="browser-item-name">{file.name}</span>
                    <span className="lf-file-meta">{fmtDate(file.mtime)} · {fmtSize(file.size)}</span>
                  </button>
                  <input
                    type="checkbox"
                    className="browser-file-checkbox"
                    checked={selectedFiles.has(file.path)}
                    onChange={() => toggleFile(file.path)}
                    onClick={(e) => e.stopPropagation()}
                    disabled={isBusy}
                  />
                </div>
              ))}

              {isEmpty && (
                <div className="browser-empty">
                  {searchQuery
                    ? '검색 결과가 없습니다.'
                    : atRoot ? '저장된 폴더가 없습니다.' : 'CSV 파일이 없습니다.'}
                </div>
              )}
            </div>

            {/* 푸터 */}
            {anySelected && (
              <div className="browser-panel-footer" {...uiId('LF.footer')}>
                <button
                  className="lf-footer-delete-btn" {...uiId('LF.delete')}
                  onClick={() =>
                    selectedFolders.size > 0
                      ? setConfirmState({ type: 'folders', paths: Array.from(selectedFolders) })
                      : setConfirmState({ type: 'files', paths: Array.from(selectedFiles) })
                  }
                  disabled={isBusy}
                >
                  삭제
                </button>
                <span className="browser-footer-count">
                  {selectedFolders.size > 0 ? `폴더 ${selectedFolders.size}개` : `${selectedFiles.size}개`} 선택됨
                </span>
                <button className="browser-download-btn" {...uiId('LF.load')} onClick={handleConfirm} disabled={isBusy}>
                  <Download size={13} />
                  불러오기
                </button>
              </div>
            )}

          </div>
        </ModalOverlay>
      )}

      {confirmState && (
        <Modal
          title={confirmState.type === 'files' ? '파일 삭제' : '폴더 삭제'}
          onClose={() => setConfirmState(null)}
          cardClassName="confirm-modal-card"
          draggable={false}
          showCloseButton={false}
        >
          <div className="confirm-modal-body" {...uiId('LF.confirm')}>
            <p className="confirm-modal-msg">
              {confirmState.type === 'folder' ? (
                <><strong>{confirmState.name}</strong> 폴더를 삭제하시겠습니까?</>
              ) : confirmState.type === 'folders' ? (
                <><strong>{confirmState.paths.length}개</strong> 폴더를 삭제하시겠습니까?</>
              ) : (
                <><strong>{confirmState.paths.length}개</strong> 파일을 삭제하시겠습니까?</>
              )}
            </p>
            <p className="confirm-modal-sub">
              {confirmState.type === 'files'
                ? '이 작업은 되돌릴 수 없습니다.'
                : '폴더 안의 CSV 파일도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.'}
            </p>
          </div>
          <div className="modal-footer">
            <button className="modal-btn modal-btn--cancel" onClick={() => setConfirmState(null)}>
              취소
            </button>
            <button className="modal-btn modal-btn--danger" onClick={handleDeleteConfirmed}>
              삭제
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
