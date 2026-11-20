import { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } from 'electron'
import type { WebContents } from 'electron'
import path from 'path'
import fs from 'fs'
import net from 'net'
import zlib from 'zlib'
import Papa from 'papaparse'
import { Client } from 'pg'
import { Client as SshClient } from 'ssh2'
import type { SFTPWrapper, Stats, FileEntryWithStats } from 'ssh2'
import { isSafeAlias, makeExecOps, sshRunner, startAliasTunnel } from './sshAlias'
import type { RemoteOps } from './sshAlias'
import { createCedSender } from './cedTransfer'
import { writeCedIndex } from './cedIndex'
import { backupDirectory, saveWorkspaceBackup, restoreWorkspaceBackup } from './workspaceBackup'
import type { BackupMeta } from './workspaceBackup'
import { makeWorkspace } from './core/workspace'
import type { Workspace } from './core/workspace'
import { makeSessionState } from './core/context'
import type { Ctx, Handlers } from './core/context'
import { localHandlers, importToLocalDownloads, getDownloadsRoot, withinDownloadsRoot } from './core/local'
import { csvHandlers } from './core/csv'
import { dbHandlers, normalizeSlots, safeSegment } from './core/db'
import type { SlotId, SshConfig, DbSlotConfig, DbSlots } from './core/db'
import { keyinfoHandlers, generateCed, productDirName, cedFileStem } from './core/keyinfo'
import { lorebookHandlers, listProductNames } from './core/lorebook'

const isDev = !app.isPackaged

// ── 작업 폴더 ─────────────────────────────────────────────────────────────────
// CSV, 프리셋, 키 문서가 저장되는 폴더이다. 선택한 위치는 userData의 workspace.json에 기록한다.
// 설정이 없으면 개발 모드는 프로젝트 폴더를, 배포본은 문서\DBViewer-tagger를 쓴다.
// 폴더를 바꾸면 저장 경로를 모두 다시 계산하고 화면을 새로 불러온다. (applyDataRoot)
const WORKSPACE_CONFIG_PATH = path.join(app.getPath('userData'), 'workspace.json')
const DEFAULT_WORKSPACE = path.join(app.getPath('documents'), 'DBViewer-tagger')

function readWorkspaceConfig(): string | null {
  try {
    if (!fs.existsSync(WORKSPACE_CONFIG_PATH)) return null
    const parsed = JSON.parse(fs.readFileSync(WORKSPACE_CONFIG_PATH, 'utf-8'))
    return typeof parsed?.path === 'string' && parsed.path !== '' ? parsed.path : null
  } catch {
    return null
  }
}

const CONFIGURED_WORKSPACE = readWorkspaceConfig()
// 지금 쓰는 작업 폴더. 작업 폴더를 바꾸면 applyDataRoot가 새 묶음으로 바꾼다.
let WS: Workspace = makeWorkspace(CONFIGURED_WORKSPACE ?? (isDev ? app.getAppPath() : DEFAULT_WORKSPACE))

// 데스크톱의 사용자는 하나다. 상태도 하나, 작업 폴더도 지금 WS 하나.
const DESKTOP_STATE = makeSessionState()
let desktopSender: WebContents | null = null

function desktopCtx(): Ctx {
  return {
    ws: WS,
    state: DESKTOP_STATE,
    emit: (channel, data) => { if (desktopSender && !desktopSender.isDestroyed()) desktopSender.send(channel, data) },
    slots: { load: loadSlots, save: saveSlots },
    cedDir: cedBaseDir,
    tunnel: { open: ensureTunnel, close: closeTunnel },
    allowOutsidePaths: true,
  }
}

// core의 처리 함수 표를 IPC에 연결한다. 알림은 마지막으로 요청한 창으로 보낸다.
function registerCore(handlers: Handlers): void {
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args) => {
      if (event?.sender) desktopSender = event.sender
      return fn(desktopCtx(), ...args)
    })
  }
}


function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0f1117',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:6200')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  DESKTOP_STATE.exportAborted = true
  for (const [id] of activeTunnels) closeTunnel(id)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// IPC: 파일 선택 다이얼로그 — 복사만, content 미반환
ipcMain.handle('dialog:openCsv', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  })
  if (result.canceled) return null
  return await Promise.all(result.filePaths.map((p) => importToLocalDownloads(desktopCtx(), p)))
})

// IPC: DnD 파일 경로 → local-downloads 에 복사, path만 반환
ipcMain.handle('local:importFile', (_event, sourcePath: string) => {
  return importToLocalDownloads(desktopCtx(), sourcePath)
})

registerCore(localHandlers)

