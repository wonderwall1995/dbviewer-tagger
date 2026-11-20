import path from 'path'

// 작업 폴더 하나의 경로 묶음. 로직은 전역 경로 대신 이 묶음(ws)을 받는다.
// 데스크톱은 늘 하나의 ws를 쓰고, Web은 세션마다 다른 ws를 쓴다.
export interface Workspace {
  root: string
  localDir: string
  localFile: string
  sheetSettingsFile: string
  s3DownloadsRoot: string
  dbDownloadsRoot: string
  cacheDir: string
  tmpDir: string
  lorebookRoot: string
  productRoot: string
  productConfigDir: string
  productConfigFile: string
  docsKeyinfoDir: string
  keyinfoRelationsPath: string
  backupRoot: string
}

export function makeWorkspace(root: string): Workspace {
  const productRoot = path.join(root, 'local', 'product')
  return {
    root,
    localDir: path.join(root, 'local'),
    localFile: path.join(root, 'local', 'presets', 'local.json'),
    sheetSettingsFile: path.join(root, 'local', 'presets', 'sheet-settings.json'),
    s3DownloadsRoot: path.join(root, 'S3-downloads'),
    dbDownloadsRoot: path.join(root, 'DB-downloads'),
    cacheDir: path.join(root, 'local', 'tmp', 'cache'),
    tmpDir: path.join(root, 'local', 'tmp'),
    lorebookRoot: path.join(root, 'docs', 'lorebook'),
    productRoot,
    productConfigDir: path.join(productRoot, 'configure'),
    productConfigFile: path.join(productRoot, 'configure', 'config.json'),
    docsKeyinfoDir: path.join(root, 'docs', 'keyinfo'),
    keyinfoRelationsPath: path.join(root, 'docs', 'keyinfo', 'relations.json'),
    backupRoot: path.join(root, 'backups'),
  }
}
