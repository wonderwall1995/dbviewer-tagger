// Web 견본 작업 폴더(samples/workspace)를 이 PC의 작업 폴더(저장소 루트)에서 만든다.
//   node scripts/make-samples.cjs
// 서버의 deploy/server-up.sh 가 samples/workspace 를 /var/lib/tagger/sample 로 옮기고,
// 면접관이 들어올 때마다 그 복사본으로 시작한다.
// 들어가는 것: 웹데모 CSV(스키마 폴더 전부), 제품 rwa(목록·순서), rwa의 Keyinfo와 Key 노트, 기본 시트 하나(rwa 사이드바 상태).
// 넣지 않는 것: CED(Local 저장으로 그때 만든다), 다른 시트, 캐시, 로그, 백업.
const fs = require('fs')
const path = require('path')

const Papa = require('papaparse')
const { maskCsvRows } = require('./sample-mask.cjs')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'samples', 'workspace')
const DB_DIR = path.join('DB-downloads', '웹데모')
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

// 1. CSV: 웹데모 아래의 스키마 폴더를 모두 넣는다.
//    비밀번호, 전화번호, 토큰 해시는 가린다 (sample-mask.cjs). 저장소가 공개라서 화면이 아니라 파일의 값 자체를 바꾼다.
//    (1행 머리글, 2행 제약, 3행 타입은 그대로 둔다)
const csvFiles = []
const schemas = fs.readdirSync(path.join(ROOT, DB_DIR), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
for (const schema of schemas) {
  for (const name of fs.readdirSync(path.join(ROOT, DB_DIR, schema)).filter((n) => n.endsWith('.csv')).sort()) {
    const rel = path.join(DB_DIR, schema, name)
    csvFiles.push({ schema, name, path: rel.split(path.sep).join('/') })
    copy(rel)
    const rows = Papa.parse(fs.readFileSync(path.join(OUT, rel), 'utf-8'), { skipEmptyLines: true }).data
    if (maskCsvRows(rows)) fs.writeFileSync(path.join(OUT, rel), Papa.unparse(rows, { newline: '\n' }) + '\n', 'utf-8')
  }
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
// 프리셋에 없는 CSV는 사이드바에 더한다. 폴더 이름과 파일 이름은 앱의 "Local → 불러오기"와 같은 방식이다.
preset.folders ??= []
preset.fileToFolder ??= {}
preset.fileSources ??= {}
const registered = new Set(Object.values(preset.fileSources).map((src) => src.path))
for (const csv of csvFiles) {
  if (registered.has(csv.path)) continue
  const folderName = `웹데모.${csv.schema}`
  let folder = preset.folders.find((f) => f.name === folderName)
  if (!folder) {
    folder = { id: `sample-${csv.schema}`, name: folderName, expanded: true }
    preset.folders.push(folder)
  }
  const name = preset.fileSources[csv.name] ? `${csv.schema}.${csv.name}` : csv.name
  if (preset.fileSources[name]) throw new Error(`사이드바 이름이 겹칩니다: ${name}`)
  preset.fileSources[name] = { type: 'local', path: csv.path }
  preset.fileToFolder[name] = folder.id
}
// 사이드바에 있는데 견본에 파일이 없으면 면접관 화면에 "실종"으로 보인다. 만들다가 멈춘다.
for (const [name, src] of Object.entries(preset.fileSources)) {
  if (!csvFiles.some((csv) => csv.path === src.path)) throw new Error(`프리셋의 파일이 견본에 없습니다: ${name}`)
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
