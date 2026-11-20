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
    tunnel: { open: ensureTunnel, close: closeTunnel },
    allowOutsidePaths: true,
  }
}

// core의 처리 함수 표를 IPC에 연결한다. 알림은 마지막으로 요청한 창으로 보낸다.
function registerCore(handlers: Handlers): void {
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event, ...args) => {
      desktopSender = event.sender
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
// 덮어쓰기 규칙: 앱이 마지막으로 쓴 내용(.ced-state.json의 해시)과 지금 파일이 같을 때만 덮어쓴다.
// 다르면 사람이 볼트에서 고친 파일로 보고 건너뛴다. (볼트의 수정이 우선, 앱은 볼트에서 가져오지 않는다)
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
  generate: generateCed,
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

// ── Keyinfo JSON 영속화 ─────────────────────────────────────────────────────

interface KeyinfoColSchema {
  dbType?: string
  isPK?: boolean
  isFK?: boolean
  fkRef?: string
  isUnique?: boolean
  isNotNull?: boolean
  backrefs?: string[]
}

interface KeyinfoFolder { id: string; name: string }

interface KeyinfoData {
  product: string | null
  pinnedColumns: Array<{ pinId: number; fileName: string; columnKey: string; folderId?: string }>
  folders?: KeyinfoFolder[]
  schema: Record<string, Record<string, KeyinfoColSchema>>
}


function getKeyinfoPath(product?: string | null): string {
  return path.join(WS.docsKeyinfoDir, product?.trim() || 'none', 'keyinfo.json')
}

function loadKeyinfoData(p: string): KeyinfoData {
  try {
    if (fs.existsSync(p)) {
      const d = JSON.parse(fs.readFileSync(p, 'utf-8')) as KeyinfoData
      if (!d.folders) d.folders = []
      return d
    }
  } catch {}
  return { product: null, pinnedColumns: [], folders: [], schema: {} }
}

function saveKeyinfoData(p: string, data: KeyinfoData): void {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8')
}

function parseCsvHeaderOnly(filePath: string): {
  columns: string[]
  constraints: Record<string, KeyinfoColSchema>
  dbTypes: Record<string, string>
} {
  const fd = fs.openSync(filePath, 'r')
  const buf = Buffer.alloc(8192)
  const n = fs.readSync(fd, buf, 0, 8192, 0)
  fs.closeSync(fd)

  const text = buf.subarray(0, n).toString('utf-8')
  const lines = text.split(/\r?\n/).filter(l => l.trim())

  const parseRow = (line: string): string[] => {
    const out: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') inQ = !inQ
      else if (ch === ',' && !inQ) { out.push(cur.trim()); cur = '' }
      else cur += ch
    }
    out.push(cur.trim())
    return out
  }

  const parseCell = (cell: string): KeyinfoColSchema => {
    const inner = cell.slice(1, -1)
    const c: KeyinfoColSchema = {}
    for (const part of inner.split('|')) {
      if (part === 'PK') c.isPK = true
      else if (part === 'UQ') c.isUnique = true
      else if (part === 'NN') c.isNotNull = true
      else if (part.startsWith('FK→')) { c.isFK = true; c.fkRef = part.slice(3) }
      else if (part.startsWith('REF←')) c.backrefs = part.slice(4).split(',')
    }
    return c
  }

  const columns = parseRow(lines[0] ?? '')
  const constraints: Record<string, KeyinfoColSchema> = {}
  const dbTypes: Record<string, string> = {}

  let idx = 1
  if (lines[idx] && /^\s*"?\[/.test(lines[idx])) {
    const cells = parseRow(lines[idx])
    columns.forEach((col, i) => {
      const cell = (cells[i] ?? '').trim().replace(/^"|"$/g, '')
      if (/^\[.*\]$/.test(cell)) constraints[col] = parseCell(cell)
    })
    idx++
  }

  if (lines[idx] && /^\s*"?\{/.test(lines[idx])) {
    const cells = parseRow(lines[idx])
    columns.forEach((col, i) => {
      const cell = (cells[i] ?? '').trim().replace(/^"|"$/g, '')
      if (/^\{.*\}$/.test(cell)) dbTypes[col] = cell.slice(1, -1)
    })
  }

  return { columns, constraints, dbTypes }
}

// local:clearTmp — ./local/tmp 폴더 전체 삭제
ipcMain.handle('local:clearTmp', async () => {
  if (fs.existsSync(WS.tmpDir)) fs.rmSync(WS.tmpDir, { recursive: true, force: true })
})

// ── Backup ────────────────────────────────────────────────────────────────────

ipcMain.handle('backup:list', async (): Promise<BackupMeta[]> => {
  if (!fs.existsSync(WS.backupRoot)) return []
  const result: BackupMeta[] = []
  for (const name of fs.readdirSync(WS.backupRoot)) {
    if (!name.startsWith('backup_')) continue
    const metaPath = path.join(WS.backupRoot, name, 'meta.json')
    if (fs.existsSync(metaPath)) {
      try { result.push(JSON.parse(fs.readFileSync(metaPath, 'utf-8'))) } catch {}
    }
  }
  return result.sort((a, b) => b.date.localeCompare(a.date))
})

ipcMain.handle('backup:save', async (_event, title: string, comment: string): Promise<BackupMeta> => {
  return saveWorkspaceBackup(WS.root, title, comment)
})

