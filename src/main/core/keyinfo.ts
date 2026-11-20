import path from 'path'
import fs from 'fs'
import Papa from 'papaparse'
import { writeCedIndex } from '../cedIndex'
import { backupDirectory, saveWorkspaceBackup, restoreWorkspaceBackup } from '../workspaceBackup'
import type { BackupMeta } from '../workspaceBackup'
import type { Ctx, Handlers } from './context'

const H: Handlers = {}
export const keyinfoHandlers = H

// ── Keyinfo JSON 영속화 ─────────────────────────────────────────────────────

interface KeyinfoColSchema {
  dbType?: string
  isPK?: boolean
  isFK?: boolean
  fkRef?: string
  isUnique?: boolean
  isNotNull?: boolean
  backrefs?: string[]
}

interface KeyinfoFolder { id: string; name: string }

interface KeyinfoData {
  product: string | null
  pinnedColumns: Array<{ pinId: number; fileName: string; columnKey: string; folderId?: string }>
  folders?: KeyinfoFolder[]
  schema: Record<string, Record<string, KeyinfoColSchema>>
}


function getKeyinfoPath(ctx: Ctx, product?: string | null): string {
  return path.join(ctx.ws.docsKeyinfoDir, product?.trim() || 'none', 'keyinfo.json')
}

function loadKeyinfoData(p: string): KeyinfoData {
  try {
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, 'utf-8')) as KeyinfoData
      if (!d.folders) d.folders = []
      return d
    }
  } catch {}
  return { product: null, pinnedColumns: [], folders: [], schema: {} }
}

function saveKeyinfoData(p: string, data: KeyinfoData): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
}

function parseCsvHeaderOnly(filePath: string): {
  columns: string[]
  constraints: Record<string, KeyinfoColSchema>
  dbTypes: Record<string, string>
} {
  const fd = fs.openSync(filePath, 'r')
  const buf = Buffer.alloc(8192)
  const n = fs.readSync(fd, buf, 0, 8192, 0)
  fs.closeSync(fd)

  const text = buf.subarray(0, n).toString('utf-8')
  const lines = text.split(/\r?\n/).filter(l => l.trim())

  const parseRow = (line: string): string[] => {
    const out: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') inQ = !inQ
      else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = '' }
      else cur += ch
    }
    out.push(cur.trim())
    return out
  }

  const parseCell = (cell: string): KeyinfoColSchema => {
    const inner = cell.slice(1, -1)
    const c: KeyinfoColSchema = {}
    for (const part of inner.split('|')) {
      if (part === 'PK') c.isPK = true
      else if (part === 'UQ') c.isUnique = true
      else if (part === 'NN') c.isNotNull = true
      else if (part.startsWith('FK→')) { c.isFK = true; c.fkRef = part.slice(3) }
      else if (part.startsWith('REF←')) c.backrefs = part.slice(4).split(',')
    }
    return c
  }

  const columns = parseRow(lines[0] ?? '')
  const constraints: Record<string, KeyinfoColSchema> = {}
  const dbTypes: Record<string, string> = {}

  let idx = 1
  if (lines[idx] && /^\s*"?\[/.test(lines[idx])) {
    const cells = parseRow(lines[idx])
    columns.forEach((col, i) => {
      const cell = (cells[i] ?? '').trim().replace(/^"|"$/g, '')
      if (/^\[.*\]$/.test(cell)) constraints[col] = parseCell(cell)
    })
    idx++
  }

  if (lines[idx] && /^\s*"?\{/.test(lines[idx])) {
    const cells = parseRow(lines[idx])
    columns.forEach((col, i) => {
      const cell = (cells[i] ?? '').trim().replace(/^"|"$/g, '')
      if (/^\{.*\}$/.test(cell)) dbTypes[col] = cell.slice(1, -1)
    })
  }

  return { columns, constraints, dbTypes }
}

// local:clearTmp — ./local/tmp 폴더 전체 삭제
H['local:clearTmp'] = async (ctx: Ctx) => {
  if (fs.existsSync(ctx.ws.tmpDir)) fs.rmSync(ctx.ws.tmpDir, { recursive: true, force: true })
}

// ── Backup ────────────────────────────────────────────────────────────────────

H['backup:list'] = async (ctx: Ctx): Promise<BackupMeta[]> => {
  if (!fs.existsSync(ctx.ws.backupRoot)) return []
  const result: BackupMeta[] = []
  for (const name of fs.readdirSync(ctx.ws.backupRoot)) {
    if (!name.startsWith('backup_')) continue
    const metaPath = path.join(ctx.ws.backupRoot, name, 'meta.json')
    if (fs.existsSync(metaPath)) {
      try { result.push(JSON.parse(fs.readFileSync(metaPath, 'utf-8'))) } catch {}
    }
  }
  return result.sort((a, b) => b.date.localeCompare(a.date))
}

H['backup:save'] = async (ctx: Ctx, title: string, comment: string): Promise<BackupMeta> => {
  return saveWorkspaceBackup(ctx.ws.root, title, comment)
}

H['backup:restore'] = async (ctx: Ctx, id: string) => {
  restoreWorkspaceBackup(ctx.ws.root, id)
  ctx.state.keyNoteMigratedFor = ''
}

H['backup:delete'] = async (ctx: Ctx, id: string) => {
  const backupDir = backupDirectory(ctx.ws.root, id)
  if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true })
}

// ── Key 연관 그룹 ─────────────────────────────────────────────────────────────

