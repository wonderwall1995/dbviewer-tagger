import path from 'path'
import fs from 'fs'
import type { Workspace } from './workspace'

// 사용자 한 명(데스크톱은 앱 하나, Web은 세션 하나)의 메모리 상태.
// 모듈 전역 변수로 두면 Web에서 모든 사용자가 같은 값을 쓰게 되므로 여기에 모은다.
// 덩어리를 core로 옮길 때마다 필요한 칸을 더한다.
export interface SessionState {
  // DB 내보내기 중단 요청. 한 사용자의 중단이 다른 사용자에게 번지지 않게 사용자마다 둔다.
  exportAborted: boolean
  // CSV 행·열 수 캐시 (core/csv.ts). loadedFrom은 이 캐시를 읽어 온 파일이다.
  csvStats: {
    memory: Map<string, { rows: number; columns: number; partial: boolean; missing?: boolean }>
    loadedFrom: string
    timer: ReturnType<typeof setTimeout> | null
  }
}

export function makeSessionState(): SessionState {
  return { exportAborted: false, csvStats: { memory: new Map(), loadedFrom: '', timer: null } }
}

export interface Ctx {
  ws: Workspace
  state: SessionState
  // 진행률 같은 알림을 화면으로 보낸다. 데스크톱은 IPC, Web은 SSE.
  emit: (channel: string, data: unknown) => void
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
