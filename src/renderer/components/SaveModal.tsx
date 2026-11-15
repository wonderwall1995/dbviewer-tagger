import { useState, useEffect, useRef, useMemo } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Modal } from './Modal'
import { CategoryDropdown } from './CategoryDropdown'
import { uiId } from '../ui/uiId'

interface SaveModalProps {
  open: boolean
  onClose: () => void
  onSave: (name: string, product: string) => void
  categories: string[]
  onCategoriesChange: (cats: string[]) => void
  currentJson?: string | null
}

function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getFullYear()).slice(2)}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function computeSaveName(name: string): string {
  const trimmed = name.trim()
  return trimmed ? `${trimmed}.json` : 'local.json'
}

export function SaveModal({ open, onClose, onSave, categories, onCategoriesChange, currentJson }: SaveModalProps) {
  const [product, setProduct] = useState('')
  const [name, setName] = useState('')
  const [wingOpen, setWingOpen] = useState(false)
  const [presets, setPresets] = useState<Array<{ name: string; mtime: number }>>([])
  const [wingQuery, setWingQuery] = useState('')
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc')
  const [overwriteTarget, setOverwriteTarget] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const wingRef = useRef<HTMLDivElement>(null)

  const presetNames = useMemo(() => new Set(presets.map(p => p.name)), [presets])

  useEffect(() => {
    if (open) {
      setProduct('')
      setName('')
      setWingOpen(false)
      setWingQuery('')
      setSortDir('desc')
      setOverwriteTarget(null)
      window.electronAPI.localListPresets().then(setPresets).catch(() => {})
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const { pinnedPreset, filteredPresets } = useMemo(() => {
    const q = wingQuery.trim().toLowerCase()
    const excluded = new Set(['sheet-settings.json'])
    const pinned = presets.find(p => p.name === 'local.json') ?? null
    const rest = presets.filter(p => !excluded.has(p.name) && p.name !== 'local.json')
    const searched = q ? rest.filter(p => p.name.toLowerCase().includes(q)) : rest
    const sorted = searched.sort((a, b) => sortDir === 'desc' ? b.mtime - a.mtime : a.mtime - b.mtime)
    return { pinnedPreset: pinned, filteredPresets: sorted }
  }, [presets, wingQuery, sortDir])

  if (!open) return null

  const doSave = (saveName: string) => {
    const nameForApi = saveName.replace(/\.json$/, '')
    onSave(nameForApi === 'local' ? '' : nameForApi, product)
    onClose()
  }

  const handleSave = () => {
    const finalName = computeSaveName(name)
    if (presetNames.has(finalName) && finalName !== currentJson) {
      setOverwriteTarget(finalName)
      return
    }
    doSave(finalName)
  }

  const handleInputFocus = () => {
    window.electronAPI.localListPresets().then(setPresets).catch(() => {})
    setWingOpen(true)
  }

  const handleInputBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (wingRef.current?.contains(e.relatedTarget as Node)) return
    setWingOpen(false)
  }

  const handleWingBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node
    if (wingRef.current?.contains(next)) return
    if (inputRef.current === next) return
    setWingOpen(false)
  }

  const handlePresetClick = async (presetName: string) => {
    const bare = presetName.replace(/\.json$/, '')
    setName(bare)
    try {
      const data = await window.electronAPI.localLoadPreset(presetName)
      if (data?.product && categories.includes(data.product)) setProduct(data.product)
    } catch {}
    inputRef.current?.focus()
  }

  const wing = wingOpen ? (
    <div
      ref={wingRef}
      className="save-modal-wing" {...uiId('SV.wing')}
      onBlur={handleWingBlur}
      onMouseDown={e => e.preventDefault()}
    >
      <div className="save-modal-wing-toolbar">
        <input
          className="save-modal-wing-search" {...uiId('SV.wing-search')}
          placeholder="검색..."
          value={wingQuery}
          onChange={e => setWingQuery(e.target.value)}
          onMouseDown={e => e.stopPropagation()}
        />
        <button
          className="save-modal-wing-sort" {...uiId('SV.wing-sort')}
          onMouseDown={e => e.preventDefault()}
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          title={sortDir === 'desc' ? '최신순 → 오래된순' : '오래된순 → 최신순'}
        >
          {sortDir === 'desc' ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
        </button>
      </div>
      <div className="save-modal-wing-list">
        {pinnedPreset && (
          <div className="save-modal-wing-item save-modal-wing-item--pinned" {...uiId('SV.wing-item')} aria-disabled="true">
            <span className="save-modal-wing-name">local</span>
            <span className="save-modal-wing-date">{fmtDate(pinnedPreset.mtime)}</span>
          </div>
        )}
        {filteredPresets.length === 0 && !wingQuery ? null : filteredPresets.length === 0 ? (
          <div className="save-modal-wing-empty">검색 결과 없음</div>
        ) : (
          filteredPresets.map((p) => (
            <button
              key={p.name}
              className="save-modal-wing-item" {...uiId('SV.wing-item')}
              onMouseDown={e => e.preventDefault()}
              onClick={() => handlePresetClick(p.name)}
            >
              <span className="save-modal-wing-name">{p.name.replace(/\.json$/, '')}</span>
              <span className="save-modal-wing-date">{fmtDate(p.mtime)}</span>
            </button>
          ))
        )}
        {!pinnedPreset && filteredPresets.length === 0 && !wingQuery && (
          <div className="save-modal-wing-empty">저장된 프리셋 없음</div>
        )}
      </div>
    </div>
  ) : null

  return (
    <>
      <Modal title="상태 저장" uiCode="SV" onClose={onClose} leftPanel={wing}>
        <div className="modal-body">
          <label className="modal-label">제품명</label>
          <CategoryDropdown
            uiIdValue="SV.product"
            value={product}
            onChange={setProduct}
            categories={categories}
            onCategoriesChange={onCategoriesChange}
          />
          <label className="modal-label" style={{ marginTop: 12 }}>파일 이름</label>
          <input
            ref={inputRef}
            className="modal-input" {...uiId('SV.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
              if (e.key === 'Escape') onClose()
            }}
            placeholder="공란이면 local.json 덮어쓰기"
          />
          <p className="modal-hint">
            {name.trim() ? `→ ${name.trim()}.json` : '공란이면 local.json에 덮어씌워집니다'}
          </p>
          {currentJson && (
            <p className="modal-current-json" {...uiId('SV.current')}>현재: {currentJson}</p>
          )}
        </div>
        <div className="modal-footer" {...uiId('SV.footer')}>
          <button className="modal-btn modal-btn--cancel" onClick={onClose}>취소</button>
          <button className="modal-btn modal-btn--save" onClick={handleSave}>저장</button>
        </div>
      </Modal>

      {overwriteTarget && (
        <Modal
          title="덮어쓰기 확인"
          draggable={false}
          showCloseButton={false}
        >
          <div className="confirm-modal-body" {...uiId('SV.confirm')}>
            <p className="confirm-modal-msg">
              <strong>{overwriteTarget}</strong>은(는) 이미 있습니다.
            </p>
            <p className="confirm-modal-sub">덮어쓰겠습니까?</p>
          </div>
          <div className="modal-footer">
            <button className="modal-btn modal-btn--cancel" onClick={() => setOverwriteTarget(null)}>
              취소
            </button>
            <button className="modal-btn modal-btn--danger" onClick={() => doSave(overwriteTarget)}>
              덮어쓰기
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