function loadKeyinfoRelations(ctx: Ctx): unknown[] {
  if (!fs.existsSync(ctx.ws.keyinfoRelationsPath)) return []
  try { return JSON.parse(fs.readFileSync(ctx.ws.keyinfoRelationsPath, 'utf-8')) } catch { return [] }
}

function saveKeyinfoRelations(ctx: Ctx, groups: unknown[]) {
  fs.mkdirSync(path.dirname(ctx.ws.keyinfoRelationsPath), { recursive: true })
  fs.writeFileSync(ctx.ws.keyinfoRelationsPath, JSON.stringify(groups, null, 2), 'utf-8')
}

H['keyinfo:listRelations'] = (ctx: Ctx) => loadKeyinfoRelations(ctx)
H['keyinfo:saveRelations'] = (ctx: Ctx, groups: unknown[]) => saveKeyinfoRelations(ctx, groups)

// ── Key 노트 (Keyinfo) ─────────────────────────────────────────────────────────
// 관계 그룹을 확장한 Key 노트이다. 의미 단위 하나를 노트 하나로 두고, 노트 하나는 한 제품에만 속한다.
// 제품마다 docs/keyinfo/<제품>/keynotes.json에 저장한다. (제품이 없으면 none 폴더)
// 제품 사이의 연결은 키워드(개념 노트로 가는 링크)가 맡는다.

// suspended = 작업 일시 중단. 노트 목록에서 빠져 후보 목록에 보류로 나타난다. 내용은 그대로 둔다.
type KeyNoteStatus = 'draft' | 'confirmed' | 'suspended'
interface KeyNoteMember { fileName: string; columnKey: string }
interface KeyNote {
  id: string
  product: string          // 소속 제품. 한 노트는 한 제품에만 속한다.
  title: string            // 제목. 기본값은 대표 컬럼 이름이다.
  definition: string       // 한 줄 정의
  body: string             // 본문 (평문)
  keywords: string[]       // 개념 노트로 가는 링크로 내보낸다.
  valueMeanings: string    // 값 의미. 상태값, 코드값 컬럼에 쓴다.
  status: KeyNoteStatus    // 초안은 내보내지 않는다.
  members: KeyNoteMember[] // 출현 목록
  excluded: KeyNoteMember[] // 사용자가 출현 목록에서 뺀 컬럼. 새로고침이 다시 넣지 않는다.
  createdAt: string
  updatedAt: string
}

export function productDirName(product?: string | null): string {
  return product?.trim() || 'none'
}

function getKeyNotesPath(ctx: Ctx, product?: string | null): string {
  return path.join(ctx.ws.docsKeyinfoDir, productDirName(product), 'keynotes.json')
}

