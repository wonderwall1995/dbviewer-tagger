import path from 'path'
import type { ServerOptions } from './server'

// 환경 변수 → 서버 설정. 값이 잘못되면 throw해서 서버를 시작하지 않는다.
//   TAGGER_PORT               API 포트 (기본 6201). 127.0.0.1에만 묶는다
//   TAGGER_DATA_DIR           세션 폴더를 둘 폴더 (운영: 절대 경로 필수)
//   TAGGER_SAMPLE_DIR         새 세션에 복사할 견본 작업 폴더 (선택)
//   TAGGER_MAX_SESSIONS       동시 세션 수 (기본 10)
//   TAGGER_SESSION_MB         세션당 디스크 (기본 200)
//   TAGGER_SESSION_IDLE_HOURS 쓰지 않는 세션을 지우기까지 (기본 24)
//   TAGGER_UPLOAD_MB          업로드 한 개 상한 (기본 20)
//   NODE_ENV                  운영은 production. 이때 쿠키에 Secure를 붙인다 (HTTPS 뒤에서만 동작)
export interface TaggerConfig {
  port: number
  production: boolean
  server: ServerOptions & { secureCookie: boolean }
}

function intEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} 값이 올바르지 않습니다. (${min}~${max})`)
  return n
}

export function loadConfig(env: NodeJS.ProcessEnv, cwd = process.cwd()): TaggerConfig {
  const production = env.NODE_ENV === 'production'
  const port = intEnv(env, 'TAGGER_PORT', 6201, 1024, 65535)
  const rawData = env.TAGGER_DATA_DIR
  if (production && (!rawData || !path.isAbsolute(rawData))) {
    throw new Error('운영 모드에서는 TAGGER_DATA_DIR을 절대 경로로 정해야 합니다.')
  }
  const dataDir = path.resolve(cwd, rawData || path.join('local', 'web-data'))
  const sampleDir = env.TAGGER_SAMPLE_DIR ? path.resolve(cwd, env.TAGGER_SAMPLE_DIR) : undefined
  const MB = 1024 * 1024
  return {
    port,
    production,
    server: {
      dataDir,
      sampleDir,
      maxSessions: intEnv(env, 'TAGGER_MAX_SESSIONS', 10, 1, 200),
      sessionDiskBytes: intEnv(env, 'TAGGER_SESSION_MB', 200, 10, 10_000) * MB,
      sessionIdleMs: intEnv(env, 'TAGGER_SESSION_IDLE_HOURS', 24, 1, 24 * 14) * 60 * 60 * 1000,
      maxUploadBytes: intEnv(env, 'TAGGER_UPLOAD_MB', 20, 1, 500) * MB,
      secureCookie: production,
    },
  }
}