ipcMain.handle('backup:restore', async (_event, id: string) => {
  restoreWorkspaceBackup(WS.root, id)
  keyNoteMigratedFor = ''
})

ipcMain.handle('backup:delete', async (_event, id: string) => {
  const backupDir = backupDirectory(WS.root, id)
  if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true })
})

// ── Key 연관 그룹 ─────────────────────────────────────────────────────────────

function loadKeyinfoRelations(): unknown[] {
  if (!fs.existsSync(WS.keyinfoRelationsPath)) return []
  try { return JSON.parse(fs.readFileSync(WS.keyinfoRelationsPath, 'utf-8')) } catch { return [] }
}

function saveKeyinfoRelations(groups: unknown[]) {
  fs.mkdirSync(path.dirname(WS.keyinfoRelationsPath), { recursive: true })
  fs.writeFileSync(WS.keyinfoRelationsPath, JSON.stringify(groups, null, 2), 'utf-8')
}

ipcMain.handle('keyinfo:listRelations', () => loadKeyinfoRelations())
ipcMain.handle('keyinfo:saveRelations', (_event, groups: unknown[]) => saveKeyinfoRelations(groups))

// ── Key 노트 (Keyinfo) ─────────────────────────────────────────────────────────
// 관계 그룹을 확장한 Key 노트이다. 의미 단위 하나를 노트 하나로 두고, 노트 하나는 한 제품에만 속한다.
// 제품마다 docs/keyinfo/<제품>/keynotes.json에 저장한다. (제품이 없으면 none 폴더)
// 제품 사이의 연결은 키워드(개념 노트로 가는 링크)가 맡는다.

// suspended = 작업 일시 중단. 노트 목록에서 빠져 후보 목록에 보류로 나타난다. 내용은 그대로 둔다.
type KeyNoteStatus = 'draft' | 'confirmed' | 'suspended'
interface KeyNoteMember { fileName: string; columnKey: string }
interface KeyNote {
  id: string
  product: string          // 소속 제품. 한 노트는 한 제품에만 속한다.
  title: string            // 제목. 기본값은 대표 컬럼 이름이다.
  definition: string       // 한 줄 정의
  body: string             // 본문 (평문)
  keywords: string[]       // 개념 노트로 가는 링크로 내보낸다.
  valueMeanings: string    // 값 의미. 상태값, 코드값 컬럼에 쓴다.
  status: KeyNoteStatus    // 초안은 내보내지 않는다.
  members: KeyNoteMember[] // 출현 목록
  excluded: KeyNoteMember[] // 사용자가 출현 목록에서 뺀 컬럼. 새로고침이 다시 넣지 않는다.
  createdAt: string
  updatedAt: string
}

function productDirName(product?: string | null): string {
  return product?.trim() || 'none'
}

function getKeyNotesPath(product?: string | null): string {
  return path.join(WS.docsKeyinfoDir, productDirName(product), 'keynotes.json')
}

