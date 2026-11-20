import fs from 'fs'
import path from 'path'
import { checkName } from './context'
import type { Ctx, Handlers } from './context'

const H: Handlers = {}
export const lorebookHandlers = H

// ── Lorebook (docs/lorebook/) ─────────────────────────────────────────────────

function withinLorebookRoot(ctx: Ctx, target: string): boolean {
  const norm = path.resolve(target)
  return norm === ctx.ws.lorebookRoot || norm.startsWith(ctx.ws.lorebookRoot + path.sep)
}

// lorebook:list — lorebook 루트 내 모든 .json 파일 목록 (재귀)
H['lorebook:list'] = async (ctx: Ctx) => {
  if (!fs.existsSync(ctx.ws.lorebookRoot)) return []
  const results: { name: string; path: string; folder: string }[] = []
  const walk = (dir: string, folder: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, folder ? `${folder}/${e.name}` : e.name)
      } else if (e.isFile() && e.name.endsWith('.json')) {
        results.push({ name: e.name.replace(/\.json$/, ''), path: full, folder })
      }
    }
  }
  walk(ctx.ws.lorebookRoot, '')
  return results
}

// lorebook:read — 파일 내용 반환
H['lorebook:read'] = async (ctx: Ctx, absPath: string) => {
  if (!withinLorebookRoot(ctx, absPath)) throw new Error('경로 오류')
  return fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : ''
}

// lorebook:write — 파일 생성/수정 (중간 폴더 자동 생성)
H['lorebook:write'] = async (ctx: Ctx, absPath: string, content: string) => {
  if (!withinLorebookRoot(ctx, absPath)) throw new Error('경로 오류')
  await fs.promises.mkdir(path.dirname(absPath), { recursive: true })
  await fs.promises.writeFile(absPath, content, 'utf-8')
}

// lorebook:delete — 파일 삭제
H['lorebook:delete'] = async (ctx: Ctx, absPath: string) => {
  if (!withinLorebookRoot(ctx, absPath)) throw new Error('경로 오류')
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath)
}

// lorebook:newPath — {product}/{csvName}_{colLabel}.json 경로 생성
H['lorebook:newPath'] = (ctx: Ctx, product: string, csvName: string, colLabel: string) => {
  const safeCsv = csvName.replace(/\.csv$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'file'
  const safeCol = colLabel.replace(/[\\/:*?"<>|]/g, '_').trim() || 'col'
  const dir = product ? path.join(ctx.ws.lorebookRoot, checkName(product, '제품 이름')) : ctx.ws.lorebookRoot
  return path.join(dir, `${safeCsv}_${safeCol}.json`)
}

// lorebook:getColumnComments — CSV 파일명 기준으로 색인된 칼럼의 주석 반환
H['lorebook:getColumnComments'] = (ctx: Ctx, csvName: string) => {
  const result: Record<string, string> = {}
  if (!fs.existsSync(ctx.ws.lorebookRoot)) return result
  const csvBase = csvName.replace(/\.csv$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim()
  try {
    const entries = fs.readdirSync(ctx.ws.lorebookRoot, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const productDir = path.join(ctx.ws.lorebookRoot, e.name)
      const files = fs.readdirSync(productDir, { withFileTypes: true })
        .filter(f => f.isFile() && f.name.endsWith('.json') && f.name.startsWith(`${csvBase}_`))
      for (const f of files) {
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(productDir, f.name), 'utf-8'))
          if (raw.column && typeof raw.comment === 'string') {
            result[raw.column] = raw.comment
          }
        } catch { /* skip corrupt files */ }
      }
    }
  } catch { /* ignore */ }
  return result
}

// product:* — 제품 폴더 목록 (local/product/{name}.json 파일 기반)
// 제 3자 프로그램에서도 이 디렉토리를 읽어 제품 목록을 파악할 수 있음

function ensureProductRoot(ctx: Ctx) {
  if (!fs.existsSync(ctx.ws.productRoot)) fs.mkdirSync(ctx.ws.productRoot, { recursive: true })
}

export function listProductNames(ctx: Ctx): string[] {
  if (!fs.existsSync(ctx.ws.productRoot)) return []
  return fs.readdirSync(ctx.ws.productRoot)
    .filter(f => f.endsWith('.json'))
    .map(f => f.slice(0, -5))
    .sort()
}

// lorebook:getCategories — local/product/*.json 열거로 목록 반환
H['lorebook:getCategories'] = (ctx: Ctx) => {
  return listProductNames(ctx)
}

// product:loadConfig / saveConfig — 순서 등 설정을 local/product/configure/config.json에 저장
H['product:loadConfig'] = (ctx: Ctx) => {
  try {
    if (!fs.existsSync(ctx.ws.productConfigFile)) return {}
    return JSON.parse(fs.readFileSync(ctx.ws.productConfigFile, 'utf-8'))
  } catch { return {} }
}

H['product:saveConfig'] = (ctx: Ctx, data: unknown) => {
  if (!fs.existsSync(ctx.ws.productConfigDir)) fs.mkdirSync(ctx.ws.productConfigDir, { recursive: true })
  fs.writeFileSync(ctx.ws.productConfigFile, JSON.stringify(data, null, 2), 'utf-8')
}

// lorebook:setCategories — 배열과 파일 시스템을 reconcile
// 추가된 이름 → 새 .json 생성, 제거된 이름 → .json 삭제 (내용 보존 아님)
H['lorebook:setCategories'] = (ctx: Ctx, cats: string[]) => {
  ensureProductRoot(ctx)
  const existing = new Set(listProductNames(ctx))
  // 제품 이름은 파일 이름이 된다. 하나라도 올바르지 않으면 아무것도 바꾸지 않는다.
  if (!Array.isArray(cats)) throw new Error('제품 목록이 올바르지 않습니다.')
  cats = cats.map((c) => checkName(c, '제품 이름'))
  const next = new Set(cats)

  for (const name of existing) {
    if (!next.has(name)) fs.unlinkSync(path.join(ctx.ws.productRoot, `${name}.json`))
  }
  for (const name of cats) {
    if (!existing.has(name)) fs.writeFileSync(path.join(ctx.ws.productRoot, `${name}.json`), '{}', 'utf-8')
  }
}

