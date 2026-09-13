// Electron stub — 主进程模块的 node 冒烟用（提供最少的 app 路径能力；纯 ESM）
import path from 'node:path'
import os from 'node:os'

export const app = {
  getAppPath: () => process.env.ZJ_APP_PATH || path.resolve(import.meta.dirname, '..'),
  getPath: (name) => {
    if (name === 'documents') return path.join(os.homedir(), 'Documents')
    if (name === 'userData') return process.env.ZJ_USERDATA || '/tmp/zj-smoke-userdata'
    return '/tmp/zj'
  },
  getVersion: () => '0.0.0-stub',
  setAboutPanelOptions: (opts) => { app._aboutPanel = opts },
  showAboutPanel: () => { app._about = (app._about || 0) + 1 }
}
export const ipcMain = {
  handle: () => {},
  on: (channel, fn) => {
    if (!ipcMain._listeners) ipcMain._listeners = {}
    ipcMain._listeners[channel] = [...(ipcMain._listeners[channel] ?? []), fn]
  },
  _listeners: null,
  emit: (channel, ...args) => {
    for (const fn of ipcMain._listeners?.[channel] ?? []) fn({}, ...args)
  }
}
export const BrowserWindow = { getAllWindows: () => [], getFocusedWindow: () => null }
export const shell = { openExternal: () => {}, showItemInFolder: (p) => { shell._shown = p }, trashItem: async (p) => { const fsp = await import('node:fs/promises'); await fsp.rm(p, { recursive: true, force: true }) } }
export const Menu = {
  _appMenu: null,
  setApplicationMenu: (m) => { Menu._appMenu = m },
  getApplicationMenu: () => Menu._appMenu,
  buildFromTemplate: (t) => {
    const byId = new Map()
    const walk = (items) => {
      for (const it of items) {
        if (typeof it.id === 'string') byId.set(it.id, it)
        if (Array.isArray(it.submenu)) walk(it.submenu)
      }
    }
    walk(t)
    return { template: t, getMenuItemById: (id) => byId.get(id) ?? null }
  }
}
export const dialog = {
  _about: 0,
  showAboutPanel: () => { dialog._about++ }
}