function newKeyNoteId(): string {
  return `kn_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

// 저장된 값이 빠졌거나 잘못되어도 항상 완전한 노트로 만든다.
function normalizeKeyNote(raw: any, product: string): KeyNote {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const seen = new Set<string>()
  const members: KeyNoteMember[] = []
  for (const m of Array.isArray(raw?.members) ? raw.members : []) {
    const fileName = text(m?.fileName)
    const columnKey = text(m?.columnKey)
    const key = `${fileName}\u0000${columnKey}`
    if (!fileName || !columnKey || seen.has(key)) continue
    seen.add(key)
    members.push({ fileName, columnKey })
  }
  const excluded: KeyNoteMember[] = []
  const seenExcluded = new Set<string>()
  for (const m of Array.isArray(raw?.excluded) ? raw.excluded : []) {
    const fileName = text(m?.fileName)
    const columnKey = text(m?.columnKey)
    const key = `${fileName}\u0000${columnKey}`
    if (!fileName || !columnKey || seenExcluded.has(key) || seen.has(key)) continue
    seenExcluded.add(key)
    excluded.push({ fileName, columnKey })
  }
  const keywords: string[] = []
  for (const k of Array.isArray(raw?.keywords) ? raw.keywords : []) {
    const word = text(k)
    if (word && !keywords.includes(word)) keywords.push(word)
  }
  const now = new Date().toISOString()
  return {
    id: text(raw?.id) || newKeyNoteId(),
    product,
    title: text(raw?.title) || members[0]?.columnKey || '제목 없음',
    definition: text(raw?.definition),
    body: typeof raw?.body === 'string' ? raw.body : '',
    keywords,
    valueMeanings: typeof raw?.valueMeanings === 'string' ? raw.valueMeanings : '',
    status: raw?.status === 'confirmed' ? 'confirmed' : raw?.status === 'suspended' ? 'suspended' : 'draft',
    members,
    excluded,
    createdAt: text(raw?.createdAt) || now,
    updatedAt: text(raw?.updatedAt) || now,
  }
}

function loadKeyNotes(product?: string | null): KeyNote[] {
  const p = getKeyNotesPath(product)
  const dirName = productDirName(product)
  try {
    if (!fs.existsSync(p)) return []
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
    const list: any[] = Array.isArray(parsed?.notes) ? parsed.notes : []
    return list.map((n) => normalizeKeyNote(n, dirName))
  } catch {
    return []
  }
}

function writeKeyNotes(product: string | null | undefined, notes: KeyNote[]): void {
  const p = getKeyNotesPath(product)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify({ version: 1, product: productDirName(product), notes }, null, 2), 'utf-8')
}

// 노트를 저장한다. 받은 노트의 제품 값은 무시하고 저장하는 제품으로 맞춘다. (한 노트는 한 제품에만 속한다)
function saveKeyNotes(product: string | null | undefined, rawNotes: unknown): void {
  const dirName = productDirName(product)
  const list: any[] = Array.isArray(rawNotes) ? rawNotes : []
  const now = new Date().toISOString()
  const ids = new Set<string>()
  const notes: KeyNote[] = []
  for (const raw of list) {
    const note = normalizeKeyNote({ ...raw, updatedAt: now }, dirName)
    if (ids.has(note.id)) note.id = newKeyNoteId()
    ids.add(note.id)
    notes.push(note)
  }
  writeKeyNotes(product, notes)
}

// 기존 관계 그룹(relations.json)을 Key 노트로 옮긴다. 앱을 켠 뒤 처음 Key 노트를 불러올 때 한 번 실행한다.
//  - 관계 그룹은 제품을 넘나들 수 있으므로 제품별로 나눠서, 제품마다 노트 하나로 만든다.
//  - 여러 제품에 걸친 그룹은 원래 이름을 키워드로 달아 노트끼리 이어 둔다.
//  - 이미 Key 노트 파일이 있는 제품은 덮어쓰지 않는다. 원본 relations.json은 지우지 않고 그대로 두며, 백업도 남긴다.
let keyNoteMigratedFor = ''

function migrateLegacyRelations(): { products: string[]; notes: number } {
  const result = { products: [] as string[], notes: 0 }
  if (keyNoteMigratedFor === WS.docsKeyinfoDir) return result
  keyNoteMigratedFor = WS.docsKeyinfoDir

  const groups = loadKeyinfoRelations() as any[]
  if (!Array.isArray(groups) || groups.length === 0) return result

  const byProduct = new Map<string, KeyNote[]>()
  for (const group of groups) {
    const label = typeof group?.label === 'string' ? group.label.trim() : ''
    const perProduct = new Map<string, KeyNoteMember[]>()
    for (const m of Array.isArray(group?.members) ? group.members : []) {
      const product = productDirName(typeof m?.product === 'string' ? m.product : '')
      const list = perProduct.get(product) ?? []
      list.push({ fileName: String(m?.fileName ?? ''), columnKey: String(m?.columnKey ?? '') })
      perProduct.set(product, list)
    }
    const crossProduct = perProduct.size > 1
    for (const [product, members] of perProduct) {
      const note = normalizeKeyNote(
        { title: label, members, keywords: crossProduct && label ? [label] : [], status: 'draft' },
        product,
      )
      if (note.members.length === 0) continue
      byProduct.set(product, [...(byProduct.get(product) ?? []), note])
    }
  }
  if (byProduct.size === 0) return result

  // 원본 백업 (이미 있으면 그대로 둔다)
  try {
    const backup = path.join(path.dirname(WS.keyinfoRelationsPath), 'relations.legacy.json')
    if (!fs.existsSync(backup)) fs.copyFileSync(WS.keyinfoRelationsPath, backup)
  } catch { /* 백업하지 못해도 원본은 그대로 남는다. */ }

  for (const [product, notes] of byProduct) {
    if (fs.existsSync(getKeyNotesPath(product))) continue
    writeKeyNotes(product, notes)
    result.products.push(product)
    result.notes += notes.length
  }
  return result
}

ipcMain.handle('keynote:list', (_event, product: string | null) => {
  migrateLegacyRelations()
  return loadKeyNotes(product)
})

ipcMain.handle('keynote:save', (_event, product: string | null, notes: unknown) => {
  saveKeyNotes(product, notes)
})

// ── 제품 맥락 문서 (Context Enrichment Docs, CED) ─────────────────────────────
// 확인된(confirmed) Key 노트로 마크다운 문서를 만들어 작업 폴더의 CED/<제품>/ 에 쓴다.
// 구성: 제품 목차 파일 1개(<제품>.md) + Key 노트당 파일 1개(<제목>.md). Obsidian 링크([[제목]])로 목차와 노트를 잇는다.
// 이 함수는 파일만 만든다. Hermes로 보내는 일은 하지 않는다.
// 지난번에 만든 파일 목록(.ced-manifest.json)에 있는데 이번에 없는 파일만 지운다. 사용자가 직접 넣은 파일은 건드리지 않는다.
const CED_MANIFEST = '.ced-manifest.json'

function cedFileStem(title: string): string {
  const stem = title.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  return stem || '제목 없음'
}

function cedColumnLine(fileName: string, columnKey: string, schema: KeyinfoData['schema']): string {
  const col = schema[fileName]?.[columnKey]
  const parts: string[] = []
  if (col?.dbType) parts.push(col.dbType)
  if (col?.isPK) parts.push('PK')
  if (col?.isFK) parts.push(col.fkRef ? `FK → ${col.fkRef}` : 'FK')
  if (col?.isNotNull) parts.push('NN')
  if (col?.isUnique) parts.push('UQ')
  const detail = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `- \`${fileName}\` · \`${columnKey}\`${detail}`
}