function newKeyNoteId(): string {
  return `kn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// 저장된 값이 빠졌거나 잘못되어도 항상 완전한 노트로 만든다.
function normalizeKeyNote(raw: any, product: string): KeyNote {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const seen = new Set<string>()
  const members: KeyNoteMember[] = []
  for (const m of Array.isArray(raw?.members) ? raw.members : []) {
    const fileName = text(m?.fileName)
    const columnKey = text(m?.columnKey)
    const key = `${fileName}\u0000${columnKey}`
    if (!fileName || !columnKey || seen.has(key)) continue
    seen.add(key)
    members.push({ fileName, columnKey })
  }
  const excluded: KeyNoteMember[] = []
  const seenExcluded = new Set<string>()
  for (const m of Array.isArray(raw?.excluded) ? raw.excluded : []) {
    const fileName = text(m?.fileName)
    const columnKey = text(m?.columnKey)
    const key = `${fileName}\u0000${columnKey}`
    if (!fileName || !columnKey || seenExcluded.has(key) || seen.has(key)) continue
    seenExcluded.add(key)
    excluded.push({ fileName, columnKey })
  }
  const keywords: string[] = []
  for (const k of Array.isArray(raw?.keywords) ? raw.keywords : []) {
    const word = text(k)
    if (word && !keywords.includes(word)) keywords.push(word)
  }
  const now = new Date().toISOString()
  return {
    id: text(raw?.id) || newKeyNoteId(),
    product,
    title: text(raw?.title) || members[0]?.columnKey || '제목 없음',
    definition: text(raw?.definition),
    body: typeof raw?.body === 'string' ? raw.body : '',
    keywords,
    valueMeanings: typeof raw?.valueMeanings === 'string' ? raw.valueMeanings : '',
    status: raw?.status === 'confirmed' ? 'confirmed' : raw?.status === 'suspended' ? 'suspended' : 'draft',
    members,
    excluded,
    createdAt: text(raw?.createdAt) || now,
    updatedAt: text(raw?.updatedAt) || now,
  }
}

function loadKeyNotes(ctx: Ctx, product?: string | null): KeyNote[] {
  const p = getKeyNotesPath(ctx, product)
  const dirName = productDirName(product)
  try {
    if (!fs.existsSync(p)) return []
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
    const list: any[] = Array.isArray(parsed?.notes) ? parsed.notes : []
    return list.map((n) => normalizeKeyNote(n, dirName))
  } catch {
    return []
  }
}

function writeKeyNotes(ctx: Ctx, product: string | null | undefined, notes: KeyNote[]): void {
  const p = getKeyNotesPath(ctx, product)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify({ version: 1, product: productDirName(product), notes }, null, 2), 'utf-8')
}

// 노트를 저장한다. 받은 노트의 제품 값은 무시하고 저장하는 제품으로 맞춘다. (한 노트는 한 제품에만 속한다)
function saveKeyNotes(ctx: Ctx, product: string | null | undefined, rawNotes: unknown): void {
  const dirName = productDirName(product)
  const list: any[] = Array.isArray(rawNotes) ? rawNotes : []
  const now = new Date().toISOString()
  const ids = new Set<string>()
  const notes: KeyNote[] = []
  for (const raw of list) {
    const note = normalizeKeyNote({ ...raw, updatedAt: now }, dirName)
    if (ids.has(note.id)) note.id = newKeyNoteId()
    ids.add(note.id)
    notes.push(note)
  }
  writeKeyNotes(ctx, product, notes)
}

// 기존 관계 그룹(relations.json)을 Key 노트로 옮긴다. 앱을 켠 뒤 처음 Key 노트를 불러올 때 한 번 실행한다.
//  - 관계 그룹은 제품을 넘나들 수 있으므로 제품별로 나눠서, 제품마다 노트 하나로 만든다.
//  - 여러 제품에 걸친 그룹은 원래 이름을 키워드로 달아 노트끼리 이어 둔다.
//  - 이미 Key 노트 파일이 있는 제품은 덮어쓰지 않는다. 원본 relations.json은 지우지 않고 그대로 두며, 백업도 남긴다.

function migrateLegacyRelations(ctx: Ctx): { products: string[]; notes: number } {
  const result = { products: [] as string[], notes: 0 }
  if (ctx.state.keyNoteMigratedFor === ctx.ws.docsKeyinfoDir) return result
  ctx.state.keyNoteMigratedFor = ctx.ws.docsKeyinfoDir

  const groups = loadKeyinfoRelations(ctx) as any[]
  if (!Array.isArray(groups) || groups.length === 0) return result

  const byProduct = new Map<string, KeyNote[]>()
  for (const group of groups) {
    const label = typeof group?.label === 'string' ? group.label.trim() : ''
    const perProduct = new Map<string, KeyNoteMember[]>()
    for (const m of Array.isArray(group?.members) ? group.members : []) {
      const product = productDirName(typeof m?.product === 'string' ? m.product : '')
      const list = perProduct.get(product) ?? []
      list.push({ fileName: String(m?.fileName ?? ''), columnKey: String(m?.columnKey ?? '') })
      perProduct.set(product, list)
    }
    const crossProduct = perProduct.size > 1
    for (const [product, members] of perProduct) {
      const note = normalizeKeyNote(
        { title: label, members, keywords: crossProduct && label ? [label] : [], status: 'draft' },
        product,
      )
      if (note.members.length === 0) continue
      byProduct.set(product, [...(byProduct.get(product) ?? []), note])
    }
  }
  if (byProduct.size === 0) return result

  // 원본 백업 (이미 있으면 그대로 둔다)
  try {
    const backup = path.join(path.dirname(ctx.ws.keyinfoRelationsPath), 'relations.legacy.json')
    if (!fs.existsSync(backup)) fs.copyFileSync(ctx.ws.keyinfoRelationsPath, backup)
  } catch { /* 백업하지 못해도 원본은 그대로 남는다. */ }

  for (const [product, notes] of byProduct) {
    if (fs.existsSync(getKeyNotesPath(ctx, product))) continue
    writeKeyNotes(ctx, product, notes)
    result.products.push(product)
    result.notes += notes.length
  }
  return result
}

H['keynote:list'] = (ctx: Ctx, product: string | null) => {
  migrateLegacyRelations(ctx)
  return loadKeyNotes(ctx, product)
}

H['keynote:save'] = (ctx: Ctx, product: string | null, notes: unknown) => {
  saveKeyNotes(ctx, product, notes)
}

// ── 제품 맥락 문서 (Context Enrichment Docs, CED) ─────────────────────────────
// 확인된(confirmed) Key 노트로 마크다운 문서를 만들어 작업 폴더의 CED/<제품>/ 에 쓴다.
// 구성: 제품 목차 파일 1개(<제품>.md) + Key 노트당 파일 1개(<제목>.md). Obsidian 링크([[제목]])로 목차와 노트를 잇는다.
// 이 함수는 파일만 만든다. Hermes로 보내는 일은 하지 않는다.
// 지난번에 만든 파일 목록(.ced-manifest.json)에 있는데 이번에 없는 파일만 지운다. 사용자가 직접 넣은 파일은 건드리지 않는다.
const CED_MANIFEST = '.ced-manifest.json'

export function cedFileStem(title: string): string {
  const stem = title.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return stem || '제목 없음'
}

function cedColumnLine(fileName: string, columnKey: string, schema: KeyinfoData['schema']): string {
  const col = schema[fileName]?.[columnKey]
  const parts: string[] = []
  if (col?.dbType) parts.push(col.dbType)
  if (col?.isPK) parts.push('PK')
  if (col?.isFK) parts.push(col.fkRef ? `FK → ${col.fkRef}` : 'FK')
  if (col?.isNotNull) parts.push('NN')
  if (col?.isUnique) parts.push('UQ')
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `- \`${fileName}\` · \`${columnKey}\`${detail}`
}

