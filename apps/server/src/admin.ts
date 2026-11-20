import { loadConfig } from './config'
import { DEFAULT_CODE_DAYS, generateCode, readAccess, revokeAccess, writeAccess } from './access'

// 관리 명령. 서버에서 실행한다. 데이터 폴더는 서버와 같은 환경 변수(TAGGER_DATA_DIR)로 정한다.
//   set-code [--days N]   새 입장 코드를 만든다 (이전 코드는 바로 못 쓴다). 코드는 이때 한 번만 보여 준다
//   status                코드가 있는지, 언제 만료되는지
//   revoke                코드를 지운다 (새 입장을 막는다. 이미 들어온 사람은 세션이 끝날 때까지 쓴다)
// 바뀐 코드는 서버를 다시 시작하지 않아도 다음 입장부터 적용된다.

function main(argv: string[]): number {
  const [command, ...rest] = argv
  let dataDir: string
  try {
    dataDir = loadConfig(process.env).server.dataDir
  } catch (e: unknown) {
    console.error(`설정 오류: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }

  if (command === 'set-code') {
    let days = DEFAULT_CODE_DAYS
    const i = rest.indexOf('--days')
    if (i >= 0) {
      days = Number(rest[i + 1])
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        console.error('--days 는 1~365 사이의 정수여야 합니다.')
        return 1
      }
    }
    const code = generateCode()
    const record = writeAccess(dataDir, code, days)
    console.log('새 입장 코드를 만들었습니다. 이 화면에서만 보여 줍니다. 안전한 곳에 적어 두세요.')
    console.log('')
    console.log(`  ${code}`)
    console.log('')
    console.log(`만료: ${record.expiresAt} (${days}일)`)
    return 0
  }

  if (command === 'status') {
    const r = readAccess(dataDir)
    if (!r) {
      console.log('입장 코드가 없습니다. (운영 모드 서버는 시작하지 않습니다)')
      return 0
    }
    const expired = Date.now() > Date.parse(r.expiresAt)
    console.log(`입장 코드: 있음 / 만든 때 ${r.createdAt} / 만료 ${r.expiresAt}${expired ? ' (만료됨)' : ''}`)
    return 0
  }

  if (command === 'revoke') {
    console.log(revokeAccess(dataDir) ? '입장 코드를 지웠습니다. 새 입장을 받지 않습니다.' : '지울 입장 코드가 없습니다.')
    return 0
  }

  console.log('사용법: admin <set-code [--days N] | status | revoke>')
  return command ? 1 : 0
}

process.exit(main(process.argv.slice(2)))
