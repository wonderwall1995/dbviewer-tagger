import { toast } from 'sonner'
import { createHttpApi } from './platform/httpApi'

// 화면은 이 모듈의 api만 부른다. window.electronAPI를 직접 부르지 않는다.
// 데스크톱(Electron)은 preload가 window.electronAPI를 넣어 준다. 없으면 Web으로 보고 HTTP 구현을 쓴다.
// 그래서 화면 빌드 하나를 데스크톱과 Web이 같이 쓴다.
export const isDesktop = typeof window !== 'undefined' && !!window.electronAPI

export const api: TaggerApi = isDesktop ? window.electronAPI : createHttpApi()

// 이 환경에서 되는 기능. 화면은 이 값을 보고 버튼을 보이거나 숨긴다.
export interface Capabilities {
  // 작업 폴더를 고르고 바꾸기
  workspace: boolean
  // 폴더를 운영체제의 파일 탐색기로 열기
  revealInOs: boolean
  // Hermes 연결과 CED를 볼트로 보내기
  hermes: boolean
  // SSH 터널로 DB에 연결하기
  ssh: boolean
}

export const caps: Capabilities = isDesktop
  ? { workspace: true, revealInOs: true, hermes: true, ssh: true }
  : { workspace: false, revealInOs: false, hermes: false, ssh: false }

// Web(시연)에서 기능만 막은 버튼이 부르는 도우미. 창과 버튼은 그대로 보여 주고, 누르면 이 안내만 띄운다.
// 막았으면 true를 돌려준다. 데스크톱은 늘 false (그대로 동작).
export const DEMO_BLOCKED_TEXT = 'Web 시연용이기에 기능이 없습니다.'
export function demoBlocked(): boolean {
  if (isDesktop) return false
  toast.info(DEMO_BLOCKED_TEXT)
  return true
}
