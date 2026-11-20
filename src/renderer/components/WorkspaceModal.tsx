import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'
import { api } from '../api'

interface Props {
  // true이면 처음 실행할 때의 안내 창이다. 닫기 버튼이 없고, 폴더를 정해야 닫힌다.
  firstRun: boolean
  onClose: () => void
}

// 작업 폴더 설정 창. CSV, 프리셋, 키 문서가 저장되는 위치를 보여주고 바꾼다.
// 폴더를 바꾸면 바로 적용되고, 화면이 새로고침되어 새 폴더의 파일을 읽는다.
export function WorkspaceModal({ firstRun, onClose }: Props) {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 바꾸려고 고른 폴더. 확인을 누르기 전까지는 저장하지 않는다.
  const [pendingPath, setPendingPath] = useState<string | null>(null)

  useEffect(() => {
    api.workspaceGet().then(setInfo).catch(() => setError('작업 폴더 정보를 읽지 못했습니다.'))
  }, [])

  // 폴더를 저장하고 적용한다. 지금 폴더와 다르면 메인이 화면을 새로고침한다.
  const apply = async (dir: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.workspaceSave(dir)
      if (!result.ok) {
        setError(result.message)
        return
      }
      if (result.reloading) return
      setInfo((prev) => (prev ? { ...prev, path: result.path, needsSetup: false } : prev))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handlePick = async () => {
    const dir = await api.workspacePick()
    if (!dir) return
    // 처음 실행 안내에서는 바로 적용하고, 설정 창에서는 확인을 한 번 거친다.
    if (firstRun) await apply(dir)
    else setPendingPath(dir)
  }

  const handleOpenExplorer = async () => {
    const message = await api.workspaceOpen()
    if (message) setError(`탐색기를 열지 못했습니다. ${message}`)
  }

  const shownPath = info ? (firstRun ? info.defaultPath : info.path) : ''

  return (
    <Modal
      uiCode="WS"
      title={firstRun ? '작업 폴더 설정' : '작업 폴더'}
      onClose={firstRun ? undefined : onClose}
      cardClassName="workspace-modal-card"
      overlayClassName="workspace-overlay"
      draggable={false}
    >
      <div className="workspace-body" {...uiId('WS.body')}>
        {pendingPath ? (
          <>
            <p className="workspace-lead">작업 폴더를 이 위치로 바꿀까요?</p>
            <div className="workspace-path" title={pendingPath} {...uiId('WS.path')}>{pendingPath}</div>
            <p className="workspace-note">
              화면이 새로고침되고, 새 폴더의 파일을 불러와요.
              <br />
              기존 폴더의 파일은 새 폴더로 옮겨지지 않아요.
              <br />
              저장하지 않은 작업은 사라질 수 있어요.
            </p>
          </>
        ) : (
          <>
            <p className="workspace-lead">
              {firstRun
                ? 'CSV, 프리셋, 키 문서를 저장할 폴더를 정해요.'
                : 'CSV, 프리셋, 키 문서가 저장되는 폴더예요.'}
            </p>
            <div className="workspace-path" title={shownPath} {...uiId('WS.path')}>
              {shownPath || '…'}
            </div>
            {info?.isDev && !firstRun && (
              <p className="workspace-note">개발 모드: 따로 정하지 않으면 프로젝트 폴더를 써요.</p>
            )}
            <p className="workspace-note">DB 접속 정보는 이 폴더에 저장되지 않아요.</p>
          </>
        )}
        {error && <div className="workspace-error">{error}</div>}
      </div>

      <div className="modal-footer" {...uiId('WS.footer')}>
        {pendingPath ? (
          <>
            <button className="modal-btn modal-btn--cancel" onClick={() => setPendingPath(null)} disabled={busy}>
              취소
            </button>
            <button
              className="modal-btn modal-btn--save" {...uiId('WS.apply')}
              onClick={() => apply(pendingPath)}
              disabled={busy}
            >
              바꾸기
            </button>
          </>
        ) : firstRun ? (
          <>
            <button className="modal-btn modal-btn--cancel" {...uiId('WS.pick')} onClick={handlePick} disabled={busy || !info}>
              다른 폴더 선택
            </button>
            <button
              className="modal-btn modal-btn--save" {...uiId('WS.use-default')}
              onClick={() => info && apply(info.defaultPath)}
              disabled={busy || !info}
            >
              이 위치 사용
            </button>
          </>
        ) : (
          <>
            <button className="modal-btn modal-btn--cancel" {...uiId('WS.open')} onClick={handleOpenExplorer} disabled={busy}>
              탐색기에서 열기
            </button>
            <button className="modal-btn modal-btn--save" {...uiId('WS.pick')} onClick={handlePick} disabled={busy || !info}>
              폴더 변경
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