// 헤더의 GitHub 버튼: 기본 브라우저로 고정된 주소만 연다.
ipcMain.handle('app:openGithub', () => shell.openExternal('https://github.com/wonderwall1995'))

ipcMain.handle('workspace:get', () => ({
  path: WS.root,
  defaultPath: DEFAULT_WORKSPACE,
  isDev,
  // 배포본에서 아직 작업 폴더를 정하지 않았으면 처음 실행 안내를 보여준다.
  needsSetup: !isDev && CONFIGURED_WORKSPACE === null,
}))

ipcMain.handle('workspace:pick', async () => {
  const result = await dialog.showOpenDialog({
    title: '작업 폴더 선택',
    defaultPath: WS.root,
    properties: ['openDirectory', 'createDirectory'],
  })
  return result.canceled ? null : result.filePaths[0]
})

// 작업 폴더를 바꾼 뒤 모든 저장 경로를 다시 계산한다.
function applyDataRoot(root: string): void {
  WS = makeWorkspace(root)
}

// 작업 폴더를 저장하고 바로 적용한다. 지금 쓰는 폴더와 다르면 화면을 새로 불러온다.
ipcMain.handle('workspace:save', (event, dir: string) => {
  try {
    if (typeof dir !== 'string' || dir.trim() === '') {
      return { ok: false as const, message: '폴더 경로가 비어 있습니다.' }
    }
    const target = path.resolve(dir.trim())
    fs.mkdirSync(target, { recursive: true })
    // 쓸 수 있는 폴더인지 확인한다.
    const probe = path.join(target, '.dbviewer-write-test')
    fs.writeFileSync(probe, '')
    fs.rmSync(probe, { force: true })
    fs.mkdirSync(path.dirname(WORKSPACE_CONFIG_PATH), { recursive: true })
    fs.writeFileSync(WORKSPACE_CONFIG_PATH, JSON.stringify({ path: target }, null, 2), 'utf-8')
    const changed = path.resolve(WS.root) !== target
    if (changed) {
      applyDataRoot(target)
      // 앱 상태가 이전 폴더 기준이므로 화면을 새로 불러와 새 폴더의 파일을 읽게 한다.
      const win = BrowserWindow.fromWebContents(event.sender)
      setTimeout(() => win?.webContents.reload(), 100)
    }
    return { ok: true as const, path: target, reloading: changed }
  } catch (e: unknown) {
    return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('workspace:open', async () => {
  fs.mkdirSync(WS.root, { recursive: true })
  return shell.openPath(WS.root)
})

// 저장된 폴더를 탐색기로 연다. 성공하면 빈 문자열, 실패하면 오류 메시지를 돌려준다.
ipcMain.handle('local:openDownloads', async (_event, root: 's3' | 'db' = 'db', subPath?: string) => {
  const ctx = desktopCtx()
  const downloadsRoot = getDownloadsRoot(ctx, root)
  const target = subPath ? path.resolve(downloadsRoot, subPath) : downloadsRoot
  if (!withinDownloadsRoot(ctx, target)) return '잘못된 경로입니다.'
  // 아직 저장한 적이 없어도 최상위 폴더는 열 수 있게 만든다.
  if (target === downloadsRoot) fs.mkdirSync(downloadsRoot, { recursive: true })
  if (!fs.existsSync(target)) return '폴더를 찾을 수 없습니다.'
  return shell.openPath(target)
})

registerCore(csvHandlers)

registerCore(lorebookHandlers)

// ── DB 슬롯 설정 (safeStorage 암호화) ─────────────────────────────────────────
// DB 슬롯은 4개이다. 접속 정보는 로컬 파일에만 저장한다.
// 비밀번호는 렌더러로 돌려보내지 않는다.

const DB_SLOTS_PATH = path.join(app.getPath('userData'), 'db-slots-v1.bin')
const LEGACY_SSH_PATH = path.join(app.getPath('userData'), 'db-ssh-config-v2.bin')

function readEncryptedJson(filePath: string): any {
  const buf = fs.readFileSync(filePath)
  const json = safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(buf)
    : buf.toString('utf8')
  return JSON.parse(json)
}

function loadSlots(): DbSlots {
  let saved: Partial<Record<SlotId, Partial<DbSlotConfig>>> = {}
  let legacyDevSsh: Partial<SshConfig> | undefined
  try {
    if (fs.existsSync(DB_SLOTS_PATH)) {
      saved = readEncryptedJson(DB_SLOTS_PATH)
    } else if (fs.existsSync(LEGACY_SSH_PATH)) {
      // 이전 버전의 개발 환경 SSH 설정은 DB1으로 옮긴다.
      legacyDevSsh = readEncryptedJson(LEGACY_SSH_PATH).dev
    }
  } catch { /* 읽기에 실패하면 빈 슬롯으로 시작한다. */ }
  return normalizeSlots(saved, legacyDevSsh)
}

function saveSlots(slots: DbSlots): void {
  const json = JSON.stringify(slots)
  const toWrite = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(json)
    : Buffer.from(json, 'utf8')
  fs.writeFileSync(DB_SLOTS_PATH, toWrite)
}

// ── Hermes Agent API (읽기 전용) ───────────────────────────────────────────────
// 세션 목록과 대화 내용을 보기만 한다. 이 앱은 Hermes에 쓰지 않는다.
// (세션을 만들거나 지우거나 메시지를 보내는 기능은 없다)
// 프로필마다 서버 주소, API 키, 선택 사항인 SSH 터널 설정을 저장한다.
// 설정은 이 PC에만 암호화해서 저장한다.
//
// 로그아웃 설정(logoutOnExit)이 켜져 있으면, 앱을 켤 때마다 "연결 확인"을 한 번 해야 그 프로필로 연결된다.
// 저장된 값(주소, 키, SSH 터널)은 지우지 않는다. 연결 확인을 통과한 프로필은 hermesVerified에 담는다.
// 이 목록은 메모리에만 있어서 앱을 다시 켜면 비워진다.

const HERMES_CONFIG_PATH = path.join(app.getPath('userData'), 'hermes-config.bin')
const HERMES_MAX_PROFILES = 10
const hermesVerified = new Set<string>()

// alias: ~/.ssh/config의 Host 이름. 채우면 host, username, pemPath 대신 시스템 ssh가 그 설정대로 접속한다.
interface HermesSsh { enabled: boolean; host: string; port: string; username: string; pemPath: string; alias: string }
// vaultPath: Hermes 서버(SSH로 접속하는 PC)의 Obsidian 볼트 절대 경로. 맥락 문서(CED)를 보낼 때 쓴다. 암호화된 설정에만 둔다.
interface HermesProfile { id: string; name: string; serverUrl: string; apiKey: string; ssh: HermesSsh; vaultPath: string }
interface HermesConfig { activeId: string; logoutOnExit: boolean; profiles: HermesProfile[] }

function newHermesProfileId(): string {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// 처음 만드는 프로필과 이전 형식에서 옮기는 프로필은 항상 같은 ID를 쓴다.
// 설정 파일에 저장되기 전에 여러 번 불러와도 ID가 바뀌지 않아야 저장할 때 기존 키를 찾을 수 있다.
const HERMES_FIRST_PROFILE_ID = 'p-first'

function emptyHermesProfile(name: string, id: string = newHermesProfileId()): HermesProfile {
  return {
    id,
    name,
    serverUrl: '',
    apiKey: '',
    ssh: { enabled: false, host: '', port: '22', username: '', pemPath: '', alias: '' },
    vaultPath: '',
  }
}

function normalizeHermesSsh(value: any): HermesSsh {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return {
    enabled: value?.enabled === true,
    host: text(value?.host),
    port: text(value?.port) || '22',
    username: text(value?.username),
    pemPath: text(value?.pemPath),
    alias: text(value?.alias),
  }
}

function loadHermesConfig(): HermesConfig {
  let raw: any = null
  try {
    if (fs.existsSync(HERMES_CONFIG_PATH)) {
      const buf = fs.readFileSync(HERMES_CONFIG_PATH)
      const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
      raw = JSON.parse(json)
    }
  } catch { raw = null }

  let profiles: HermesProfile[] = []
  if (raw && Array.isArray(raw.profiles)) {
    profiles = raw.profiles.slice(0, HERMES_MAX_PROFILES).map((p: any, i: number) => ({
      id: typeof p?.id === 'string' && p.id ? p.id : newHermesProfileId(),
      name: typeof p?.name === 'string' && p.name.trim() ? p.name.trim() : `프로필 ${i + 1}`,
      serverUrl: typeof p?.serverUrl === 'string' ? p.serverUrl : '',
      apiKey: typeof p?.apiKey === 'string' ? p.apiKey : '',
      ssh: normalizeHermesSsh(p?.ssh),
      vaultPath: typeof p?.vaultPath === 'string' ? p.vaultPath.trim() : '',
    }))
  } else if (raw && (typeof raw.serverUrl === 'string' || typeof raw.apiKey === 'string')) {
    // 이전 형식({ serverUrl, apiKey })은 프로필 1로 옮긴다.
    profiles = [{ ...emptyHermesProfile('프로필 1', HERMES_FIRST_PROFILE_ID), serverUrl: raw.serverUrl ?? '', apiKey: raw.apiKey ?? '' }]
  }
  if (profiles.length === 0) profiles = [emptyHermesProfile('프로필 1', HERMES_FIRST_PROFILE_ID)]

  const activeId = profiles.some((p) => p.id === raw?.activeId) ? (raw.activeId as string) : profiles[0].id
  return { activeId, logoutOnExit: raw?.logoutOnExit === true, profiles }
}

function saveHermesConfig(cfg: HermesConfig): void {
  const json = JSON.stringify(cfg)
  const toWrite = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8')
  fs.writeFileSync(HERMES_CONFIG_PATH, toWrite)
}

// 지금 선택된 프로필로 연결할 주소와 키를 정한다. SSH 터널을 쓰는 프로필이면 터널을 열고 주소를 터널로 바꾼다.
// 터널을 쓸 때 서버 주소는 SSH로 접속한 PC 기준의 주소이다. (예: http://127.0.0.1:8642)
async function resolveHermesTarget(skipVerify: boolean): Promise<{ base: string; apiKey: string; profileId: string }> {
  const cfg = loadHermesConfig()
  const profile = cfg.profiles.find((p) => p.id === cfg.activeId) ?? cfg.profiles[0]
  if (!profile.serverUrl) throw new Error('Hermes 서버 주소를 먼저 설정하세요')
  if (!profile.apiKey) throw new Error('API 키가 없어요. 키를 입력하세요')
  // 로그아웃 설정이 켜져 있으면 연결 확인을 통과하기 전에는 연결하지 않는다.
  if (cfg.logoutOnExit && !skipVerify && !hermesVerified.has(profile.id)) {
    throw new Error('로그아웃 상태예요. 설정 화면에서 연결 확인을 눌러 주세요')
  }

  let url: URL
  try { url = new URL(profile.serverUrl) } catch { throw new Error('서버 주소 형식이 올바르지 않아요') }

  if (profile.ssh.enabled && (profile.ssh.alias || profile.ssh.host)) {
    const remotePort = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80)
    const key = `hermes:${profile.id}`
    const localPort = profile.ssh.alias
      ? await ensureAliasTunnel(key, profile.ssh.alias, url.hostname, remotePort)
      : await ensureTunnel(key, profile.ssh, url.hostname, remotePort)
    url.hostname = '127.0.0.1'
    url.port = String(localPort)
  }
  return { base: url.toString().replace(/\/$/, ''), apiKey: profile.apiKey, profileId: profile.id }
}

function describeHermesError(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { cause?: { code?: string } }).cause?.code
    if (e.name === 'TimeoutError') return '서버가 응답하지 않아요 (시간 초과)'
    if (e.message === 'fetch failed') return `서버에 연결하지 못했어요${code ? ` (${code})` : ''}`
    return e.message
  }
  return String(e)
}

// 읽기 전용: GET 요청만 보낸다. 성공하면 그 프로필을 연결 확인을 통과한 것으로 기록한다.
async function hermesGet(urlPath: string, skipVerify = false): Promise<unknown> {
  try {
    const { base, apiKey, profileId } = await resolveHermesTarget(skipVerify)
    const res = await fetch(`${base}${urlPath}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const err: { error?: { message?: string } } = await res.json().catch(() => ({}))
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
    }
    hermesVerified.add(profileId)
    return res.json()
  } catch (e) {
    throw new Error(describeHermesError(e))
  }
}

// 설정 불러오기. API 키 값은 화면으로 보내지 않고 저장 여부만 알린다.
ipcMain.handle('hermes:loadConfig', () => {
  const cfg = loadHermesConfig()
  return {
    activeId: cfg.activeId,
    logoutOnExit: cfg.logoutOnExit,
    profiles: cfg.profiles.map((p) => ({
      id: p.id,
      name: p.name,
      serverUrl: p.serverUrl,
      hasKey: p.apiKey !== '',
      ssh: p.ssh,
      vaultPath: p.vaultPath,
      // 로그아웃 설정이 켜져 있고 이번 실행에서 연결 확인을 아직 안 한 프로필이다.
      needsVerify: cfg.logoutOnExit && !hermesVerified.has(p.id),
    })),
  }
})

// 설정 저장. 프로필의 apiKey가 비어 있으면 기존 키를 유지한다. 목록에서 빠진 프로필은 키와 함께 지워진다.
ipcMain.handle('hermes:saveConfig', (_event, payload: any) => {
  const current = loadHermesConfig()
  const byId = new Map(current.profiles.map((p) => [p.id, p]))
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const incoming: any[] = Array.isArray(payload?.profiles) ? payload.profiles.slice(0, HERMES_MAX_PROFILES) : []

  let profiles: HermesProfile[] = incoming.map((p, i) => {
    const prev = byId.get(text(p?.id))
    return {
      id: text(p?.id) || newHermesProfileId(),
      name: text(p?.name) || `프로필 ${i + 1}`,
      serverUrl: text(p?.serverUrl),
      apiKey: text(p?.apiKey) !== '' ? text(p?.apiKey) : (prev?.apiKey ?? ''),
      ssh: normalizeHermesSsh(p?.ssh),
      vaultPath: text(p?.vaultPath),
    }
  })
  if (profiles.length === 0) profiles = [emptyHermesProfile('프로필 1')]

  // 연결 값(주소, 키, SSH 터널)이 바뀐 프로필과 삭제된 프로필은 연결 확인을 다시 해야 한다.
  const sshKey = (s: HermesSsh) => `${s.enabled}|${s.host}|${s.port}|${s.username}|${s.pemPath}|${s.alias}`
  for (const profile of profiles) {
    const prev = byId.get(profile.id)
    if (!prev || prev.serverUrl !== profile.serverUrl || prev.apiKey !== profile.apiKey || sshKey(prev.ssh) !== sshKey(profile.ssh)) {
      hermesVerified.delete(profile.id)
    }
  }
  for (const id of byId.keys()) {
    if (!profiles.some((p) => p.id === id)) hermesVerified.delete(id)
  }

  // 설정이 바뀌었을 수 있으므로 열려 있던 터널을 닫는다. 다음 요청에서 새 설정으로 다시 연다.
  for (const id of new Set([...current.profiles.map((p) => p.id), ...profiles.map((p) => p.id)])) {
    closeTunnel(`hermes:${id}`)
  }

  const activeId = profiles.some((p) => p.id === payload?.activeId) ? (payload.activeId as string) : profiles[0].id
  saveHermesConfig({ activeId, logoutOnExit: payload?.logoutOnExit === true, profiles })
})

ipcMain.handle('hermes:testConnection', async () => {
  try {
    await hermesGet('/api/sessions', true)
    return { ok: true as const }
  } catch (e: unknown) {
    return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('hermes:getSessions', () => hermesGet('/api/sessions'))

ipcMain.handle('hermes:getMessages', (_event, sessionId: string) => {
  return hermesGet(`/api/sessions/${encodeURIComponent(String(sessionId))}/messages`)
})

// ── CED를 Hermes 서버의 Obsidian 볼트로 보내기 (SFTP) ─────────────────────────────
// Hermes 프로필의 SSH 정보(호스트, 사용자, 키)로 접속해 <볼트>/CED/<제품>/ 에 .md 문서를 쓴다.
// 쓰는 범위는 그 폴더 안으로만 제한한다. 볼트의 다른 파일은 읽지도, 지우지도 않는다.
// 볼트 경로는 암호화된 Hermes 설정에만 두고, 로그와 오류 메시지에는 넣지 않는다.
//
// 덮어쓰기 규칙: 내용이 같으면 그대로 둔다. 다르면 덮어쓴다. 앱이 마지막으로 쓴 내용(.ced-state.json의 해시)과 지금 파일이 같으면 "갱신"이다.
// 다르면 사람이 볼트에서 고친 파일이다. 이 도구의 내용이 기준이므로 덮어쓰고 "덮어쓴 문서"로 알린다. (앱은 볼트에서 가져오지 않는다)
// 앱에서 빠진 문서는 볼트에서 지우지 않고 남겨 둔다고 알려 준다.

const VAULT_CED_DIR = 'CED'

interface VaultSession { ops: RemoteOps; root: string; close: () => void }

const vaultJoin = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')

function activeHermesProfile(): HermesProfile {
  const cfg = loadHermesConfig()
  const profile = cfg.profiles.find((p) => p.id === cfg.activeId) ?? cfg.profiles[0]
  // 로그아웃 설정이 켜져 있으면 연결 확인을 통과하기 전에는 접속하지 않는다.
  if (cfg.logoutOnExit && !hermesVerified.has(profile.id)) {
    throw new Error('로그아웃 상태예요. Hermes 설정 화면에서 연결 확인을 눌러 주세요')
  }
  return profile
}

function openVaultSession(profile: HermesProfile): Promise<VaultSession> {
  const root = profile.vaultPath.replace(/\/+$/, '')
  if (!root || !root.startsWith('/')) return Promise.reject(new Error('볼트 경로를 절대 경로로 입력해 주세요 (예: /home/사용자/문서/Obsidian Vault)'))
  if (!profile.ssh.enabled) return Promise.reject(new Error('Hermes 설정에서 SSH 터널 사용을 먼저 켜 주세요'))

  // 별칭: 시스템 ssh로 접속한다. ssh 설정(키 암호, ssh-agent, ProxyJump)을 그대로 따른다.
  if (profile.ssh.alias) {
    if (!isSafeAlias(profile.ssh.alias)) return Promise.reject(new Error('SSH 별칭에 쓸 수 없는 글자가 있어요'))
    return Promise.resolve({ ops: makeExecOps(sshRunner(profile.ssh.alias)), root, close: () => {} })
  }

  // 호스트, 사용자, 키 파일: ssh2의 SFTP로 접속한다.
  if (!profile.ssh.host || !profile.ssh.username || !profile.ssh.pemPath) {
    return Promise.reject(new Error('Hermes 설정의 SSH 항목(별칭, 또는 호스트, 사용자, 키)을 먼저 채워 주세요'))
  }
  return new Promise((resolve, reject) => {
    const ssh = new SshClient()
    let settled = false
    const fail = (e: Error) => { if (!settled) { settled = true; try { ssh.end() } catch { /* 이미 닫힘 */ } reject(e) } }
    ssh.on('ready', () => {
      ssh.sftp((err, sftp) => {
        if (err) return fail(err)
        settled = true
        resolve({ ops: sftpAsRemoteOps(sftp), root, close: () => { try { ssh.end() } catch { /* 이미 닫힘 */ } } })
      })
    })
    ssh.on('error', fail)
    try {
      ssh.connect({
        host: profile.ssh.host,
        port: parseInt(profile.ssh.port) || 22,
        username: profile.ssh.username,
        privateKey: fs.readFileSync(profile.ssh.pemPath),
        readyTimeout: 15_000,
      })
    } catch (e) { fail(e instanceof Error ? e : new Error(String(e))) }
  })
}

// SFTP 콜백 함수를 Promise로 바꾸고, 별칭 방식과 같은 모양(RemoteOps)으로 맞춘다.
function sftpAsRemoteOps(sftp: SFTPWrapper): RemoteOps {
  return {
    stat: (p) => new Promise((res, rej) => sftp.stat(p, (e, s: Stats) => (e ? rej(e) : res({ isDirectory: s.isDirectory(), size: s.size })))),
    readdir: (p) => new Promise((res, rej) => sftp.readdir(p, (e, l: FileEntryWithStats[]) => (e ? rej(e) : res(l.map((f) => ({ filename: f.filename, isDirectory: f.attrs.isDirectory() })))))),
    mkdir: (p) => new Promise((res, rej) => sftp.mkdir(p, (e) => (e ? rej(e) : res()))),
    readFile: (p) => new Promise((res, rej) => sftp.readFile(p, (e, b) => (e ? rej(e) : res(b)))),
    writeFile: (p, data) => new Promise((res, rej) => sftp.writeFile(p, data, (e) => (e ? rej(e) : res()))),
    unlink: (p) => new Promise((res, rej) => sftp.unlink(p, (e) => (e ? rej(e) : res()))),
    // SFTP의 기본 이름 바꾸기는 대상이 있으면 실패한다. OpenSSH의 덮어쓰기용 확장을 쓰고, 안 되면 지운 뒤 바꾼다.
    rename: (from, to) => new Promise((res, rej) => {
      sftp.ext_openssh_rename(from, to, (e) => {
        if (!e) return res()
        sftp.unlink(to, () => sftp.rename(from, to, (e2) => (e2 ? rej(e2) : res())))
      })
    }),
  }
}

const isNotFound = (e: unknown) => (e as { code?: number })?.code === 2

// 폴더가 없으면 만든다. (mkdir -p) 볼트 루트는 이미 있어야 한다.
async function ensureRemoteDirs(ops: RemoteOps, root: string, segments: string[]): Promise<string> {
  let cur = root
  for (const seg of segments) {
    cur = vaultJoin(cur, seg)
    try { await ops.stat(cur) } catch (e) {
      if (!isNotFound(e)) throw e
      await ops.mkdir(cur)
    }
  }
  return cur
}

function describeVaultError(e: unknown): string {
  const err = e as { message?: string; code?: number | string; level?: string }
  if (err?.level === 'client-authentication') return 'SSH 인증에 실패했어요. 사용자 이름과 키를 확인해 주세요'
  if (err?.code === 'ECONNREFUSED') return 'SSH 서버에 연결하지 못했어요 (연결 거부). 서버가 켜져 있는지 확인해 주세요'
  if (err?.code === 'ENOTFOUND' || err?.code === 'EHOSTUNREACH') return 'SSH 호스트를 찾을 수 없어요'
  if (err?.code === 3) return '볼트에 쓸 권한이 없어요'
  if (err?.code === 2) return '볼트 경로를 찾을 수 없어요'
  return e instanceof Error ? e.message : String(e)
}

// 연결 시험: 볼트 경로가 있는지, 옵시디언 볼트가 맞는지(.obsidian), 쓸 수 있는지 본다. CED 폴더는 만들어 둔다.
ipcMain.handle('hermes:vaultTest', async () => {
  let session: VaultSession | null = null
  try {
    session = await openVaultSession(activeHermesProfile())
    const ops = session.ops
    const root = await ops.stat(session.root)
    if (!root.isDirectory) return { ok: false as const, message: '볼트 경로가 폴더가 아니에요' }
    let isVault = true
    try { await ops.stat(vaultJoin(session.root, '.obsidian')) } catch { isVault = false }
    const dir = await ensureRemoteDirs(ops, session.root, [VAULT_CED_DIR])
    const probe = vaultJoin(dir, '.write-test')
    await ops.writeFile(probe, Buffer.from('ok'))
    await ops.unlink(probe)
    return {
      ok: true as const,
      message: isVault ? '연결과 쓰기를 확인했어요' : '쓰기는 되지만 .obsidian 폴더가 없어요. 볼트 경로가 맞는지 확인해 주세요',
    }
  } catch (e) {
    return { ok: false as const, message: describeVaultError(e) }
  } finally {
    session?.close()
  }
})

// 구조 보기: 볼트의 폴더 이름만 두 단계까지 보여 준다. 노트 파일 이름과 내용은 읽지 않는다.
ipcMain.handle('hermes:vaultList', async () => {
  let session: VaultSession | null = null
  try {
    session = await openVaultSession(activeHermesProfile())
    const ops = session.ops
    const top = (await ops.readdir(session.root)).filter((f) => f.isDirectory)
    const tree: Array<{ name: string; children: string[] }> = []
    for (const d of top.sort((a, b) => a.filename.localeCompare(b.filename))) {
      let children: string[] = []
      if (!d.filename.startsWith('.')) {
        try {
          children = (await ops.readdir(vaultJoin(session.root, d.filename)))
            .filter((f) => f.isDirectory && !f.filename.startsWith('.'))
            .map((f) => f.filename)
            .sort((a, b) => a.localeCompare(b))
        } catch { children = [] }
      }
      tree.push({ name: d.filename, children })
    }
    return { ok: true as const, tree }
  } catch (e) {
    return { ok: false as const, message: describeVaultError(e) }
  } finally {
    session?.close()
  }
})

// 맥락 문서를 만들고(작업 폴더의 CED/<제품>/) 볼트로 보낸다.
ipcMain.handle('ced:send', createCedSender({
  dataRoot: () => WS.root,
  generate: (product) => generateCed(desktopCtx(), product),
  connect: async () => {
    const profile = activeHermesProfile()
    return { ...await openVaultSession(profile), transport: profile.ssh.alias ? 'ssh-exec' as const : 'sftp' as const }
  },
  describeError: describeVaultError,
}))

ipcMain.handle('ssh:pickPemFile', async () => {
  const result = await dialog.showOpenDialog({
    title: 'PEM 키 파일 선택',
    filters: [
      { name: 'PEM Key', extensions: ['pem'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  })
  return result.canceled ? null : result.filePaths[0]
})

// ── DB (PostgreSQL) ───────────────────────────────────────────────────────────

// ── SSH 터널 ─────────────────────────────────────────────────────────────────

interface TunnelEntry { localPort: number; close: () => void }
const activeTunnels = new Map<string, TunnelEntry>()

function ensureTunnel(key: string, sshCfg: SshConfig, dbHost: string, dbPort: number): Promise<number> {
  const existing = activeTunnels.get(key)
  if (existing) return Promise.resolve(existing.localPort)

  return new Promise((resolve, reject) => {
    const ssh = new SshClient()

    ssh.on('ready', () => {
      const server = net.createServer((sock) => {
        ssh.forwardOut('127.0.0.1', sock.remotePort ?? 0, dbHost, dbPort, (err, stream) => {
          if (err) {
            // 터널 안쪽 연결이 실패하면 원인을 터미널에 기록한다.
            console.error(`[ssh-tunnel:${key}] forwardOut 실패 (${dbHost}:${dbPort}): ${err.message}`)
            sock.destroy()
            return
          }
          sock.pipe(stream)
          stream.pipe(sock)
        })
      })
      server.listen(0, '127.0.0.1', () => {
        const localPort = (server.address() as net.AddressInfo).port
        const entry: TunnelEntry = { localPort, close: () => { server.close(); ssh.end() } }
        activeTunnels.set(key, entry)
        // 연결이 끊기면 목록에서 지운다. 지우지 않으면 죽은 포트를 계속 쓰게 되어, 다음 요청에서 다시 연결하지 못한다.
        ssh.on('close', () => {
          if (activeTunnels.get(key) === entry) {
            server.close()
            activeTunnels.delete(key)
          }
        })
        resolve(localPort)
      })
      server.on('error', reject)
    })

    ssh.on('error', reject)

    ssh.connect({
      host: sshCfg.host,
      port: parseInt(sshCfg.port) || 22,
      username: sshCfg.username,
      privateKey: fs.readFileSync(sshCfg.pemPath),
      // 30초마다 살아 있는지 확인하고, 3번 응답이 없으면 끊긴 것으로 본다. (ssh_config의 ServerAliveInterval과 같은 역할)
      keepaliveInterval: 30_000,
      keepaliveCountMax: 3,
      readyTimeout: 15_000,
    })
  })
}

// 별칭(~/.ssh/config의 Host)으로 터널을 연다. 시스템 ssh를 쓴다.
const pendingAliasTunnels = new Map<string, Promise<number>>()
function ensureAliasTunnel(key: string, alias: string, host: string, port: number): Promise<number> {
  const existing = activeTunnels.get(key)
  if (existing) return Promise.resolve(existing.localPort)
  const pending = pendingAliasTunnels.get(key)
  if (pending) return pending   // 요청이 겹쳐도 터널은 하나만 연다.
  const p = startAliasTunnel(alias, host, port)
    .then((t) => {
      activeTunnels.set(key, { localPort: t.localPort, close: t.close })
      return t.localPort
    })
    .finally(() => { pendingAliasTunnels.delete(key) })
  pendingAliasTunnels.set(key, p)
  return p
}

function closeTunnel(key: string): void {
  const t = activeTunnels.get(key)
  if (!t) return
  activeTunnels.delete(key)
  t.close()
}

// 터널 닫기
ipcMain.handle('db:closeTunnel', (_event, slot: SlotId) => { closeTunnel(slot) })

registerCore(dbHandlers)

registerCore(keyinfoHandlers)

// ── CED 저장 폴더 ─────────────────────────────────────────────────────────────
// 'Local 저장' 버튼이 CED를 쓰는 폴더. 제품마다 이 폴더 아래 <제품>/ 폴더를 만든다.
// 설정은 이 PC의 userData/ced.json에 둔다 (작업 폴더 백업에 들어가지 않는다). 설정이 없으면 작업 폴더의 CED/를 쓴다.
// Hermes 전송도 이 폴더에 먼저 만든 파일을 보낸다.
const CED_CONFIG_PATH = path.join(app.getPath('userData'), 'ced.json')

function readCedDirConfig(): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(CED_CONFIG_PATH, 'utf-8'))
    return typeof parsed?.dir === 'string' && path.isAbsolute(parsed.dir) ? parsed.dir : null
  } catch {
    return null
  }
}

function cedBaseDir(): string {
  return readCedDirConfig() ?? path.join(WS.root, 'CED')
}

ipcMain.handle('ced:getDir', () => {
  const configured = readCedDirConfig()
  return { path: configured ?? path.join(WS.root, 'CED'), defaultPath: path.join(WS.root, 'CED'), isDefault: configured === null }
})

ipcMain.handle('ced:pickDir', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], defaultPath: cedBaseDir() })
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
})

// dir가 null이면 기본값(작업 폴더의 CED/)으로 되돌린다.
ipcMain.handle('ced:setDir', (_event, dir: string | null) => {
  try {
    if (dir === null) {
      fs.rmSync(CED_CONFIG_PATH, { force: true })
      return { ok: true as const, path: path.join(WS.root, 'CED') }
    }
    if (typeof dir !== 'string' || !path.isAbsolute(dir.trim())) {
      return { ok: false as const, message: '폴더 경로가 올바르지 않습니다.' }
    }
    const target = path.resolve(dir.trim())
    fs.mkdirSync(target, { recursive: true })
    const probe = path.join(target, '.dbviewer-write-test')
    fs.writeFileSync(probe, '')
    fs.rmSync(probe, { force: true })
    fs.mkdirSync(path.dirname(CED_CONFIG_PATH), { recursive: true })
    fs.writeFileSync(CED_CONFIG_PATH, JSON.stringify({ dir: target }, null, 2), 'utf-8')
    return { ok: true as const, path: target }
  } catch (e: unknown) {
    return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
  }
})

// 제품의 CED 폴더를 탐색기로 연다. 경로는 화면에서 받지 않고 여기서 계산한다.
ipcMain.handle('ced:reveal', async (_event, product: string | null) => {
  const dir = path.join(cedBaseDir(), cedFileStem(productDirName(product)))
  fs.mkdirSync(dir, { recursive: true })
  return shell.openPath(dir)
})