function buildCedNote(note: KeyNote, productName: string, indexStem: string, schema: KeyinfoData['schema']): string {
  // 출현 목록은 키워드와 같이 문서의 값(메타데이터)이다. 테이블.컬럼 목록과 테이블 목록을 둘 다 둔다.
  const appearsIn = note.members.map((m) => `${m.fileName.replace(/\.csv$/i, '')}.${m.columnKey}`)
  const tables = [...new Set(note.members.map((m) => m.fileName.replace(/\.csv$/i, '')))]
  const lines: string[] = [
    '---',
    `product: ${JSON.stringify(productName)}`,
    `keywords: ${JSON.stringify(note.keywords)}`,
    `appearsIn: ${JSON.stringify(appearsIn)}`,
    `tables: ${JSON.stringify(tables)}`,
    `status: ${note.status}`,
    `updated: ${JSON.stringify(note.updatedAt)}`,
    '---',
    `# ${note.title}`,
    '',
    `목차: [[${indexStem}]]`,
    '',
  ]
  if (note.definition) lines.push('## 정의', '', note.definition, '')
  if (note.members.length > 0) {
    lines.push('## 출현 목록', '')
    for (const m of note.members) lines.push(cedColumnLine(m.fileName, m.columnKey, schema))
    lines.push('')
  }
  if (note.valueMeanings.trim()) lines.push('## 값의 뜻', '', note.valueMeanings.trim(), '')
  if (note.body.trim()) lines.push('## 설명', '', note.body.trim(), '')
  return lines.join('\n')
}

export function generateCed(ctx: Ctx, product: string | null | undefined): { dir: string; files: string[]; skippedDrafts: number } {
  const dirName = productDirName(product)
  const all = loadKeyNotes(ctx, product)
  const notes = all.filter((n) => n.status === 'confirmed')
  const schema = loadKeyinfoData(getKeyinfoPath(ctx, product)).schema
  const outDir = path.join(ctx.cedDir(), cedFileStem(dirName))
  fs.mkdirSync(outDir, { recursive: true })

  const indexStem = cedFileStem(dirName)
  const used = new Set<string>([indexStem.toLowerCase()])
  const written: { stem: string; note: KeyNote }[] = []
  for (const note of notes) {
    let stem = cedFileStem(note.title)
    if (used.has(stem.toLowerCase())) stem = `${stem}-${note.id.slice(-4)}`
    used.add(stem.toLowerCase())
    written.push({ stem, note })
  }

  const files: string[] = []
  for (const { stem, note } of written) {
    fs.writeFileSync(path.join(outDir, `${stem}.md`), buildCedNote(note, dirName, indexStem, schema), 'utf-8')
    files.push(`${stem}.md`)
  }

  const indexLines = [
    '---',
    `product: ${JSON.stringify(dirName)}`,
    `notes: ${written.length}`,
    `generated: ${JSON.stringify(new Date().toISOString())}`,
    '---',
    `# ${dirName} 맥락 문서`,
    '',
    '확인된 Key 노트 목록이다.',
    '',
  ]
  if (written.length === 0) indexLines.push('(확인된 Key 노트가 없다)')
  for (const { stem, note } of written) {
    indexLines.push(`- [[${stem}]]${note.definition ? ` — ${note.definition}` : ''}`)
  }
  indexLines.push('')
  writeCedIndex(path.join(outDir, `${indexStem}.md`), indexLines.join('\n'))
  files.push(`${indexStem}.md`)

  // 지난번에 만들었고 이번에는 없는 파일만 지운다.
  const manifestPath = path.join(outDir, CED_MANIFEST)
  try {
    const prev: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const prevFiles = Array.isArray((prev as { files?: unknown })?.files) ? (prev as { files: unknown[] }).files : []
    for (const f of prevFiles) {
      if (typeof f !== 'string' || files.includes(f) || /[\\/]/.test(f)) continue
      const target = path.join(outDir, f)
      if (fs.existsSync(target)) fs.unlinkSync(target)
    }
  } catch { /* 처음 만들거나 목록을 읽지 못하면 지우지 않는다. */ }
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, files }, null, 2), 'utf-8')

  return { dir: outDir, files, skippedDrafts: all.length - notes.length }
}

H['ced:generate'] = (ctx: Ctx, product: string | null) => generateCed(ctx, product)

// ── Key 자동 후보 ───────────────────────────────────────────────────────────────
// 자동 색인(keyinfo.json의 schema)에서 Key 후보를 제안한다. 후보는 제안일 뿐이고, 사람이 수락해야 초안 노트가 된다.
//  1. FK 체인: FK로 이어진 컬럼은 하나의 후보로 묶는다. (예: users.id, transactions.sender_id, comments.user_id)
//     FK 제약이 없는 컬럼은 이름 규칙으로 추정해 같은 방식으로 묶는다. (예: userId -> users.id) 이 후보는 ref로 구분한다.
//  2. 같은 이름: FK로 이어지지 않은 컬럼 중 이름이 같은 것을 2개 이상의 파일에서 찾으면 묶는다. (예: created_at)
//  - id는 모든 테이블에 있지만 뜻이 다르므로 이름으로 묶지 않는다. id는 FK 체인으로만 묶인다.
//  - _로 시작하는 파일(마이그레이션 기록 등 내부용)은 제외한다.
//  - 이미 Key 노트에 들어간 컬럼은 후보에서 뺀다. 거절한 후보는 다시 보이지 않는다.

// kind hold = 작업 일시 중단한 노트. noteId로 노트를 가리키고, 수락하면 내용 그대로 초안으로 돌아온다.
interface KeyCandidate {
  signature: string
  kind: 'fk' | 'ref' | 'name' | 'hold'
  noteId?: string
  title: string
  members: KeyNoteMember[]
  reason: string
}

