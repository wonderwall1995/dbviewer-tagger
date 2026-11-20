import fs from 'fs'

// 본문과 나머지 메타데이터는 그대로 비교한다. 생성 시각만 비교에서 뺀다.
function withoutGenerated(content: string): string | null {
  if (!content.startsWith('---\n')) return null
  const end = content.indexOf('\n---\n', 4)
  if (end < 0) return null
  const header = content.slice(0, end + 1)
  const fields = [...header.matchAll(/^generated: (.+)\n/gm)]
  if (fields.length !== 1) return null
  try {
    const timestamp = JSON.parse(fields[0][1])
    if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) return null
  } catch { return null }
  return header.replace(/^generated: .+\n/m, '') + content.slice(end + 1)
}

export function writeCedIndex(filePath: string, content: string): void {
  const next = withoutGenerated(content)
  try {
    const previous = fs.readFileSync(filePath, 'utf8')
    if (next !== null && withoutGenerated(previous) === next) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  fs.writeFileSync(filePath, content, 'utf8')
}
