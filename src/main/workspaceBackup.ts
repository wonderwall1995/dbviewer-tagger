import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const SCOPES = ['local', 'docs/keyinfo', 'docs/lorebook'] as const
type BackupScope = typeof SCOPES[number]
export interface BackupMeta {
  id: string
  title: string
  comment: string
  date: string
  version?: number
  scopes?: BackupScope[]
}

// 삭제나 이동 전에 대상이 작업 폴더 안에 있는지 확인한다.
function inside(root: string, target: string): string {
  const base = path.resolve(root)
  const resolved = path.resolve(target)
  const relative = path.relative(base, resolved)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('백업 경로가 올바르지 않습니다')
  }
  let current = base
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error('백업 대상에 연결된 폴더나 파일이 있습니다')
    }
  }
  return resolved
}

function copyDirectory(source: string, target: string): void {
  const stat = fs.lstatSync(source)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('백업 대상이 일반 폴더가 아닙니다')
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isSymbolicLink()) throw new Error('백업 대상에 연결된 폴더나 파일이 있습니다')
    if (entry.isDirectory()) copyDirectory(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to)
    else throw new Error('백업할 수 없는 파일이 있습니다')
  }
}

export function backupDirectory(root: string, id: string): string {
  if (!/^backup_[A-Za-z0-9_-]+$/.test(id)) throw new Error('백업 ID가 올바르지 않습니다')
  return inside(root, path.join(root, 'backups', id))
}

export function saveWorkspaceBackup(root: string, title: string, comment: string): BackupMeta {
  const id = `backup_${Date.now()}_${crypto.randomUUID()}`
  const finalDir = backupDirectory(root, id)
  const staging = inside(root, path.join(root, 'backups', `.saving-${crypto.randomUUID()}`))
  fs.mkdirSync(staging, { recursive: true })
  try {
    for (const scope of SCOPES) {
      const source = inside(root, path.join(root, scope))
      const target = path.join(staging, scope)
      if (fs.existsSync(source)) copyDirectory(source, target)
      else fs.mkdirSync(target, { recursive: true })
    }
    const meta: BackupMeta = {
      id, title: title.trim() || '백업', comment: comment.trim(), date: new Date().toISOString(),
      version: 2, scopes: [...SCOPES],
    }
    fs.writeFileSync(path.join(staging, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
    fs.renameSync(staging, finalDir)
    return meta
  } finally {
    fs.rmSync(inside(root, staging), { recursive: true, force: true })
  }
}

export function restoreWorkspaceBackup(root: string, id: string): void {
  const source = backupDirectory(root, id)
  const meta: BackupMeta = JSON.parse(fs.readFileSync(inside(root, path.join(source, 'meta.json')), 'utf8'))
  let scopes: readonly BackupScope[]
  if (meta.version === 2) {
    if (!Array.isArray(meta.scopes) || meta.scopes.length !== SCOPES.length || !SCOPES.every(s => meta.scopes?.includes(s))) {
      throw new Error('백업 범위 정보가 올바르지 않습니다')
    }
    scopes = SCOPES
  } else if (meta.version === undefined) {
    // 예전 백업에 없는 Keyinfo와 Lorebook은 현재 상태를 유지한다.
    scopes = SCOPES.filter(s => fs.existsSync(inside(root, path.join(source, s))))
    if (!scopes.includes('local')) throw new Error('Local 백업이 없습니다')
  } else {
    throw new Error('지원하지 않는 백업 형식입니다')
  }
  const staging = inside(root, path.join(root, `.restoring-${crypto.randomUUID()}`))
  const moved: Array<{ live: string; previous: string; installed: boolean }> = []
  fs.mkdirSync(staging, { recursive: true })
  let retainPrevious = false
  try {
    // 모든 사본을 준비한 뒤 현재 데이터를 교체한다.
    for (const scope of scopes) {
      const from = inside(root, path.join(source, scope))
      inside(root, path.join(root, scope))
      copyDirectory(from, path.join(staging, 'next', scope))
    }
    try {
      for (const scope of scopes) {
        const live = inside(root, path.join(root, scope))
        const previous = inside(root, path.join(staging, 'previous', scope))
        fs.mkdirSync(path.dirname(live), { recursive: true })
        const item = { live, previous, installed: false }
        if (fs.existsSync(live)) {
          fs.mkdirSync(path.dirname(previous), { recursive: true })
          fs.renameSync(live, previous)
        }
        moved.push(item)
        fs.renameSync(inside(root, path.join(staging, 'next', scope)), live)
        item.installed = true
      }
    } catch (error) {
      try {
        for (const item of moved.reverse()) {
          if (item.installed) fs.rmSync(inside(root, item.live), { recursive: true, force: true })
          if (fs.existsSync(item.previous)) fs.renameSync(inside(root, item.previous), inside(root, item.live))
        }
      } catch {
        retainPrevious = true
        throw new Error('복원이 중단됐습니다. 작업 폴더의 .restoring- 폴더에 이전 데이터를 보관했습니다')
      }
      throw error
    }
  } finally {
    if (!retainPrevious) fs.rmSync(inside(root, staging), { recursive: true, force: true })
  }
}