const KEY_NAME_EXCLUDED = new Set(['id'])

const keyOf = (fileName: string, columnKey: string) => `${fileName}\u0000${columnKey}`

function fileBaseName(fileName: string): string {
  return fileName.replace(/\.csv$/i, '')
}

function splitColumnRef(ref: string): { table: string; column: string } | null {
  const i = ref.lastIndexOf('.')
  if (i <= 0 || i === ref.length - 1) return null
  return { table: ref.slice(0, i), column: ref.slice(i + 1) }
}

interface KeyGroup { kind: 'fk' | 'ref' | 'name'; title: string; reason: string; members: KeyNoteMember[] }

// 스키마에서 같은 Key로 보이는 컬럼 묶음을 모두 찾는다. 노트에 들어갔는지, 핀이 있는지는 여기서 따지지 않는다.
function buildKeyGroups(schema: Record<string, Record<string, KeyinfoColSchema>>): KeyGroup[] {
  const files = Object.keys(schema ?? {}).filter((f) => !f.startsWith('_'))

  // 테이블 이름 -> 파일. 사이드바 표시용으로 "스키마.테이블.csv"가 된 파일도 마지막 조각으로 찾는다.
  const tableToFile = new Map<string, string>()
  for (const f of files) {
    const base = fileBaseName(f)
    tableToFile.set(base, f)
    const last = base.split('.').pop()
    if (last && !tableToFile.has(last)) tableToFile.set(last, f)
  }
  const hasColumn = (file: string, column: string) => !!schema[file] && column in schema[file]

  // FK 관계로 이어진 컬럼을 같은 묶음으로 모은다. (union-find)
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let root = k
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) as string
    parent.set(k, root)
    return root
  }
  const linked = new Set<string>()
  const union = (a: string, b: string) => {
    linked.add(a)
    linked.add(b)
    if (!parent.has(a)) parent.set(a, a)
    if (!parent.has(b)) parent.set(b, b)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const file of files) {
    for (const [column, info] of Object.entries(schema[file])) {
      if (info.isFK && info.fkRef) {
        const ref = splitColumnRef(info.fkRef)
        const target = ref ? tableToFile.get(ref.table) : undefined
        if (ref && target && hasColumn(target, ref.column)) union(keyOf(file, column), keyOf(target, ref.column))
      }
      for (const back of info.backrefs ?? []) {
        const ref = splitColumnRef(back)
        const source = ref ? tableToFile.get(ref.table) : undefined
        if (ref && source && hasColumn(source, ref.column)) union(keyOf(file, column), keyOf(source, ref.column))
      }
    }
  }

  // FK 제약이 없는 컬럼은 이름 규칙으로 가리키는 곳을 추정한다. (예: userId -> users.id, bankTransferId -> bank_transfers.id)
  // Prisma처럼 DB에 FK 제약을 두지 않는 경우가 많다. 추정이므로 후보의 종류를 ref로 구분해 사람이 확인하게 한다.
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const compactToFile = new Map<string, string>()
  for (const f of files) {
    const compactName = compact(fileBaseName(f).split('.').pop() ?? '')
    if (compactName && !compactToFile.has(compactName)) compactToFile.set(compactName, f)
  }
  const findTable = (stem: string): string | undefined => {
    const variants = [stem, `${stem}s`, `${stem}es`]
    if (stem.endsWith('y')) variants.push(`${stem.slice(0, -1)}ies`)
    for (const v of variants) {
      const hit = compactToFile.get(v)
      if (hit) return hit
    }
    return undefined
  }
  // 대상 테이블의 id 컬럼. id가 없으면 PK가 하나일 때 그 컬럼을 쓴다.
  const findIdColumn = (file: string): string | undefined => {
    const cols = Object.entries(schema[file])
    const byName = cols.find(([c]) => c.toLowerCase() === 'id')
    if (byName) return byName[0]
    const pks = cols.filter(([, info]) => info.isPK)
    return pks.length === 1 ? pks[0][0] : undefined
  }
  const logicalEdges: Array<[string, string]> = []
  const targetKeys = new Set<string>()
  for (const file of files) {
    for (const [column, info] of Object.entries(schema[file])) {
      if (info.isFK) continue // FK 제약이 있으면 그것을 쓴다.
      const m = /^(.+?)(?:_id|Id|ID)$/.exec(column)
      if (!m) continue
      const target = findTable(compact(m[1]))
      if (!target || target === file) continue
      const targetColumn = findIdColumn(target)
      if (!targetColumn) continue
      logicalEdges.push([keyOf(file, column), keyOf(target, targetColumn)])
      targetKeys.add(keyOf(target, targetColumn))
    }
  }
  for (const [a, b] of logicalEdges) union(a, b)
  const logicalRoots = new Set<string>()
  for (const [a] of logicalEdges) logicalRoots.add(find(a))

  const groups: KeyGroup[] = []

  // 1. FK로 이어진 컬럼. 제약이 있으면 fk, 이름 규칙으로 추정한 연결이 하나라도 있으면 ref이다.
  const chains = new Map<string, KeyNoteMember[]>()
  for (const k of linked) {
    const [fileName, columnKey] = k.split('\u0000')
    const root = find(k)
    chains.set(root, [...(chains.get(root) ?? []), { fileName, columnKey }])
  }
  for (const [root, members] of chains) {
    members.sort((a, b) => a.fileName.localeCompare(b.fileName) || a.columnKey.localeCompare(b.columnKey))
    // 대표는 다른 컬럼을 가리키지 않는 쪽이다. PK, 추정으로 가리켜진 컬럼, 나머지 순으로 고른다. 제목과 원천 테이블이 된다.
    const notFk = members.filter((m) => !schema[m.fileName][m.columnKey]?.isFK)
    const rep =
      notFk.find((m) => schema[m.fileName][m.columnKey]?.isPK) ??
      notFk.find((m) => targetKeys.has(keyOf(m.fileName, m.columnKey))) ??
      notFk[0] ??
      members[0]
    const repTable = fileBaseName(rep.fileName)
    const inferred = logicalRoots.has(root)
    groups.push({
      kind: inferred ? 'ref' : 'fk',
      title: `${repTable.split('.').pop()}.${rep.columnKey}`,
      reason: inferred ? `FK 제약 없음, 이름 규칙으로 추정 (${members.length}개)` : `FK로 이어진 컬럼 ${members.length}개`,
      members,
    })
  }

  // 2. 같은 이름
  const byName = new Map<string, KeyNoteMember[]>()
  for (const file of files) {
    for (const column of Object.keys(schema[file])) {
      if (linked.has(keyOf(file, column))) continue
      const lower = column.toLowerCase()
      if (KEY_NAME_EXCLUDED.has(lower)) continue
      byName.set(lower, [...(byName.get(lower) ?? []), { fileName: file, columnKey: column }])
    }
  }
  for (const members of byName.values()) {
    if (new Set(members.map((m) => m.fileName)).size < 2) continue
    groups.push({
      kind: 'name',
      title: members[0].columnKey,
      reason: `같은 이름이 ${new Set(members.map((m) => m.fileName)).size}개 파일에`,
      members,
    })
  }

  return groups
}

