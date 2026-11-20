export interface CsvFile {
  name: string
  path: string
  content: string
}

export interface ParsedCsv {
  fileName: string
  columns: ColumnMeta[]
  rows: Record<string, string>[]
  totalRows: number
}

export interface DbConstraints {
  isPK?: boolean
  isFK?: boolean
  fkRef?: string
  isUnique?: boolean
  isNotNull?: boolean
  backrefs?: string[]
}

export interface ColumnMeta {
  key: string
  label: string
  type: InferredType
  nullCount: number
  emptyCount: number
  uniqueCount: number
  sampleValues: string[]
  dbType?: string
  dbConstraints?: DbConstraints
}

export type InferredType =
  | 'number'
  | 'date'
  | 'boolean'
  | 'phone'
  | 'email'
  | 'text'
  | 'id'
  | 'unknown'

export interface FolderItem {
  id: string
  name: string
  expanded: boolean
}

export type FileSource =
  | { type: 'local'; path: string }
  | { type: 's3'; key: string; bucket: string; localPath?: string }
  | { type: 'dnd' }

export interface TableFilter {
  column: string
  value: string
}

export interface PinnedColumn {
  pinId: number
  fileName: string
  columnKey: string
  folderId?: string
  comment?: string
}

export interface KeyinfoFolder {
  id: string
  name: string
}

export interface KeyinfoColumnSchema {
  dbType?: string
  isPK?: boolean
  isFK?: boolean
  fkRef?: string
  isUnique?: boolean
  isNotNull?: boolean
  backrefs?: string[]
}

export interface KeyinfoData {
  product: string | null
  pinnedColumns: Array<{ pinId: number; fileName: string; columnKey: string; folderId?: string; comment?: string }>
  folders?: KeyinfoFolder[]
  schema: Record<string, Record<string, KeyinfoColumnSchema>>
}
