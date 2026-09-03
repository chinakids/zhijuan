// Electron stub — 主进程模块的 node 冒烟用（提供最少的 app 路径能力；纯 ESM）
import path from 'node:path'
import os from 'node:os'

export const app = {
  getAppPath: () => process.env.ZJ_APP_PATH || path.resolve(import.meta.dirname, '..'),
  getPath: (name) => {
    if (name === 'documents') return path.join(os.homedir(), 'Documents')
    if (name === 'userData') return process.env.ZJ_USERDATA || '/tmp/zj-smoke-userdata'
    return '/tmp/zj'
  }
}
export const ipcMain = { handle: () => {} }
export const BrowserWindow = { getAllWindows: () => [] }
export const shell = { openExternal: () => {}, showItemInFolder: () => {} }