// 후보는 핀으로 고정한 컬럼이 들어 있는 묶음만 보여 준다. 핀을 거두면 후보에서도 사라진다.
// 이미 노트에 들어간 컬럼은 빼고, 2개 미만이 남으면 후보로 보이지 않는다.
function buildKeyCandidates(
  schema: Record<string, Record<string, KeyinfoColSchema>>,
  covered: Set<string>,
  pinnedColumnKeys: Set<string>,
): KeyCandidate[] {
  const result: KeyCandidate[] = []
  for (const g of buildKeyGroups(schema)) {
    if (!g.members.some((m) => pinnedColumnKeys.has(m.columnKey))) continue
    const members = g.members.filter((m) => !covered.has(keyOf(m.fileName, m.columnKey)))
    if (members.length < 2) continue
    const signature = members.map((m) => `${m.fileName}:${m.columnKey}`).sort().join('|')
    result.push({ signature, kind: g.kind, title: g.title, members, reason: g.reason })
  }
  const order = { fk: 0, ref: 1, name: 2, hold: 3 }
  result.sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : order[a.kind] - order[b.kind]))
  return result
}

function pinnedColumnKeys(ctx: Ctx, product?: string | null): Set<string> {
  return new Set(loadKeyinfoData(getKeyinfoPath(ctx, product)).pinnedColumns.map((p) => p.columnKey))
}

function listKeyCandidates(ctx: Ctx, product?: string | null): KeyCandidate[] {
  migrateLegacyRelations(ctx)
  const data = loadKeyinfoData(getKeyinfoPath(ctx, product))
  const notes = loadKeyNotes(ctx, product)
  const covered = new Set<string>()
  for (const note of notes) {
    for (const m of note.members) covered.add(keyOf(m.fileName, m.columnKey))
  }
  const candidates = buildKeyCandidates(data.schema, covered, pinnedColumnKeys(ctx, product))
  // 작업을 일시 중단한 노트는 후보 맨 위에 보류로 보인다. 내용은 그대로 있다.
  const held: KeyCandidate[] = notes
    .filter((n) => n.status === 'suspended')
    .map((n) => ({
      signature: `hold:${n.id}`,
      kind: 'hold' as const,
      noteId: n.id,
      title: n.title,
      members: n.members,
      reason: '작업 일시 중단한 노트',
    }))
  return [...held, ...candidates]
}

H['keynote:candidates'] = (ctx: Ctx, product: string | null) => listKeyCandidates(ctx, product)

// 후보를 수락하면 초안 노트가 된다. 보류한 노트는 내용 그대로 초안으로 돌아온다.
// 후보가 이미 사라졌다면(다른 노트가 먼저 차지했거나 핀이 없어짐) null을 돌려준다.
H['keynote:acceptCandidate'] = (ctx: Ctx, product: string | null, signature: string) => {
  const candidate = listKeyCandidates(ctx, product).find((c) => c.signature === signature)
  if (!candidate) return null
  const notes = loadKeyNotes(ctx, product)
  if (candidate.kind === 'hold') {
    const held = notes.find((n) => n.id === candidate.noteId)
    if (!held) return null
    held.status = 'draft'
    held.updatedAt = new Date().toISOString()
    writeKeyNotes(ctx, product, notes)
    return held
  }
  const note = normalizeKeyNote(
    { title: candidate.title, members: candidate.members, status: 'draft' },
    productDirName(product),
  )
  writeKeyNotes(ctx, product, [...notes, note])
  return note
}

