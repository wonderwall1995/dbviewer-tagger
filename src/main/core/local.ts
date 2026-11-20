import path from 'path'
import fs from 'fs'
import Papa from 'papaparse'
import { userPath } from './context'
import type { Ctx, Handlers } from './context'

// ── 프리셋 파일 경로 ──────────────────────────────────────────────────────────
// 프리셋 JSON에는 작업 폴더 안의 파일을 작업 폴더 기준 상대경로(예: DB-downloads/웹데모/public/a.csv)로 저장한다.
// 불러올 때는 현재 작업 폴더 기준 절대경로로 풀어서 화면에 넘긴다. 작업 폴더 밖의 파일은 절대경로 그대로 둔다.
export function toStoredPath(ctx: Ctx, p: string): string {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return p
  const rel = path.relative(ctx.ws.root, p)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return p
  return rel.split(path.sep).join('/')
}

export function fromStoredPath(ctx: Ctx, p: string): string {
  if (typeof p !== 'string' || p === '') return p
  if (!path.isAbsolute(p)) return path.resolve(ctx.ws.root, p)
  if (fs.existsSync(p)) return p
  // 예전 작업 폴더의 절대경로가 남은 경우: DB-downloads / S3-downloads 아래 같은 위치에 파일이 있으면 그것을 쓴다.
  const parts = p.split(/[\\/]+/)
  for (const root of ['DB-downloads', 'S3-downloads']) {
    const i = parts.lastIndexOf(root)
    if (i === -1) continue
    const candidate = path.join(ctx.ws.root, root, ...parts.slice(i + 1))
    if (fs.existsSync(candidate)) return candidate
  }
  return p
}

function mapPresetPaths<T>(data: T, convert: (p: string) => string): T {
  const sources = (data as { fileSources?: Record<string, unknown> } | null)?.fileSources
  if (!sources || typeof sources !== 'object') return data
  const next: Record<string, unknown> = {}
  for (const [name, src] of Object.entries(sources)) {
    const s = src as { type?: string; path?: string; localPath?: string } | null
    if (s?.type === 'local' && typeof s.path === 'string') next[name] = { ...s, path: convert(s.path) }
    else if (s?.type === 's3' && typeof s.localPath === 'string') next[name] = { ...s, localPath: convert(s.localPath) }
    else next[name] = src
  }
  return { ...data, fileSources: next }
}

// 로컬 CSV → S3-downloads/local-downloads/ 비동기 복사 (content 미반환)
export async function importToLocalDownloads(ctx: Ctx, sourcePath: string) {
  const filename = path.basename(sourcePath)
  const destDir = path.join(ctx.ws.root, 'S3-downloads', 'local-downloads')
  await fs.promises.mkdir(destDir, { recursive: true })
  const destPath = path.join(destDir, filename)
  await fs.promises.copyFile(sourcePath, destPath)
  return { name: filename, path: destPath }
}

// ── 다운로드 폴더 (S3-downloads / DB-downloads) ──────────────────────────────
export function getDownloadsRoot(ctx: Ctx, root: 's3' | 'db'): string {
  return root === 'db' ? ctx.ws.dbDownloadsRoot : ctx.ws.s3DownloadsRoot
}

export function withinDownloadsRoot(ctx: Ctx, target: string): boolean {
  const norm = path.resolve(target)
  const { s3DownloadsRoot, dbDownloadsRoot } = ctx.ws
  return (
    norm === s3DownloadsRoot || norm.startsWith(s3DownloadsRoot + path.sep) ||
    norm === dbDownloadsRoot || norm.startsWith(dbDownloadsRoot + path.sep)
  )
}

// 폴더 아래의 CSV를 폴더별로 묶어 돌려준다. segments는 저장 루트 기준의 폴더 경로이다.
// 하위 폴더는 3단계까지 찾는다. (DB 폴더 / 스키마 폴더 / CSV)
const CSV_TREE_MAX_DEPTH = 3