function buildCedNote(note: KeyNote, productName: string, indexStem: string, schema: KeyinfoData['schema']): string {
  // 출현 목록은 키워드와 같이 문서의 값(메타데이터)이다. 테이블.컬럼 목록과 테이블 목록을 둘 다 둔다.
  const appearsIn = note.members.map((m) => `${m.fileName.replace(/\.csv$/i, '')}.${m.columnKey}`)
  const tables = [...new Set(note.members.map((m) => m.fileName.replace(/\.csv$/i, '')))]
  const lines: string[] = [
    '---',
    `product: ${JSON.stringify(productName)}`,
    `keywords: ${JSON.stringify(note.keywords)}`,
    `appearsIn: ${JSON.stringify(appearsIn)}`,
    `tables: ${JSON.stringify(tables)}`,
    `status: ${note.status}`,
    `updated: ${JSON.stringify(note.updatedAt)}`,
    '---',
    `# ${note.title}`,
    '',
    `목차: [[${indexStem}]]`,
    '',
  ]
  if (note.definition) lines.push('## 정의', '', note.definition, '')
  if (note.members.length > 0) {
    lines.push('## 출현 목록', '')
    for (const m of note.members) lines.push(cedColumnLine(m.fileName, m.columnKey, schema))
    lines.push('')
  }
  if (note.valueMeanings.trim()) lines.push('## 값의 뜻', '', note.valueMeanings.trim(), '')
  if (note.body.trim()) lines.push('## 설명', '', note.body.trim(), '')
  return lines.join('\n')
}

function generateCed(product: string | null | undefined): { dir: string; files: string[]; skippedDrafts: number } {
  const dirName = productDirName(product)
  const all = loadKeyNotes(product)
  const notes = all.filter((n) => n.status === 'confirmed')
  const schema = loadKeyinfoData(getKeyinfoPath(product)).schema
  const outDir = path.join(cedBaseDir(), cedFileStem(dirName))
  fs.mkdirSync(outDir, { recursive: true })

  const indexStem = cedFileStem(dirName)
  const used = new Set<string>([indexStem.toLowerCase()])
  const written: { stem: string; note: KeyNote }[] = []
  for (const note of notes) {
    let stem = cedFileStem(note.title)
    if (used.has(stem.toLowerCase())) stem = `${stem}-${note.id.slice(-4)}`
    used.add(stem.toLowerCase())
    written.push({ stem, note })
  }

  const files: string[] = []
  for (const { stem, note } of written) {
    fs.writeFileSync(path.join(outDir, `${stem}.md`), buildCedNote(note, dirName, indexStem, schema), 'utf-8')
    files.push(`${stem}.md`)
  }

  const indexLines = [
    '---',
    `product: ${JSON.stringify(dirName)}`,
    `notes: ${written.length}`,
    `generated: ${JSON.stringify(new Date().toISOString())}`,
    '---',
    `# ${dirName} 맥락 문서`,
    '',
    '확인된 Key 노트 목록이다.',
    '',
  ]
  if (written.length === 0) indexLines.push('(확인된 Key 노트가 없다)')
  for (const { stem, note } of written) {
    indexLines.push(`- [[${stem}]]${note.definition ? ` — ${note.definition}` : ''}`)
  }
  indexLines.push('')
  writeCedIndex(path.join(outDir, `${indexStem}.md`), indexLines.join('\n'))
  files.push(`${indexStem}.md`)

  // 지난번에 만들었고 이번에는 없는 파일만 지운다.
  const manifestPath = path.join(outDir, CED_MANIFEST)
  try {
    const prev: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const prevFiles = Array.isArray((prev as { files?: unknown })?.files) ? (prev as { files: unknown[] }).files : []
    for (const f of prevFiles) {
      if (typeof f !== 'string' || files.includes(f) || /[\\/]/.test(f)) continue
      const target = path.join(outDir, f)
      if (fs.existsSync(target)) fs.unlinkSync(target)
    }
  } catch { /* 처음 만들거나 목록을 읽지 못하면 지우지 않는다. */ }
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, files }, null, 2), 'utf-8')

  return { dir: outDir, files, skippedDrafts: all.length - notes.length }
}

ipcMain.handle('ced:generate', (_event, product: string | null) => generateCed(product))

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

// ── Key 자동 후보 ───────────────────────────────────────────────────────────────
// 자동 색인(keyinfo.json의 schema)에서 Key 후보를 제안한다. 후보는 제안일 뿐이고, 사람이 수락해야 초안 노트가 된다.
//  1. FK 체인: FK로 이어진 컬럼은 하나의 후보로 묶는다. (예: users.id, transactions.sender_id, comments.user_id)
//     FK 제약이 없는 컬럼은 이름 규칙으로 추정해 같은 방식으로 묶는다. (예: userId -> users.id) 이 후보는 ref로 구분한다.
//  2. 같은 이름: FK로 이어지지 않은 컬럼 중 이름이 같은 것을 2개 이상의 파일에서 찾으면 묶는다. (예: created_at)
//  - id는 모든 테이블에 있지만 뜻이 다르므로 이름으로 묶지 않는다. id는 FK 체인으로만 묶인다.
//  - _로 시작하는 파일(마이그레이션 기록 등 내부용)은 제외한다.
//  - 이미 Key 노트에 들어간 컬럼은 후보에서 뺀다. 거절한 후보는 다시 보이지 않는다.

// kind hold = 작업 일시 중단한 노트. noteId로 노트를 가리키고, 수락하면 내용 그대로 초안으로 돌아온다.
interface KeyCandidate {
  signature: string
  kind: 'fk' | 'ref' | 'name' | 'hold'
  noteId?: string
  title: string
  members: KeyNoteMember[]
  reason: string
}