// 핀을 거둔 뒤 부르는 정리 함수. 남은 핀이 하나도 없는 노트는 지운다. (핀이 Key 노트가 존재하는 조건이다)
// 보류 노트도 같다. 지운 노트의 제목 목록을 돌려준다.
H['keynote:pruneByPins'] = (ctx: Ctx, product: string | null, pins: unknown) => {
  const keys = new Set<string>()
  for (const p of Array.isArray(pins) ? pins : []) {
    const k = (p as { columnKey?: unknown })?.columnKey
    if (typeof k === 'string' && k) keys.add(k)
  }
  const notes = loadKeyNotes(ctx, product)
  const kept = notes.filter((n) => n.members.some((m) => keys.has(m.columnKey)))
  const removed = notes.filter((n) => !kept.includes(n)).map((n) => n.title)
  if (removed.length > 0) writeKeyNotes(ctx, product, kept)
  return removed
}

// 출현 목록 새로고침. 노트마다 같은 Key로 보이는 컬럼 묶음을 다시 찾아 새 테이블의 컬럼을 넣는다.
// 사용자가 뺀 컬럼(excluded)은 다시 넣지 않는다.
// 보류 노트는 건드리지 않는다. 바뀐 노트 수를 돌려준다.
H['keynote:refreshMembers'] = (ctx: Ctx, product: string | null) => {
  const schema = loadKeyinfoData(getKeyinfoPath(ctx, product)).schema
  const groups = buildKeyGroups(schema)
  const notes = loadKeyNotes(ctx, product)
  let changed = 0
  for (const note of notes) {
    if (note.status === 'suspended') continue
    const have = new Set(note.members.map((m) => keyOf(m.fileName, m.columnKey)))
    const skip = new Set(note.excluded.map((m) => keyOf(m.fileName, m.columnKey)))
    let touched = false
    for (const g of groups) {
      if (!g.members.some((m) => have.has(keyOf(m.fileName, m.columnKey)))) continue
      for (const m of g.members) {
        const k = keyOf(m.fileName, m.columnKey)
        if (have.has(k) || skip.has(k)) continue
        note.members.push(m)
        have.add(k)
        touched = true
      }
    }
    if (touched) { note.updatedAt = new Date().toISOString(); changed++ }
  }
  if (changed > 0) writeKeyNotes(ctx, product, notes)
  return changed
}
// 값 예시: CSV에서 지정한 컬럼의 값만 읽어 20~50행씩 나눠 준다. 읽기 전용이다.
// 파일 경로는 프리셋 JSON의 fileSources에서 온다. 제약 행([PK])과 타입 행({integer})은 건너뛴다.
// 파일은 앞쪽 32MB까지 한 번 읽어 고른 컬럼만 메모리에 두고(마지막 한 번의 결과만), 파일이 바뀌면(수정 시각, 크기) 다시 읽는다.
// 필터(빈 값, 0 제외)와 정렬은 읽은 전체 행에 적용하므로, 먼저 불러온 행만 정렬되는 일이 없다.
const SAMPLE_READ_CAP = 32 * 1024 * 1024
export type SampleCache = {
  key: string
  columns: string[]
  rows: string[][]
  truncated: boolean
  viewKey: string
  view: string[][]
} | null

H['keynote:sampleRows'] = (ctx: Ctx, filePath: unknown, columnKeys: unknown, limit: unknown, skipBlank: unknown, offset: unknown, sort: unknown) => {
  const fail = (reason: string) => ({ ok: false, reason, columns: [] as string[], rows: [] as string[][], total: 0, hasMore: false, truncated: false })
  if (typeof filePath !== 'string' || !/\.csv$/i.test(filePath)) return fail('invalid')
  if (!fs.existsSync(filePath)) return fail('missing')
  const wanted = Array.isArray(columnKeys) ? columnKeys.filter((k): k is string => typeof k === 'string') : []
  const take = Math.min(Math.max(typeof limit === 'number' ? Math.floor(limit) : 20, 1), 200)
  const from = Math.max(typeof offset === 'number' ? Math.floor(offset) : 0, 0)
  const sortCol = typeof (sort as { column?: unknown } | null)?.column === 'string' ? (sort as { column: string }).column : ''
  const sortDir = (sort as { dir?: unknown } | null)?.dir === 'desc' ? 'desc' : 'asc'
  try {
    const stat = fs.statSync(filePath)
    const key = JSON.stringify([filePath, stat.mtimeMs, stat.size, wanted])
    if (!ctx.state.sampleCache || ctx.state.sampleCache.key !== key) {
      const size = Math.min(stat.size, SAMPLE_READ_CAP)
      const fd = fs.openSync(filePath, 'r')
      const buf = Buffer.alloc(size)
      const n = fs.readSync(fd, buf, 0, size, 0)
      fs.closeSync(fd)
      let text = buf.subarray(0, n).toString('utf-8')
      const truncated = stat.size > SAMPLE_READ_CAP
      if (truncated) text = text.slice(0, text.lastIndexOf('\n') + 1)   // 잘린 마지막 행을 버린다.
      const all = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true }).data
      if (all.length === 0) {
        ctx.state.sampleCache = { key, columns: [], rows: [], truncated, viewKey: '', view: [] }
      } else {
        const header = all[0].map((h) => String(h).trim())
        let start = 1
        const isConstraintRow = (r: string[]) => r.some((c) => c.trim()) && r.every((c) => !c.trim() || /^\[.*\]$/.test(c.trim()))
        const isTypeRow = (r: string[]) => r.some((c) => c.trim()) && r.every((c) => !c.trim() || /^\{.*\}$/.test(c.trim()))
        if (all[start] && isConstraintRow(all[start])) start++
        if (all[start] && isTypeRow(all[start])) start++
        const columns = wanted.filter((k) => header.includes(k))
        const idx = columns.map((k) => header.indexOf(k))
        const rows = all.slice(start).map((r) => idx.map((i) => String(r[i] ?? '')))
        ctx.state.sampleCache = { key, columns, rows, truncated, viewKey: '', view: [] }
      }
    }
    const cache = ctx.state.sampleCache
    const viewKey = JSON.stringify([skipBlank === true, sortCol, sortDir])
    if (cache.viewKey !== viewKey) {
      let view = cache.rows
      // 고른 컬럼의 값이 모두 비었거나 0인 행은 뺀다.
      if (skipBlank === true) view = view.filter((r) => r.some((v) => v.trim() !== '' && !/^[-+]?0+(\.0+)?$/.test(v.trim())))
      const ci = cache.columns.indexOf(sortCol)
      if (ci >= 0) {
        // 값이 모두 숫자면 숫자 크기로, 아니면 글자 순서로 비교한다. 빈 값은 방향과 상관없이 맨 뒤에 둔다.
        const numeric = cache.rows.every((r) => r[ci].trim() === '' || !Number.isNaN(Number(r[ci])))
        const sign = sortDir === 'desc' ? -1 : 1
        view = [...view].sort((a, b) => {
          const x = a[ci].trim(), y = b[ci].trim()
          if (x === '' || y === '') return x === y ? 0 : x === '' ? 1 : -1
          const c = numeric ? Number(x) - Number(y) : x.localeCompare(y, 'ko', { numeric: true })
          return c * sign
        })
      }
      cache.view = view
      cache.viewKey = viewKey
    }
    return {
      ok: true,
      reason: '',
      columns: cache.columns,
      rows: cache.view.slice(from, from + take),
      total: cache.view.length,
      hasMore: from + take < cache.view.length,
      truncated: cache.truncated,
    }
  } catch {
    return fail('unreadable')
  }
}
// ── Key 노트 끝 ─────────────────────────────────────────────────────────────────


