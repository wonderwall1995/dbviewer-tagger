import Papa from 'papaparse'
import type { ParsedCsv, ColumnMeta, InferredType, DbConstraints } from '@tagger/shared'

function inferType(samples: string[]): InferredType {
  const nonEmpty = samples.filter((v) => v !== '' && v !== null && v !== undefined)
  if (nonEmpty.length === 0) return 'unknown'

  const checks: [InferredType, (v: string) => boolean][] = [
    ['id',      (v) => /^[A-Z0-9-_]{4,}$/i.test(v)],
    ['phone',   (v) => /^[\d\s\-\+\(\)]{7,15}$/.test(v)],
    ['email',   (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)],
    ['date',    (v) => !isNaN(Date.parse(v)) && /\d{4}/.test(v)],
    ['boolean', (v) => /^(true|false|yes|no|y|n|1|0|예|아니오)$/i.test(v)],
    ['number',  (v) => !isNaN(Number(v.replace(/,/g, '')))],
  ]

  for (const [type, check] of checks) {
    if (nonEmpty.slice(0, 20).every(check)) return type
  }

  return 'text'
}

function inferTypeFromName(key: string): InferredType {
  const k = key.toLowerCase()
  if (/^id$|[_-]id$|^id[_-]/.test(k)) return 'id'
  if (/phone|tel|mobile|휴대|전화/.test(k)) return 'phone'
  if (/email|mail/.test(k)) return 'email'
  if (/date|datetime|_at$|at$|time|created|updated|deleted|start|end|expire/.test(k)) return 'date'
  if (/visible|enabled|active|deleted|flag|bool|^is[_A-Z]|^has[_A-Z]|yn$/.test(k)) return 'boolean'
  if (/count|amount|price|total|score|rate|rank|order|num|qty|quantity|age|size/.test(k)) return 'number'
  return 'text'
}

// 공식 타입명 폴백 — DB 타입도 없고 샘플도 없을 때 컬럼명으로 유추
function officialTypeFromName(key: string): string {
  const k = key.toLowerCase()
  if (/^id$|[_-]id$|^id[_-]/.test(k)) return 'integer'
  if (/phone|tel|mobile/.test(k)) return 'string'
  if (/email|mail/.test(k)) return 'string'
  if (/date|datetime|_at$|at$|time|created|updated|deleted|start|end|expire/.test(k)) return 'timestamp'
  if (/visible|enabled|active|deleted|flag|^is[_a-z]|^has[_a-z]|yn$/.test(k)) return 'boolean'
  if (/count|amount|price|total|score|rate|rank|num|qty|quantity|age/.test(k)) return 'integer'
  return 'string'
}

const CONSTRAINT_CELL_RE = /^\[.*\]$/
const TYPE_CELL_RE = /^\{.*\}$/

function isConstraintRow(row: Record<string, string>): boolean {
  const vals = Object.values(row).filter(v => v.trim() !== '')
  return vals.length > 0 && vals.every(v => CONSTRAINT_CELL_RE.test(v.trim()))
}

function parseConstraintCell(cell: string): DbConstraints {
  const inner = cell.trim().slice(1, -1)
  const c: DbConstraints = {}
  for (const part of inner.split('|')) {
    if (part === 'PK') c.isPK = true
    else if (part === 'UQ') c.isUnique = true
    else if (part === 'NN') c.isNotNull = true
    else if (part.startsWith('FK→')) { c.isFK = true; c.fkRef = part.slice(3) }
    else if (part.startsWith('REF←')) c.backrefs = part.slice(4).split(',')
  }
  return c
}

// 제약 행과 타입 행은 이 도구가 DB에서 내보낸 CSV(DB-downloads 아래)에만 있다. allowMeta가 false면 찾지 않는다.
// (일반 CSV의 첫 데이터 행이 {..} 나 [..] 모양이면 메타 행으로 오인해 빠지던 문제를 막는다)
export function isDbExportPath(filePath: string | null | undefined): boolean {
  return !!filePath && /(^|[\\/])DB-downloads[\\/]/.test(filePath)
}

export function parseCsvContent(fileName: string, content: string, allowMeta = true): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  })

  const fields = result.meta.fields ?? []
  let rows = result.data

  // 제약 행([PK], [FK→...]) 분리
  let constraintMap: Map<string, DbConstraints> | null = null
  if (allowMeta && rows.length > 0 && isConstraintRow(rows[0])) {
    constraintMap = new Map()
    for (const [key, val] of Object.entries(rows[0])) {
      if (val.trim() && CONSTRAINT_CELL_RE.test(val.trim())) {
        constraintMap.set(key, parseConstraintCell(val.trim()))
      }
    }
    rows = rows.slice(1)
  }

  // 타입 행({integer}, {varchar} 등) 분리
  let typeMap: Map<string, string> | null = null
  if (allowMeta && rows.length > 0 && Object.values(rows[0]).filter(v => v.trim()).every(v => TYPE_CELL_RE.test(v.trim()))) {
    typeMap = new Map()
    for (const [key, val] of Object.entries(rows[0])) {
      if (val.trim() && TYPE_CELL_RE.test(val.trim())) {
        typeMap.set(key, val.trim().slice(1, -1))
      }
    }
    rows = rows.slice(1)
  }

  const columns: ColumnMeta[] = fields.map((key) => {
    const values = rows.map((r) => r[key] ?? '')
    const nonEmpty = values.filter((v) => v.trim() !== '')
    const nulls = values.filter((v) => v === null || v === undefined).length
    const empties = values.filter((v) => v.trim() === '').length
    const unique = new Set(nonEmpty).size
    const sample = nonEmpty.slice(0, 30)

    const inferred = inferType(sample)
    const dbType = typeMap?.get(key)
      ?? (inferred === 'unknown' ? officialTypeFromName(key) : undefined)
    return {
      key,
      label: key,
      type: inferred !== 'unknown' ? inferred : inferTypeFromName(key),
      nullCount: nulls,
      emptyCount: empties,
      uniqueCount: unique,
      sampleValues: sample.slice(0, 5),
      dbType,
      ...(constraintMap?.get(key) ? { dbConstraints: constraintMap.get(key) } : {}),
    }
  })

  return {
    fileName,
    columns,
    rows,
    totalRows: rows.length,
  }
}