const KEY_NAME_EXCLUDED = new Set(['id'])

const keyOf = (fileName: string, columnKey: string) => `${fileName}\u0000${columnKey}`

function fileBaseName(fileName: string): string {
  return fileName.replace(/\.csv$/i, '')
}

function splitColumnRef(ref: string): { table: string; column: string } | null {
  const i = ref.lastIndexOf('.')
  if (i <= 0 || i === ref.length - 1) return null
  return { table: ref.slice(0, i), column: ref.slice(i + 1) }
}

interface KeyGroup { kind: 'fk' | 'ref' | 'name'; title: string; reason: string; members: KeyNoteMember[] }

// 스키마에서 같은 Key로 보이는 컬럼 묶음을 모두 찾는다. 노트에 들어갔는지, 핀이 있는지는 여기서 따지지 않는다.
function buildKeyGroups(schema: Record<string, Record<string, KeyinfoColSchema>>): KeyGroup[] {
  const files = Object.keys(schema ?? {}).filter((f) => !f.startsWith('_'))

  // 테이블 이름 -> 파일. 사이드바 표시용으로 "스키마.테이블.csv"가 된 파일도 마지막 조각으로 찾는다.
  const tableToFile = new Map<string, string>()
  for (const f of files) {
    const base = fileBaseName(f)
    tableToFile.set(base, f)
    const last = base.split('.').pop()
    if (last && !tableToFile.has(last)) tableToFile.set(last, f)
  }
  const hasColumn = (file: string, column: string) => !!schema[file] && column in schema[file]

  // FK 관계로 이어진 컬럼을 같은 묶음으로 모은다. (union-find)
  const parent = new Map<string, string>()
  const find = (k: string): string => {
    let root = k
    while ((parent.get(root) ?? root) !== root) root = parent.get(root) as string
    parent.set(k, root)
    return root
  }
  const linked = new Set<string>()
  const union = (a: string, b: string) => {
    linked.add(a)
    linked.add(b)
    if (!parent.has(a)) parent.set(a, a)
    if (!parent.has(b)) parent.set(b, b)
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const file of files) {
    for (const [column, info] of Object.entries(schema[file])) {
      if (info.isFK && info.fkRef) {
        const ref = splitColumnRef(info.fkRef)
        const target = ref ? tableToFile.get(ref.table) : undefined
        if (ref && target && hasColumn(target, ref.column)) union(keyOf(file, column), keyOf(target, ref.column))
      }
      for (const back of info.backrefs ?? []) {
        const ref = splitColumnRef(back)
        const source = ref ? tableToFile.get(ref.table) : undefined
        if (ref && source && hasColumn(source, ref.column)) union(keyOf(file, column), keyOf(source, ref.column))
      }
    }
  }

  // FK 제약이 없는 컬럼은 이름 규칙으로 가리키는 곳을 추정한다. (예: userId -> users.id, bankTransferId -> bank_transfers.id)
  // Prisma처럼 DB에 FK 제약을 두지 않는 경우가 많다. 추정이므로 후보의 종류를 ref로 구분해 사람이 확인하게 한다.
  const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const compactToFile = new Map<string, string>()
  for (const f of files) {
    const compactName = compact(fileBaseName(f).split('.').pop() ?? '')
    if (compactName && !compactToFile.has(compactName)) compactToFile.set(compactName, f)
  }
  const findTable = (stem: string): string | undefined => {
    const variants = [stem, `${stem}s`, `${stem}es`]
    if (stem.endsWith('y')) variants.push(`${stem.slice(0, -1)}ies`)
    for (const v of variants) {
      const hit = compactToFile.get(v)
      if (hit) return hit
    }
    return undefined
  }
  // 대상 테이블의 id 컬럼. id가 없으면 PK가 하나일 때 그 컬럼을 쓴다.
  const findIdColumn = (file: string): string | undefined => {
    const cols = Object.entries(schema[file])
    const byName = cols.find(([c]) => c.toLowerCase() === 'id')
    if (byName) return byName[0]
    const pks = cols.filter(([, info]) => info.isPK)
    return pks.length === 1 ? pks[0][0] : undefined
  }
  const logicalEdges: Array<[string, string]> = []
  const targetKeys = new Set<string>()
  for (const file of files) {
    for (const [column, info] of Object.entries(schema[file])) {
      if (info.isFK) continue // FK 제약이 있으면 그것을 쓴다.
      const m = /^(.+?)(?:_id|Id|ID)$/.exec(column)
      if (!m) continue
      const target = findTable(compact(m[1]))
      if (!target || target === file) continue
      const targetColumn = findIdColumn(target)
      if (!targetColumn) continue
      logicalEdges.push([keyOf(file, column), keyOf(target, targetColumn)])
      targetKeys.add(keyOf(target, targetColumn))
    }
  }
  for (const [a, b] of logicalEdges) union(a, b)
  const logicalRoots = new Set<string>()
  for (const [a] of logicalEdges) logicalRoots.add(find(a))

  const groups: KeyGroup[] = []

  // 1. FK로 이어진 컬럼. 제약이 있으면 fk, 이름 규칙으로 추정한 연결이 하나라도 있으면 ref이다.
  const chains = new Map<string, KeyNoteMember[]>()
  for (const k of linked) {
    const [fileName, columnKey] = k.split('\u0000')
    const root = find(k)
    chains.set(root, [...(chains.get(root) ?? []), { fileName, columnKey }])
  }
  for (const [root, members] of chains) {
    members.sort((a, b) => a.fileName.localeCompare(b.fileName) || a.columnKey.localeCompare(b.columnKey))
    // 대표는 다른 컬럼을 가리키지 않는 쪽이다. PK, 추정으로 가리켜진 컬럼, 나머지 순으로 고른다. 제목과 원천 테이블이 된다.
    const notFk = members.filter((m) => !schema[m.fileName][m.columnKey]?.isFK)
    const rep =
      notFk.find((m) => schema[m.fileName][m.columnKey]?.isPK) ??
      notFk.find((m) => targetKeys.has(keyOf(m.fileName, m.columnKey))) ??
      notFk[0] ??
      members[0]
    const repTable = fileBaseName(rep.fileName)
    const inferred = logicalRoots.has(root)
    groups.push({
      kind: inferred ? 'ref' : 'fk',
      title: `${repTable.split('.').pop()}.${rep.columnKey}`,
      reason: inferred ? `FK 제약 없음, 이름 규칙으로 추정 (${members.length}개)` : `FK로 이어진 컬럼 ${members.length}개`,
      members,
    })
  }

  // 2. 같은 이름
  const byName = new Map<string, KeyNoteMember[]>()
  for (const file of files) {
    for (const column of Object.keys(schema[file])) {
      if (linked.has(keyOf(file, column))) continue
      const lower = column.toLowerCase()
      if (KEY_NAME_EXCLUDED.has(lower)) continue
      byName.set(lower, [...(byName.get(lower) ?? []), { fileName: file, columnKey: column }])
    }
  }
  for (const members of byName.values()) {
    if (new Set(members.map((m) => m.fileName)).size < 2) continue
    groups.push({
      kind: 'name',
      title: members[0].columnKey,
      reason: `같은 이름이 ${new Set(members.map((m) => m.fileName)).size}개 파일에`,
      members,
    })
  }

  return groups
}

