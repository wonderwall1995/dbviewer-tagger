import { useEffect, useRef, useState } from 'react'
import { Save, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { uiId } from '../ui/uiId'
import { api, caps } from '../api'

// CED 'Local 저장' 버튼. Key 노트 창 제품 줄의 'Obsidian Vault 전송' 버튼 바로 왼쪽.
// 지금 고른 제품의 확인된 Key 노트로 CED를 만들어 저장 폴더/<제품>/ 에 쓴다. Hermes로 보내지 않는다.
export function CedSaveButton({ product }: { product: string | null }) {
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!product || product === '__null__') {
      toast.warning('제품을 고른 뒤 저장할 수 있어요.')
      return
    }
    setSaving(true)
    try {
      const r = await api.cedGenerate(product)
      const docs = r.files.length - 1 // 제품 목차 파일 1개를 뺀 Key 노트 문서 수
      const drafts = r.skippedDrafts > 0 ? ` (초안 ${r.skippedDrafts}개는 빠짐)` : ''
      if (docs <= 0) {
        toast.warning(`확인된 Key 노트가 없어요. 목차만 저장했어요.${drafts}`)
        return
      }
      toast.success(`CED를 저장했어요: Key 문서 ${docs}개 + 목차${drafts}`, {
        duration: 6000,
        action: caps.revealInOs
          ? { label: '폴더 열기', onClick: () => { api.cedReveal(product).catch(() => {}) } }
          : undefined,
      })
    } catch {
      toast.error('CED를 저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <button
      className={`keyinfo-export-btn${saving ? ' keyinfo-export-btn--busy' : ''}`} {...uiId('KI.ced-save')}
      disabled={saving}
      onClick={save}
      title="지금 고른 제품의 맥락 문서(CED)를 만들어 저장 폴더에 씁니다"
    >
      <Save size={12} />
      {saving ? '저장 중…' : 'Local 저장'}
    </button>
  )
}

// CED 저장 폴더 설정(톱니). Keyinfo 창 머리글의 제목 오른쪽.
// 이 PC의 폴더를 고를 수 있는 환경(caps.workspace)에서만 보인다.
export function CedDirSettings() {
  const [open, setOpen] = useState(false)
  const [dirInfo, setDirInfo] = useState<{ path: string; isDefault: boolean } | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)

  // 설정 창 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!caps.workspace) return null

  const loadDir = () => {
    api.cedGetDir().then(setDirInfo).catch(() => setDirInfo(null))
  }

  const applyDir = async (dir: string | null) => {
    const r = await api.cedSetDir(dir)
    if (!r.ok) {
      toast.error(`저장 폴더를 바꾸지 못했어요: ${r.message}`)
      return
    }
    loadDir()
  }

  const pickDir = async () => {
    const dir = await api.cedPickDir()
    if (dir) await applyDir(dir)
  }

  return (
    <span className="ced-dir" ref={wrapRef}>
      <button
        className={`ced-dir-btn${open ? ' ced-dir-btn--on' : ''}`} {...uiId('KI.ced-dir')}
        onClick={() => { if (!open) loadDir(); setOpen(!open) }}
        title="CED 저장 폴더 설정"
        aria-label="CED 저장 폴더 설정"
      >
        <Settings size={13} />
      </button>
      {open && (
        // 머리글은 창을 끄는 손잡이라서, 설정 창 안을 누를 때는 끌기가 시작되지 않게 막는다.
        <span className="ced-dir-panel" {...uiId('KI.ced-dir-panel')} onMouseDown={(e) => e.stopPropagation()}>
          <span className="ced-dir-title">CED 저장 폴더</span>
          <span className="ced-dir-path" title={dirInfo?.path}>
            {dirInfo ? dirInfo.path : '불러오는 중…'}
          </span>
          <span className="ced-dir-hint">
            제품마다 이 폴더 아래 제품 이름 폴더에 저장해요.{dirInfo?.isDefault ? ' (기본값: 작업 폴더의 CED)' : ''}
          </span>
          <span className="ced-dir-actions">
            <button className="ced-dir-action" onClick={pickDir}>폴더 고르기</button>
            <button className="ced-dir-action" onClick={() => applyDir(null)} disabled={!dirInfo || dirInfo.isDefault}>
              기본값으로
            </button>
          </span>
        </span>
      )}
    </span>
  )
}
