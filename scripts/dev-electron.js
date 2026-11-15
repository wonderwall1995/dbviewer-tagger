const electron = require('electron')
const { spawnSync } = require('child_process')
const env = Object.assign({}, process.env)
delete env.ELECTRON_RUN_AS_NODE
const result = spawnSync(electron, ['.'], { stdio: 'inherit', env })
process.exit(result.status ?? 0)