// 후보는 핀으로 고정한 컬럼이 들어 있는 묶음만 보여 준다. 핀을 거두면 후보에서도 사라진다.
// 이미 노트에 들어간 컬럼은 빼고, 2개 미만이 남으면 후보로 보이지 않는다.
function buildKeyCandidates(
  schema: Record<string, Record<string, KeyinfoColSchema>>,
  covered: Set<string>,
  pinnedColumnKeys: Set<string>,
): KeyCandidate[] {
  const result: KeyCandidate[] = []
  for (const g of buildKeyGroups(schema)) {
    if (!g.members.some((m) => pinnedColumnKeys.has(m.columnKey))) continue
    const members = g.members.filter((m) => !covered.has(keyOf(m.fileName, m.columnKey)))
    if (members.length < 2) continue
    const signature = members.map((m) => `${m.fileName}:${m.columnKey}`).sort().join('|')
    result.push({ signature, kind: g.kind, title: g.title, members, reason: g.reason })
  }
  const order = { fk: 0, ref: 1, name: 2, hold: 3 }
  result.sort((a, b) => (a.kind === b.kind ? a.title.localeCompare(b.title) : order[a.kind] - order[b.kind]))
  return result
}

function pinnedColumnKeys(product?: string | null): Set<string> {
  return new Set(loadKeyinfoData(getKeyinfoPath(product)).pinnedColumns.map((p) => p.columnKey))
}

function listKeyCandidates(product?: string | null): KeyCandidate[] {
  migrateLegacyRelations()
  const data = loadKeyinfoData(getKeyinfoPath(product))
  const notes = loadKeyNotes(product)
  const covered = new Set<string>()
  for (const note of notes) {
    for (const m of note.members) covered.add(keyOf(m.fileName, m.columnKey))
  }
  const candidates = buildKeyCandidates(data.schema, covered, pinnedColumnKeys(product))
  // 작업을 일시 중단한 노트는 후보 맨 위에 보류로 보인다. 내용은 그대로 있다.
  const held: KeyCandidate[] = notes
    .filter((n) => n.status === 'suspended')
    .map((n) => ({
      signature: `hold:${n.id}`,
      kind: 'hold' as const,
      noteId: n.id,
      title: n.title,
      members: n.members,
      reason: '작업 일시 중단한 노트',
    }))
  return [...held, ...candidates]
}

ipcMain.handle('keynote:candidates', (_event, product: string | null) => listKeyCandidates(product))

// 후보를 수락하면 초안 노트가 된다. 보류한 노트는 내용 그대로 초안으로 돌아온다.
// 후보가 이미 사라졌다면(다른 노트가 먼저 차지했거나 핀이 없어짐) null을 돌려준다.
ipcMain.handle('keynote:acceptCandidate', (_event, product: string | null, signature: string) => {
  const candidate = listKeyCandidates(product).find((c) => c.signature === signature)
  if (!candidate) return null
  const notes = loadKeyNotes(product)
  if (candidate.kind === 'hold') {
    const held = notes.find((n) => n.id === candidate.noteId)
    if (!held) return null
    held.status = 'draft'
    held.updatedAt = new Date().toISOString()
    writeKeyNotes(product, notes)
    return held
  }
  const note = normalizeKeyNote(
    { title: candidate.title, members: candidate.members, status: 'draft' },
    productDirName(product),
  )
  writeKeyNotes(product, [...notes, note])
  return note
})

