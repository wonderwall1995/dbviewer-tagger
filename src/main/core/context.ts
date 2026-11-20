import path from 'path'
import fs from 'fs'
import type { Workspace } from './workspace'
import type { DbSlots, SshConfig } from './db'
import type { SampleCache } from './keyinfo'

// 사용자 한 명(데스크톱은 앱 하나, Web은 세션 하나)의 메모리 상태.
// 모듈 전역 변수로 두면 Web에서 모든 사용자가 같은 값을 쓰게 되므로 여기에 모은다.
// 덩어리를 core로 옮길 때마다 필요한 칸을 더한다.
export interface SessionState {
  // DB 내보내기 중단 요청. 한 사용자의 중단이 다른 사용자에게 번지지 않게 사용자마다 둔다.
  exportAborted: boolean
  // CSV 행·열 수 캐시 (core/csv.ts). loadedFrom은 이 캐시를 읽어 온 파일이다.
  // 옛 연관 그룹을 Key 노트로 옮긴 Keyinfo 폴더. 같은 폴더는 한 번만 옮긴다. (core/keyinfo.ts)
  keyNoteMigratedFor: string
  // Key 노트 표본 행 캐시. 마지막 한 파일만 둔다. (core/keyinfo.ts)
  sampleCache: SampleCache
  csvStats: {
    memory: Map<string, { rows: number; columns: number; partial: boolean; missing?: boolean }>
    loadedFrom: string
    timer: ReturnType<typeof setTimeout> | null
  }
}

export function makeSessionState(): SessionState {
  return { exportAborted: false, keyNoteMigratedFor: '', sampleCache: null, csvStats: { memory: new Map(), loadedFrom: '', timer: null } }
}

export interface Ctx {
  ws: Workspace
  state: SessionState
  // 진행률 같은 알림을 화면으로 보낸다. 데스크톱은 IPC, Web은 SSE.
  emit: (channel: string, data: unknown) => void
  // DB 슬롯 저장소. 데스크톱은 암호화 파일, Web은 세션 메모리.
  slots: { load(): DbSlots; save(slots: DbSlots): void }
  // CED 'Local 저장' 폴더. 데스크톱은 사용자가 정한 폴더, Web은 작업 폴더의 CED/.
  cedDir: () => string
  // SSH 터널. 데스크톱만 있다. 없으면 SSH를 쓰는 슬롯은 연결하지 않는다.
  tunnel?: { open(key: string, ssh: SshConfig, host: string, port: number): Promise<number>; close(key: string): void }
  // true면 작업 폴더 밖의 경로도 받는다 (데스크톱: 사용자 PC의 파일). Web은 false.
  allowOutsidePaths: boolean
}

// 화면에서 받은 파일 경로를 확인한다.
// allowOutsidePaths가 false이면 작업 폴더 안의 경로만 받는다. 심볼릭 링크로 밖을 가리키는 경우도 거절한다.
export function userPath(ctx: Ctx, p: unknown): string {
  if (typeof p !== 'string' || p === '') throw new Error('경로가 올바르지 않습니다.')
  if (ctx.allowOutsidePaths) return p
  return resolveInside(ctx.ws.root, p)
}

// 폴더나 파일 이름 한 칸으로 쓰는 이름(제품, 프리셋 등)을 확인한다.
// 경로 구분자, '.', '..', 제어 문자가 있으면 거절한다. 그래야 이름으로 다른 폴더를 가리킬 수 없다.
export function checkName(name: unknown, label = '이름'): string {
  if (typeof name !== 'string') throw new Error(`${label}이(가) 올바르지 않습니다.`)
  const s = name.trim()
  // eslint-disable-next-line no-control-regex
  if (s === '' || s === '.' || s === '..' || /[\\/\u0000-\u001f]/.test(s) || s.length > 120) {
    throw new Error(`${label}이(가) 올바르지 않습니다.`)
  }
  return s
}

// 경로가 실제로 쓸 수 있는 파일이면 그 경로를, 아니면 null을 돌려준다. (경로 정책을 어기는 경우 포함)
export function tryUserPath(ctx: Ctx, p: unknown): string | null {
  try { return userPath(ctx, p) } catch { return null }
}

export function resolveInside(root: string, p: string): string {
  const base = path.resolve(root)
  const target = path.resolve(base, p)
  if (!isInside(base, target)) throw new Error('작업 폴더 밖의 경로입니다.')
  // 이미 있는 경로는 실제 위치(심볼릭 링크를 푼 위치)도 확인한다. 없는 경로는 가장 가까운 있는 부모를 확인한다.
  let probe = target
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe)
  if (fs.existsSync(base) && fs.existsSync(probe)) {
    const realBase = fs.realpathSync(base)
    if (!isInside(realBase, fs.realpathSync(probe))) throw new Error('작업 폴더 밖의 경로입니다.')
  }
  return target
}

function isInside(base: string, target: string): boolean {
  const rel = path.relative(base, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// 채널 이름 → 처리 함수. 데스크톱은 IPC에, Web은 HTTP에 같은 표를 연결한다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handlers = Record<string, (ctx: Ctx, ...args: any[]) => unknown>
