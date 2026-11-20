// Web 견본 작업 폴더(samples/workspace)를 이 PC의 작업 폴더(저장소 루트)에서 만든다.
//   node scripts/make-samples.cjs
// 서버의 deploy/server-up.sh 가 samples/workspace 를 /var/lib/tagger/sample 로 옮기고,
// 면접관이 들어올 때마다 그 복사본으로 시작한다.
// 들어가는 것: 웹데모 CSV, 제품 rwa(목록·순서), rwa의 Keyinfo와 Key 노트, 기본 시트 하나(rwa 사이드바 상태).
// 넣지 않는 것: CED(Local 저장으로 그때 만든다), 다른 시트, 캐시, 로그, 백업.
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'samples', 'workspace')
const CSV_DIR = path.join('DB-downloads', '웹데모', 'public')
const PRODUCT = 'rwa'
// 기본 시트로 쓸 프리셋 (rwa 제품과 웹데모 CSV가 연결된 시트)
const SOURCE_PRESET = 'A.json'

function copy(rel, toRel = rel) {
  const from = path.join(ROOT, rel)
  const to = path.join(OUT, toRel)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
}

function writeJson(rel, data) {
  const to = path.join(OUT, rel)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.writeFileSync(to, JSON.stringify(data, null, 2) + '\n', 'utf-8')
}

fs.rmSync(OUT, { recursive: true, force: true })

// 1. CSV (전부 자동화 시험이 만든 가짜 데이터)
for (const f of fs.readdirSync(path.join(ROOT, CSV_DIR)).filter((n) => n.endsWith('.csv'))) {
  copy(path.join(CSV_DIR, f))
}

// 1-1. 전화번호는 무작위로 만든 값이라도 실제 누군가의 번호와 같을 수 있다. 누가 봐도 가짜인 번호로 바꾼다.
//      (1행 머리글, 2행 제약, 3행 타입은 그대로 둔다)
{
  const Papa = require('papaparse')
  const file = path.join(OUT, CSV_DIR, 'users.csv')
  const raw = fs.readFileSync(file, 'utf-8')
  const rows = Papa.parse(raw, { skipEmptyLines: true }).data
  const col = rows[0].indexOf('phoneNumber')
  if (col >= 0) {
    rows.slice(3).forEach((r, i) => { if (r[col]) r[col] = `010-0000-${String(i + 1).padStart(4, '0')}` })
  }
  fs.writeFileSync(file, Papa.unparse(rows, { newline: '\n' }) + '\n', 'utf-8')
}

// 2. 제품
copy(path.join('local', 'product', `${PRODUCT}.json`))
writeJson(path.join('local', 'product', 'configure', 'config.json'), { order: [PRODUCT] })

// 3. Keyinfo와 Key 노트
copy(path.join('docs', 'keyinfo', PRODUCT, 'keyinfo.json'))
copy(path.join('docs', 'keyinfo', PRODUCT, 'keynotes.json'))

// 4. 기본 시트 하나: SOURCE_PRESET의 내용을 local.json으로 쓴다. 마지막으로 보던 파일 기록은 뺀다.
const preset = JSON.parse(fs.readFileSync(path.join(ROOT, 'local', 'presets', SOURCE_PRESET), 'utf-8'))
delete preset.activeFile
for (const src of Object.values(preset.fileSources ?? {})) {
  const p = src.path ?? src.localPath
  if (typeof p === 'string' && (path.isAbsolute(p) || /^[A-Za-z]:/.test(p))) {
    throw new Error(`프리셋에 이 PC의 절대 경로가 있습니다: ${p}`)
  }
}
writeJson(path.join('local', 'presets', 'local.json'), preset)
writeJson(path.join('local', 'presets', 'sheet-settings.json'), {
  sheets: [{ id: 'default', name: 'default', isDefault: true, jsonFile: 'local.json' }],
  activeSheet: 'default',
})

const files = []
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(OUT, p)) } }
walk(OUT)
console.log(`samples/workspace: ${files.length}개 파일`)
for (const f of files) console.log('  ' + f.split(path.sep).join('/'))