export const localHandlers: Handlers = {
  'sheet:saveSettings': (ctx, data: unknown) => {
    fs.mkdirSync(path.dirname(ctx.ws.sheetSettingsFile), { recursive: true })
    fs.writeFileSync(ctx.ws.sheetSettingsFile, JSON.stringify(data, null, 2), 'utf-8')
  },

  'sheet:loadSettings': (ctx) => {
    try {
      if (!fs.existsSync(ctx.ws.sheetSettingsFile)) return null
      return JSON.parse(fs.readFileSync(ctx.ws.sheetSettingsFile, 'utf-8'))
    } catch {
      return null
    }
  },

  // local.json — 트리 상태 저장
  'local:save': (ctx, data: unknown) => {
    const file = ctx.ws.localFile
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // 자동 저장은 마지막으로 보던 파일(activeFile)을 모른다. 이미 기록된 값이 있으면 그대로 이어 둔다.
    let next = data
    try {
      if (fs.existsSync(file) && data && typeof data === 'object' && !('activeFile' in data)) {
        const prev = JSON.parse(fs.readFileSync(file, 'utf-8'))
        if (typeof prev?.activeFile === 'string') next = { ...(data as object), activeFile: prev.activeFile }
      }
    } catch { /* 읽지 못하면 받은 내용 그대로 저장한다. */ }
    fs.writeFileSync(file, JSON.stringify(mapPresetPaths(next, (p) => toStoredPath(ctx, p)), null, 2), 'utf-8')
  },

  // 프리셋 JSON의 activeFile(마지막으로 보던 CSV)만 바꾼다. 다른 내용은 건드리지 않는다.
  'local:setActiveFile': (ctx, presetName: string, fileName: string | null) => {
    if (typeof presetName !== 'string' || presetName === '' || /[\\/]/.test(presetName)) return
    const target = path.join(ctx.ws.root, 'local', 'presets', presetName)
    try {
      if (!fs.existsSync(target)) return
      const json = JSON.parse(fs.readFileSync(target, 'utf-8'))
      if (fileName) json.activeFile = fileName
      else delete json.activeFile
      fs.writeFileSync(target, JSON.stringify(json, null, 2), 'utf-8')
    } catch { /* 기록하지 못해도 작업에는 영향이 없다. */ }
  },

  // local.json — 트리 상태 불러오기
  'local:load': (ctx) => {
    const file = ctx.ws.localFile
    try {
      if (!fs.existsSync(file)) {
        const empty = { folders: [], fileToFolder: {}, fileSources: {}, columnWidths: {}, pageSettings: {} }
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify(empty, null, 2), 'utf-8')
        return empty
      }
      return mapPresetPaths(JSON.parse(fs.readFileSync(file, 'utf-8')), (p) => fromStoredPath(ctx, p))
    } catch {
      return null
    }
  },

  // 이름 지정 저장 — 공란이면 local.json 덮어쓰기
  'local:savePreset': (ctx, name: string, data: unknown) => {
    const safeName = (name.trim().replace(/\.json$/i, '') || 'local') + '.json'
    const targetFile = path.join(ctx.ws.root, 'local', 'presets', safeName)
    fs.mkdirSync(path.dirname(targetFile), { recursive: true })
    fs.writeFileSync(targetFile, JSON.stringify(mapPresetPaths(data, (p) => toStoredPath(ctx, p)), null, 2), 'utf-8')
    return safeName
  },

  // 저장된 프리셋 목록 조회 (product 필드도 함께 반환)
  'local:listPresets': (ctx) => {
    const dir = path.join(ctx.ws.root, 'local', 'presets')
    try {
      if (!fs.existsSync(dir)) return []
      return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((name) => {
          const filePath = path.join(dir, name)
          const stat = fs.statSync(filePath)
          let product: string | undefined
          try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
            if (parsed?.product) product = parsed.product
          } catch {}
          return { name, mtime: stat.mtimeMs, product }
        })
        .sort((a, b) => b.mtime - a.mtime)
    } catch {
      return []
    }
  },

  // 특정 프리셋 불러오기
  'local:loadPreset': (ctx, name: string) => {
    const filePath = path.join(ctx.ws.root, 'local', 'presets', name)
    try {
      if (!fs.existsSync(filePath)) return null
      return mapPresetPaths(JSON.parse(fs.readFileSync(filePath, 'utf-8')), (p) => fromStoredPath(ctx, p))
    } catch {
      return null
    }
  },

  // 프리셋 삭제 — local.json은 삭제 불가
  'local:deletePreset': (ctx, name: string) => {
    if (name === 'local.json') return
    const filePath = path.join(ctx.ws.root, 'local', 'presets', name)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  },

  // 로컬 파일 내용 읽기 (on-demand, 비동기)
  'local:readFile': async (ctx, filePath: string) => {
    return await fs.promises.readFile(userPath(ctx, filePath), 'utf-8')
  },

  'local:getDownloadsPath': (ctx, root: 's3' | 'db' = 's3') => getDownloadsRoot(ctx, root),

  'local:listDownloads': async (ctx, root: 's3' | 'db', subPath?: string) => {
    const downloadsRoot = getDownloadsRoot(ctx, root)
    const target = subPath ? path.resolve(downloadsRoot, subPath) : downloadsRoot
    if (!withinDownloadsRoot(ctx, target)) return { folders: [], files: [] }
    if (!fs.existsSync(target)) return { folders: [], files: [] }
    const entries = fs.readdirSync(target, { withFileTypes: true })
    const folders = entries
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
    const files = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.csv'))
      .map((e) => {
        const fp = path.join(target, e.name)
        const stat = fs.statSync(fp)
        return { name: e.name, path: fp, mtime: stat.mtimeMs, size: stat.size }
      })
    return { folders, files }
  },

  'local:listCsvTree': (ctx, root: 's3' | 'db' = 'db', subPath = '') => {
    const downloadsRoot = getDownloadsRoot(ctx, root)
    const start = path.resolve(downloadsRoot, subPath)
    if (!withinDownloadsRoot(ctx, start) || !fs.existsSync(start)) return []

    const groups: Array<{ segments: string[]; files: Array<{ name: string; path: string }> }> = []
    const walk = (dir: string, depth: number) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const files = entries
        .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.csv'))
        .map((e) => ({ name: e.name, path: path.join(dir, e.name) }))
      if (files.length > 0) {
        const rel = path.relative(downloadsRoot, dir)
        groups.push({ segments: rel === '' ? [] : rel.split(path.sep), files })
      }
      if (depth >= CSV_TREE_MAX_DEPTH) return
      for (const e of entries) {
        if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1)
      }
    }
    walk(start, 0)
    return groups
  },

  'local:deleteDownload': async (ctx, absolutePath: string) => {
    if (!withinDownloadsRoot(ctx, absolutePath)) throw new Error('Invalid path')
    if (!fs.existsSync(absolutePath)) return
    fs.rmSync(absolutePath, { recursive: true, force: true })
  },

  'local:eraseColumn': async (ctx, filePath: string, colKey: string) => {
    const file = userPath(ctx, filePath)
    const raw = await fs.promises.readFile(file, 'utf-8')
    const lineEnding = raw.includes('\r\n') ? '\r\n' : '\n'
    const result = Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: 'greedy' })
    if (!result.meta.fields?.includes(colKey)) throw new Error(`Column "${colKey}" not found`)
    const newFields = result.meta.fields.filter((f) => f !== colKey)
    const newRows = result.data.map((row) => {
      const r: Record<string, string> = {}
      for (const f of newFields) r[f] = row[f] ?? ''
      return r
    })
    const csv = Papa.unparse({ fields: newFields, data: newRows }, { newline: lineEnding })
    await fs.promises.writeFile(file, csv, 'utf-8')
  },
}
