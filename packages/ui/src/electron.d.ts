import type { ParsedCsv } from '@tagger/shared'

export {}

declare global {
  interface Window {
    electronAPI: TaggerApi
  }

  // 화면과 로직 사이의 약속. 데스크톱은 preload(IPC)로, Web은 HTTP로 같은 약속을 구현한다.
  interface TaggerApi {
    openCsv: () => Promise<Array<{ name: string; path: string }> | null>
    localSave: (data: LocalPreset) => Promise<void>
    localLoad: () => Promise<LocalPreset | null>
    localSetActiveFile: (presetName: string, fileName: string | null) => Promise<void>
    localSavePreset: (name: string, data: LocalPreset) => Promise<string>
    localListPresets: () => Promise<Array<{ name: string; mtime: number; product?: string }>>
    localLoadPreset: (name: string) => Promise<LocalPreset | null>
    localDeletePreset: (name: string) => Promise<void>
    importDroppedFile: (file: File) => Promise<{ name: string; path: string }>
    localReadFile: (filePath: string) => Promise<string>
    localGetDownloadsPath: (root: 's3' | 'db') => Promise<string>
    localListCsvTree: (root: 's3' | 'db', subPath?: string) => Promise<Array<{ segments: string[]; files: Array<{ name: string; path: string }> }>>
    localOpenDownloads: (root: 's3' | 'db', subPath?: string) => Promise<string>
    openGithub: () => Promise<void>
    workspaceGet: () => Promise<WorkspaceInfo>
    workspacePick: () => Promise<string | null>
    workspaceSave: (dir: string) => Promise<WorkspaceSaveResult>
    workspaceOpen: () => Promise<string>
    localEraseColumn: (filePath: string, colKey: string) => Promise<void>
    localListDownloads: (root: 's3' | 'db', subPath?: string) => Promise<{ folders: Array<{ name: string; path: string }>; files: Array<{ name: string; path: string; mtime: number; size: number }> }>
    localDeleteDownload: (absolutePath: string) => Promise<void>
    localClearTmp: () => Promise<void>
    csvStats: (filePath: string) => Promise<CsvStats | null>
    cacheLoad: (filePath: string) => Promise<ParsedCsv | null>
    cacheSave: (filePath: string, data: ParsedCsv) => Promise<void>
    sheetSaveSettings: (data: SheetSettings) => Promise<void>
    sheetLoadSettings: () => Promise<SheetSettings | null>
    lorebookList: () => Promise<Array<{ name: string; path: string; folder: string }>>
    lorebookRead: (absPath: string) => Promise<string>
    lorebookWrite: (absPath: string, content: string) => Promise<void>
    lorebookDelete: (absPath: string) => Promise<void>
    lorebookNewPath: (product: string, csvName: string, colLabel: string) => Promise<string>
    lorebookGetColumnComments: (csvName: string) => Promise<Record<string, string>>
    lorebookGetCategories: () => Promise<string[]>
    lorebookSetCategories: (cats: string[]) => Promise<void>
    productLoadConfig: () => Promise<{ order?: string[] }>
    productSaveConfig: (data: { order: string[] }) => Promise<void>
    dbCloseTunnel: (slot: DbSlotId) => Promise<void>
    dbAbortExport: () => Promise<void>
    onExportProgress: (cb: (data: ExportProgress) => void) => void
    offExportProgress: () => void
    dbTestConnection: (slot: DbSlotId) => Promise<{ ok: boolean; message?: string }>
    dbListSchemas: (slot: DbSlotId, search: string, offset?: number) => Promise<DbSchemaPage>
    dbListTables: (slot: DbSlotId, schema: string) => Promise<string[]>
    dbExportTables: (slot: DbSlotId, schema: string, tables: string[]) => Promise<string[]>
    dbExportSchemas: (slot: DbSlotId, schemas: string[]) => Promise<DbExportSchemasResult>
    dbListSlots: () => Promise<DbSlotSummary[]>
    dbLoadSlot: (slot: DbSlotId) => Promise<DbSlotView>
    dbSaveSlot: (slot: DbSlotId, config: DbSlotConfig) => Promise<boolean>
    sshPickPemFile: () => Promise<string | null>
    hermesLoadConfig: () => Promise<HermesConfigView>
    hermesSaveConfig: (cfg: HermesConfigInput) => Promise<void>
    hermesTestConnection: () => Promise<{ ok: true } | { ok: false; message: string }>
    hermesVaultTest: () => Promise<{ ok: boolean; message: string }>
    hermesVaultList: () => Promise<{ ok: true; tree: Array<{ name: string; children: string[] }> } | { ok: false; message: string }>
    cedSend: (product: string | null) => Promise<
      | { ok: true; dir: string; skippedDrafts: number; noNotes: boolean; written: string[]; updated: string[]; unchanged: string[]; overwritten: string[]; leftover: string[] }
      | { ok: false; message: string; dir: string }
    >
    hermesGetSessions: () => Promise<{ object: string; data: HermesSession[] }>
    hermesGetMessages: (sessionId: string) => Promise<{ object: string; data: HermesMessage[] }>
    keyinfoReindex: (product: string | null, fileSources: Record<string, { type: string; path?: string; localPath?: string }>) => Promise<KeyinfoData>
    keyinfoLoad: (product: string | null) => Promise<KeyinfoData>
    keyinfoSavePins: (product: string | null, pins: Array<{ pinId: number; fileName: string; columnKey: string; folderId?: string; comment?: string }>) => Promise<void>
    keyinfoSaveLayout: (product: string | null, pins: Array<{ pinId: number; fileName: string; columnKey: string; folderId?: string; comment?: string }>, folders: KeyinfoFolder[]) => Promise<void>
    keyinfoIndex: (product: string | null, fileSources: Record<string, { type: string; path?: string; localPath?: string }>) => Promise<KeyinfoData>
    onKeyinfoProgress: (cb: (data: { done: number; total: number }) => void) => void
    offKeyinfoProgress: () => void
    cedGenerate: (product: string | null) => Promise<{ dir: string; files: string[]; skippedDrafts: number }>
    // CED를 만들고 문서 내용을 돌려준다 (Web의 보기 + zip). folder는 제품 폴더 이름이다.
    cedRead: (product: string | null) => Promise<{ folder: string; skippedDrafts: number; files: Array<{ name: string; content: string }> }>
    // CED 'Local 저장' 폴더. isDefault는 작업 폴더의 CED/를 쓰는 상태이다.
    cedGetDir: () => Promise<{ path: string; defaultPath: string; isDefault: boolean }>
    cedPickDir: () => Promise<string | null>
    cedSetDir: (dir: string | null) => Promise<{ ok: true; path: string } | { ok: false; message: string }>
    cedReveal: (product: string | null) => Promise<string>
    keynoteList: (product: string | null) => Promise<KeyNote[]>
    keynoteSave: (product: string | null, notes: KeyNote[]) => Promise<void>
    keynoteCandidates: (product: string | null) => Promise<KeyCandidate[]>
    keynoteAcceptCandidate: (product: string | null, signature: string) => Promise<KeyNote | null>
    keynoteSampleRows: (filePath: string, columnKeys: string[], limit: number, skipBlank: boolean, offset: number, sort: { column: string; dir: 'asc' | 'desc' } | null) => Promise<{ ok: boolean; reason: string; columns: string[]; rows: string[][]; total: number; hasMore: boolean; truncated: boolean }>
    keynotePruneByPins: (product: string | null, pins: Array<{ columnKey: string }>) => Promise<string[]>
    keynoteRefreshMembers: (product: string | null) => Promise<number>
    keyinfoListRelations: () => Promise<KeyRelationGroup[]>
    keyinfoSaveRelations: (groups: KeyRelationGroup[]) => Promise<void>
    backupList: () => Promise<BackupMeta[]>
    backupSave: (title: string, comment: string) => Promise<BackupMeta>
    backupRestore: (id: string) => Promise<void>
    backupDelete: (id: string) => Promise<void>
  }

  interface HermesSession {
    id: string
    title: string
    created_at: number
    message_count: number
  }

  // Hermes 연결 설정. 이 앱은 Hermes를 읽기만 한다. 프로필마다 주소, 키, 선택 사항인 SSH 터널을 저장한다.
  interface HermesSshSetting {
    enabled: boolean
    host: string
    port: string
    username: string
    pemPath: string
    // ~/.ssh/config의 Host 이름. 채우면 시스템 ssh로 접속하고 host, username, pemPath는 쓰지 않는다.
    alias: string
  }

  // 불러온 설정. API 키 값은 포함하지 않고 저장 여부(hasKey)만 알려준다.
  interface HermesProfileView {
    id: string
    name: string
    serverUrl: string
    hasKey: boolean
    ssh: HermesSshSetting
    vaultPath: string
    // 로그아웃 설정이 켜져 있고 이번 실행에서 아직 연결 확인을 하지 않은 프로필이다.
    needsVerify: boolean
  }

  interface HermesConfigView {
    activeId: string
    logoutOnExit: boolean
    profiles: HermesProfileView[]
  }

  // 저장할 설정. apiKey가 없거나 비어 있으면 저장된 키를 유지한다.
  interface HermesProfileInput {
    id: string
    name: string
    serverUrl: string
    apiKey?: string
    ssh: HermesSshSetting
    vaultPath?: string
  }

  interface HermesConfigInput {
    activeId: string
    logoutOnExit: boolean
    profiles: HermesProfileInput[]
  }

  interface HermesMessage {
    role: 'user' | 'assistant'
    content: string
    created_at: number
  }

  // 스키마 단위 내보내기 결과. failed는 건너뛴 테이블 목록이다.
  interface DbExportSchemasResult {
    saved: string[]
    failed: Array<{ schema: string; table: string; message: string }>
  }

  interface ExportProgress {
    ti: number
    total: number
    schema: string
    table: string
    rowsDone: number
    totalRows: number
  }

  interface SshConfig {
    host: string
    port: string
    username: string
    pemPath: string
  }

  // 파일을 파싱하지 않고 센 행 수와 열 수. partial이 true이면 큰 파일이라 앞부분만 센 값(최소값)이다.
  // missing이 true이면 파일이 없는 상태(실종)이다.
  interface CsvStats {
    rows: number
    columns: number
    partial: boolean
    missing?: boolean
  }

  // 작업 폴더 정보. needsSetup이 true이면 처음 실행 안내를 보여준다.
  interface WorkspaceInfo {
    path: string
    defaultPath: string
    isDev: boolean
    needsSetup: boolean
  }

  type WorkspaceSaveResult =
    | { ok: true; path: string; reloading: boolean }
    | { ok: false; message: string }

  type DbSlotId = 'db1' | 'db2' | 'db3' | 'db4'

  interface DbSchemaItem {
    name: string
    tableCount: number
  }

  // 스키마 목록 한 페이지. hasMore가 true이면 다음 페이지가 있다.
  interface DbSchemaPage {
    items: DbSchemaItem[]
    hasMore: boolean
  }

  interface DbSlotSummary {
    id: DbSlotId
    name: string
    configured: boolean
  }

  // 저장 요청용. password가 비어 있으면 기존 비밀번호를 유지한다.
  interface DbSlotConfig {
    name: string
    folderName: string
    host: string
    port: string
    database: string
    user: string
    password: string
    ssh: SshConfig
  }

  // 불러오기 결과. 비밀번호 값은 포함하지 않는다.
  // verified는 연결 확인을 통과한 상태이다. 접속 값이 바뀌면 false가 된다.
  interface DbSlotView extends Omit<DbSlotConfig, 'password'> {
    hasPassword: boolean
    verified: boolean
  }

  interface KeyinfoColumnSchema {
    dbType?: string
    isPK?: boolean
    isFK?: boolean
    fkRef?: string
    isUnique?: boolean
    isNotNull?: boolean
    backrefs?: string[]
  }

  interface KeyinfoData {
    product: string | null
    pinnedColumns: Array<{ pinId: number; fileName: string; columnKey: string; folderId?: string; comment?: string }>
    folders?: KeyinfoFolder[]
    schema: Record<string, Record<string, KeyinfoColumnSchema>>
  }

  interface KeyinfoFolder {
    id: string
    name: string
  }

  // Key 노트: 관계 그룹을 확장한 의미 단위 노트. 노트 하나는 한 제품에만 속한다.
  // 저장할 때 product 값은 저장하는 제품으로 맞춰진다. 확인된(confirmed) 노트만 내보낸다.
  // suspended = 작업 일시 중단. 노트 목록에서 빠져 후보 목록에 보류로 나타난다.
  type KeyNoteStatus = 'draft' | 'confirmed' | 'suspended'

  interface KeyNoteMember {
    fileName: string
    columnKey: string
  }

  interface KeyNote {
    id: string
    product: string
    title: string
    definition: string
    body: string
    keywords: string[]
    valueMeanings: string
    status: KeyNoteStatus
    members: KeyNoteMember[]
    excluded: KeyNoteMember[]
    createdAt: string
    updatedAt: string
  }

  // Key 자동 후보. 제안일 뿐이고, 수락해야 초안 Key 노트가 된다. 핀으로 고정한 컬럼이 들어 있는 묶음만 나온다.
  // hold = 작업 일시 중단한 노트 (noteId). 수락하면 내용 그대로 초안으로 돌아온다.
  // kind: fk = FK로 이어진 컬럼 묶음, ref = FK 제약은 없지만 이름 규칙으로 이어진 것으로 추정한 묶음,
  // name = 같은 이름의 컬럼 묶음. signature는 후보를 가리키는 값이다.
  interface KeyCandidate {
    signature: string
    kind: 'fk' | 'ref' | 'name' | 'hold'
    noteId?: string
    title: string
    members: KeyNoteMember[]
    reason: string
  }

  interface KeyRelationMember {
    product: string
    fileName: string
    columnKey: string
  }

  interface KeyRelationGroup {
    id: string
    label: string
    members: KeyRelationMember[]
  }

  interface BackupMeta {
    version?: number
    scopes?: Array<'local' | 'docs/keyinfo' | 'docs/lorebook'>
    id: string
    title: string
    comment: string
    date: string
  }

  interface LocalPreset {
    product?: string
    // 이 JSON에서 마지막으로 보던 CSV 파일 이름. 시트나 프리셋을 열면 이 파일을 바로 연다.
    activeFile?: string
    folders: Array<{ id: string; name: string; expanded: boolean }>
    fileToFolder: Record<string, string>
    fileSources: Record<string, { type: string; path?: string; key?: string }>
    columnWidths?: Record<string, Record<string, number>>
    pageSettings?: Record<string, number>
    hiddenFiles?: string[]
    fileComments?: Record<string, string>
    lorebookCategories?: string[]
    deletedColumns?: Record<string, string[]>
    hiddenColumns?: Record<string, string[]>
    lorebookIndex?: Record<string, string[]>
  }

  interface SheetMeta {
    id: string
    name: string
    isDefault: boolean
    jsonFile: string | null
  }

  interface SheetSettings {
    sheets: SheetMeta[]
    activeSheet: string
  }
}