// 핀을 거둔 뒤 부르는 정리 함수. 남은 핀이 하나도 없는 노트는 지운다. (핀이 Key 노트가 존재하는 조건이다)
// 보류 노트도 같다. 지운 노트의 제목 목록을 돌려준다.
ipcMain.handle('keynote:pruneByPins', (_event, product: string | null, pins: unknown) => {
  const keys = new Set<string>()
  for (const p of Array.isArray(pins) ? pins : []) {
    const k = (p as { columnKey?: unknown })?.columnKey
    if (typeof k === 'string' && k) keys.add(k)
  }
  const notes = loadKeyNotes(product)
  const kept = notes.filter((n) => n.members.some((m) => keys.has(m.columnKey)))
  const removed = notes.filter((n) => !kept.includes(n)).map((n) => n.title)
  if (removed.length > 0) writeKeyNotes(product, kept)
  return removed
})

// 출현 목록 새로고침. 노트마다 같은 Key로 보이는 컬럼 묶음을 다시 찾아 새 테이블의 컬럼을 넣는다.
// 사용자가 뺀 컬럼(excluded)은 다시 넣지 않는다.
// 보류 노트는 건드리지 않는다. 바뀐 노트 수를 돌려준다.
ipcMain.handle('keynote:refreshMembers', (_event, product: string | null) => {
  const schema = loadKeyinfoData(getKeyinfoPath(product)).schema
  const groups = buildKeyGroups(schema)
  const notes = loadKeyNotes(product)
  let changed = 0
  for (const note of notes) {
    if (note.status === 'suspended') continue
    const have = new Set(note.members.map((m) => keyOf(m.fileName, m.columnKey)))
    const skip = new Set(note.excluded.map((m) => keyOf(m.fileName, m.columnKey)))
    let touched = false
    for (const g of groups) {
      if (!g.members.some((m) => have.has(keyOf(m.fileName, m.columnKey)))) continue
      for (const m of g.members) {
        const k = keyOf(m.fileName, m.columnKey)
        if (have.has(k) || skip.has(k)) continue
        note.members.push(m)
        have.add(k)
        touched = true
      }
    }
    if (touched) { note.updatedAt = new Date().toISOString(); changed++ }
  }
  if (changed > 0) writeKeyNotes(product, notes)
  return changed
})
// 값 예시: CSV에서 지정한 컬럼의 값만 읽어 20~50행씩 나눠 준다. 읽기 전용이다.
// 파일 경로는 프리셋 JSON의 fileSources에서 온다. 제약 행([PK])과 타입 행({integer})은 건너뛴다.
// 파일은 앞쪽 32MB까지 한 번 읽어 고른 컬럼만 메모리에 두고(마지막 한 번의 결과만), 파일이 바뀌면(수정 시각, 크기) 다시 읽는다.
// 필터(빈 값, 0 제외)와 정렬은 읽은 전체 행에 적용하므로, 먼저 불러온 행만 정렬되는 일이 없다.
const SAMPLE_READ_CAP = 32 * 1024 * 1024
let sampleCache: {
  key: string
  columns: string[]
  rows: string[][]
  truncated: boolean
  viewKey: string
  view: string[][]
} | null = null

ipcMain.handle('keynote:sampleRows', (_event, filePath: unknown, columnKeys: unknown, limit: unknown, skipBlank: unknown, offset: unknown, sort: unknown) => {
  const fail = (reason: string) => ({ ok: false, reason, columns: [] as string[], rows: [] as string[][], total: 0, hasMore: false, truncated: false })
  if (typeof filePath !== 'string' || !/\.csv$/i.test(filePath)) return fail('invalid')
  if (!fs.existsSync(filePath)) return fail('missing')
  const wanted = Array.isArray(columnKeys) ? columnKeys.filter((k): k is string => typeof k === 'string') : []
  const take = Math.min(Math.max(typeof limit === 'number' ? Math.floor(limit) : 20, 1), 200)
  const from = Math.max(typeof offset === 'number' ? Math.floor(offset) : 0, 0)
  const sortCol = typeof (sort as { column?: unknown } | null)?.column === 'string' ? (sort as { column: string }).column : ''
  const sortDir = (sort as { dir?: unknown } | null)?.dir === 'desc' ? 'desc' : 'asc'
  try {
    const stat = fs.statSync(filePath)
    const key = JSON.stringify([filePath, stat.mtimeMs, stat.size, wanted])
    if (!sampleCache || sampleCache.key !== key) {
      const size = Math.min(stat.size, SAMPLE_READ_CAP)
      const fd = fs.openSync(filePath, 'r')
      const buf = Buffer.alloc(size)
      const n = fs.readSync(fd, buf, 0, size, 0)
      fs.closeSync(fd)
      let text = buf.subarray(0, n).toString('utf-8')
      const truncated = stat.size > SAMPLE_READ_CAP
      if (truncated) text = text.slice(0, text.lastIndexOf('\n') + 1)   // 잘린 마지막 행을 버린다.
      const all = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true }).data
      if (all.length === 0) {
        sampleCache = { key, columns: [], rows: [], truncated, viewKey: '', view: [] }
      } else {
        const header = all[0].map((h) => String(h).trim())
        let start = 1
        const isConstraintRow = (r: string[]) => r.some((c) => c.trim()) && r.every((c) => !c.trim() || /^\[.*\]$/.test(c.trim()))
        const isTypeRow = (r: string[]) => r.some((c) => c.trim()) && r.every((c) => !c.trim() || /^\{.*\}$/.test(c.trim()))
        if (all[start] && isConstraintRow(all[start])) start++
        if (all[start] && isTypeRow(all[start])) start++
        const columns = wanted.filter((k) => header.includes(k))
        const idx = columns.map((k) => header.indexOf(k))
        const rows = all.slice(start).map((r) => idx.map((i) => String(r[i] ?? '')))
        sampleCache = { key, columns, rows, truncated, viewKey: '', view: [] }
      }
    }
    const cache = sampleCache
    const viewKey = JSON.stringify([skipBlank === true, sortCol, sortDir])
    if (cache.viewKey !== viewKey) {
      let view = cache.rows
      // 고른 컬럼의 값이 모두 비었거나 0인 행은 뺀다.
      if (skipBlank === true) view = view.filter((r) => r.some((v) => v.trim() !== '' && !/^[-+]?0+(\.0+)?$/.test(v.trim())))
      const ci = cache.columns.indexOf(sortCol)
      if (ci >= 0) {
        // 값이 모두 숫자면 숫자 크기로, 아니면 글자 순서로 비교한다. 빈 값은 방향과 상관없이 맨 뒤에 둔다.
        const numeric = cache.rows.every((r) => r[ci].trim() === '' || !Number.isNaN(Number(r[ci])))
        const sign = sortDir === 'desc' ? -1 : 1
        view = [...view].sort((a, b) => {
          const x = a[ci].trim(), y = b[ci].trim()
          if (x === '' || y === '') return x === y ? 0 : x === '' ? 1 : -1
          const c = numeric ? Number(x) - Number(y) : x.localeCompare(y, 'ko', { numeric: true })
          return c * sign
        })
      }
      cache.view = view
      cache.viewKey = viewKey
    }
    return {
      ok: true,
      reason: '',
      columns: cache.columns,
      rows: cache.view.slice(from, from + take),
      total: cache.view.length,
      hasMore: from + take < cache.view.length,
      truncated: cache.truncated,
    }
  } catch {
    return fail('unreadable')
  }
})
// ── Key 노트 끝 ─────────────────────────────────────────────────────────────────


