import { useState, useEffect, useRef } from 'react'
import { Modal } from './Modal'
import { uiId } from '../ui/uiId'
import { toast } from 'sonner'

interface Props {
  onClose: () => void
}

type Mode = 'list' | 'creating'

const scopeNames: Record<string, string> = {
  local: 'Local 설정', 'docs/keyinfo': 'Key 노트와 핀', 'docs/lorebook': 'Lorebook 주석',
}
const backupScope = (backup: BackupMeta) => (backup.scopes ?? ['local']).map(s => scopeNames[s] ?? s).join(', ')

export function BackupModal({ onClose }: Props) {
  const [backups, setBackups] = useState<BackupMeta[]>([])
  const [selected, setSelected] = useState<BackupMeta | null>(null)
  const [mode, setMode] = useState<Mode>('list')
  const [title, setTitle] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<BackupMeta | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<BackupMeta | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadBackups() }, [])

  useEffect(() => {
    if (mode === 'creating') setTimeout(() => titleRef.current?.focus(), 50)
  }, [mode])

  const loadBackups = async () => {
    try {
      const list = await window.electronAPI.backupList()
      setBackups(list)
    } catch { toast.error('백업 목록을 불러오지 못했습니다.') }
  }

  const handleSaveInit = () => {
    setMode('creating')
    setTitle('')
    setComment('')
  }

  const handleSaveConfirm = async () => {
    if (saving) return
    setSaving(true)
    try {
      const meta = await window.electronAPI.backupSave(title, comment)
      await loadBackups()
      setSelected(meta)
      setMode('list')
      toast.success('설정, Keyinfo, Lorebook을 백업했습니다.')
    } catch { toast.error('백업을 저장하지 못했습니다. 저장 공간과 폴더 권한을 확인하세요.') }
    setSaving(false)
  }

  const handleRestore = async () => {
    if (!confirmRestore || restoring) return
    setRestoring(true)
    try {
      await window.electronAPI.backupRestore(confirmRestore.id)
      setConfirmRestore(null)
      onClose()
      window.location.reload()
    } catch (error) {
      toast.error(`백업을 복원하지 못했습니다. ${error instanceof Error ? error.message : ''}`, { duration: 8000 })
    } finally { setRestoring(false) }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await window.electronAPI.backupDelete(confirmDelete.id)
      if (selected?.id === confirmDelete.id) setSelected(null)
      await loadBackups()
      setConfirmDelete(null)
    } catch {}
    setDeleting(false)
  }

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleString('ko-KR') } catch { return iso }
  }

  const nowString = new Date().toLocaleString('ko-KR')

  return (
    <>
      <Modal title="Backup" uiCode="BK" onClose={onClose} cardClassName="backup-modal-card" floating>
        <div className="backup-body">
          {/* 좌측: 백업 리스트 */}
          <div className="backup-left" {...uiId('BK.left')}>
            {backups.length === 0 ? (
              <div className="backup-empty">저장된 백업이 없습니다</div>
            ) : (
              <ul className="backup-list">
                {backups.map(b => (
                  <li
                    key={b.id}
                    className={['backup-item', selected?.id === b.id ? 'backup-item--active' : ''].filter(Boolean).join(' ')}
                    onClick={() => { setSelected(b); setMode('list') }}
                  >
                    <div className="backup-item-title" {...uiId('BK.item', b.title)}>{b.title}</div>
                    <div className="backup-item-date">{formatDate(b.date)}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 우측: 상세 / 생성 폼 */}
          <div className="backup-right" {...uiId('BK.right')}>
            {mode === 'creating' ? (
              <div className="backup-create-form" {...uiId('BK.create')}>
                <p className="confirm-modal-sub">Local 설정, Key 노트와 핀, Lorebook 주석을 저장합니다.</p>
                <div className="backup-field">
                  <label className="backup-label">제목</label>
                  <input
                    ref={titleRef}
                    className="backup-input" {...uiId('BK.create-title')}
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="백업 제목"
                    onKeyDown={e => e.key === 'Enter' && handleSaveConfirm()}
                  />
                </div>
                <div className="backup-field">
                  <label className="backup-label">주석</label>
                  <textarea
                    className="backup-textarea" {...uiId('BK.create-comment')}
                    value={comment}
                    onChange={e => setComment(e.target.value)}
                    placeholder="이 백업에 대한 설명"
                    rows={3}
                  />
                </div>
                <div className="backup-field">
                  <label className="backup-label">날짜</label>
                  <span className="backup-date-auto">{nowString}</span>
                </div>
                <button
                  className="backup-confirm-btn" {...uiId('BK.create-btn')}
                  onClick={handleSaveConfirm}
                  disabled={saving}
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            ) : selected ? (
              <div className="backup-detail" {...uiId('BK.detail')}>
                <div className="backup-detail-title">{selected.title}</div>
                {selected.comment && (
                  <div className="backup-detail-comment">{selected.comment}</div>
                )}
                <div className="backup-detail-date">{formatDate(selected.date)}</div>
                <p className="confirm-modal-sub">포함: {backupScope(selected)}</p>
              </div>
            ) : (
              <div className="backup-detail-empty">← 백업을 선택하거나 저장하세요</div>
            )}
          </div>
        </div>

        <div className="modal-footer" {...uiId('BK.footer')}>
          <button
            className={['modal-btn', mode === 'creating' ? 'modal-btn--cancel' : 'modal-btn--save'].join(' ')}
            onClick={mode === 'creating' ? () => setMode('list') : handleSaveInit}
          >
            {mode === 'creating' ? '취소' : '저장'}
          </button>
          <div className="backup-footer-right">
            <button
              className="modal-btn modal-btn--save" {...uiId('BK.restore')}
              onClick={() => selected && setConfirmRestore(selected)}
              disabled={!selected || mode === 'creating'}
            >
              불러오기
            </button>
            <button
              className="modal-btn modal-btn--danger" {...uiId('BK.delete')}
              onClick={() => selected && setConfirmDelete(selected)}
              disabled={!selected || mode === 'creating'}
            >
              삭제
            </button>
          </div>
        </div>
      </Modal>

      {confirmRestore && (
        <Modal
          title="백업 불러오기"
          onClose={() => { if (!restoring) setConfirmRestore(null) }}
          cardClassName="confirm-modal-card"
          draggable={false}
          showCloseButton={false}
        >
          <div className="confirm-modal-body">
            <p className="confirm-modal-msg">
              <strong className="backup-restore-warning" {...uiId('BK.confirm')}>경고:</strong> 현재 {backupScope(confirmRestore)}을 백업 내용으로 바꿉니다.
            </p>
            <p className="confirm-modal-sub">{confirmRestore.title}</p>
            <p className="confirm-modal-sub">백업에 없는 데이터는 유지합니다. 완료 후 화면을 다시 불러옵니다.</p>
          </div>
          <div className="modal-footer">
            <button className="modal-btn modal-btn--cancel" onClick={() => setConfirmRestore(null)} disabled={restoring}>취소</button>
            <button className="modal-btn modal-btn--save" onClick={handleRestore} disabled={restoring}>{restoring ? '복원 중…' : '진행'}</button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title="백업 삭제"
          onClose={() => setConfirmDelete(null)}
          cardClassName="confirm-modal-card"
          draggable={false}
          showCloseButton={false}
        >
          <div className="confirm-modal-body">
            <p className="confirm-modal-msg">
              <strong>{confirmDelete.title}</strong>을 삭제하시겠습니까?
            </p>
            <p className="confirm-modal-sub">이 작업은 되돌릴 수 없습니다.</p>
          </div>
          <div className="modal-footer">
            <button className="modal-btn modal-btn--cancel" onClick={() => setConfirmDelete(null)}>취소</button>
            <button className="modal-btn modal-btn--danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? '삭제 중…' : '삭제'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