H['keyinfo:load'] = (ctx: Ctx, product: string | null) => {
  return loadKeyinfoData(getKeyinfoPath(ctx, product))
}

H['keyinfo:savePins'] = (ctx: Ctx, product: string | null, pins: unknown[]) => {
  const p = getKeyinfoPath(ctx, product)
  const data = loadKeyinfoData(p)
  data.pinnedColumns = pins as KeyinfoData['pinnedColumns']
  saveKeyinfoData(p, data)
}

H['keyinfo:saveLayout'] = (ctx: Ctx, product: string | null, pins: unknown[], folders: unknown[]) => {
  const p = getKeyinfoPath(ctx, product)
  const data = loadKeyinfoData(p)
  data.pinnedColumns = pins as KeyinfoData['pinnedColumns']
  data.folders = folders as KeyinfoFolder[]
  saveKeyinfoData(p, data)
}

// 강제 전체 재색인 — 이미 색인된 파일도 덮어씀
H['keyinfo:reindex'] = async (ctx: Ctx, product: string | null, fileSources: Record<string, { type: string; path?: string; localPath?: string }>) => {
  const p = getKeyinfoPath(ctx, product)
  const data = loadKeyinfoData(p)
  data.product = product

  const entries = Object.entries(fileSources)
  const total = entries.length
  if (total === 0) return data

  const sender = { send: ctx.emit }
  let done = 0
  sender.send('keyinfo:progress', { done, total })

  for (const [fileName, src] of entries) {
    const filePath = src.type === 'local' ? src.path : src.localPath
    if (filePath && fs.existsSync(filePath)) {
      try {
        const { columns, constraints, dbTypes } = parseCsvHeaderOnly(filePath)
        const entry: Record<string, KeyinfoColSchema> = {}
        for (const col of columns) {
          entry[col] = {
            ...(dbTypes[col] ? { dbType: dbTypes[col] } : {}),
            ...(constraints[col] ?? {}),
          }
        }
        data.schema[fileName] = entry
      } catch {}
    }
    done++
    sender.send('keyinfo:progress', { done, total })
  }

  saveKeyinfoData(p, data)
  return data
}

H['keyinfo:index'] = async (ctx: Ctx, product: string | null, fileSources: Record<string, { type: string; path?: string; localPath?: string }>) => {
  const p = getKeyinfoPath(ctx, product)
  const data = loadKeyinfoData(p)
  data.product = product

  const toIndex = Object.entries(fileSources).filter(([fileName]) => !data.schema[fileName])
  const total = toIndex.length

  if (total === 0) return data

  const sender = { send: ctx.emit }
  let done = 0
  sender.send('keyinfo:progress', { done, total })

  let changed = false
  for (const [fileName, src] of toIndex) {
    const filePath = src.type === 'local' ? src.path : src.localPath
    if (filePath && fs.existsSync(filePath)) {
      try {
        const { columns, constraints, dbTypes } = parseCsvHeaderOnly(filePath)
        const entry: Record<string, KeyinfoColSchema> = {}
        for (const col of columns) {
          entry[col] = {
            ...(dbTypes[col] ? { dbType: dbTypes[col] } : {}),
            ...(constraints[col] ?? {}),
          }
        }
        data.schema[fileName] = entry
        changed = true
      } catch {}
    }
    done++
    sender.send('keyinfo:progress', { done, total })
  }

  if (changed) saveKeyinfoData(p, data)
  return data
}