ipcMain.handle('keyinfo:load', (_event, product: string | null) => {
  return loadKeyinfoData(getKeyinfoPath(product))
})

ipcMain.handle('keyinfo:savePins', (_event, product: string | null, pins: unknown[]) => {
  const p = getKeyinfoPath(product)
  const data = loadKeyinfoData(p)
  data.pinnedColumns = pins as KeyinfoData['pinnedColumns']
  saveKeyinfoData(p, data)
})

ipcMain.handle('keyinfo:saveLayout', (_event, product: string | null, pins: unknown[], folders: unknown[]) => {
  const p = getKeyinfoPath(product)
  const data = loadKeyinfoData(p)
  data.pinnedColumns = pins as KeyinfoData['pinnedColumns']
  data.folders = folders as KeyinfoFolder[]
  saveKeyinfoData(p, data)
})

// 강제 전체 재색인 — 이미 색인된 파일도 덮어씀
ipcMain.handle('keyinfo:reindex', async (event, product: string | null, fileSources: Record<string, { type: string; path?: string; localPath?: string }>) => {
  const p = getKeyinfoPath(product)
  const data = loadKeyinfoData(p)
  data.product = product

  const entries = Object.entries(fileSources)
  const total = entries.length
  if (total === 0) return data

  const sender = event.sender
  let done = 0
  sender.send('keyinfo:progress', { done, total })

  for (const [fileName, src] of entries) {
    const filePath = src.type === 'local' ? src.path : src.localPath
    if (filePath && fs.existsSync(filePath)) {
      try {
        const { columns, constraints, dbTypes } = parseCsvHeaderOnly(filePath)
        const entry: Record<string, KeyinfoColSchema> = {}
        for (const col of columns) {
          entry[col] = {
            ...(dbTypes[col] ? { dbType: dbTypes[col] } : {}),
            ...(constraints[col] ?? {}),
          }
        }
        data.schema[fileName] = entry
      } catch {}
    }
    done++
    sender.send('keyinfo:progress', { done, total })
  }

  saveKeyinfoData(p, data)
  return data
})

ipcMain.handle('keyinfo:index', async (event, product: string | null, fileSources: Record<string, { type: string; path?: string; localPath?: string }>) => {
  const p = getKeyinfoPath(product)
  const data = loadKeyinfoData(p)
  data.product = product

  const toIndex = Object.entries(fileSources).filter(([fileName]) => !data.schema[fileName])
  const total = toIndex.length

  if (total === 0) return data

  const sender = event.sender
  let done = 0
  sender.send('keyinfo:progress', { done, total })

  let changed = false
  for (const [fileName, src] of toIndex) {
    const filePath = src.type === 'local' ? src.path : src.localPath
    if (filePath && fs.existsSync(filePath)) {
      try {
        const { columns, constraints, dbTypes } = parseCsvHeaderOnly(filePath)
        const entry: Record<string, KeyinfoColSchema> = {}
        for (const col of columns) {
          entry[col] = {
            ...(dbTypes[col] ? { dbType: dbTypes[col] } : {}),
            ...(constraints[col] ?? {}),
          }
        }
        data.schema[fileName] = entry
        changed = true
      } catch {}
    }
    done++
    sender.send('keyinfo:progress', { done, total })
  }

  if (changed) saveKeyinfoData(p, data)
  return data
})
