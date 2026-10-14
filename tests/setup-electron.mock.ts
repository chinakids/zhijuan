// 全局 Electron mock：让 CI 无 Electron 二进制也能跑单测。
// 覆盖 src 里用到的 5 个 API：app / shell / dialog / Menu / BrowserWindow。
import { vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return '/tmp/vitest-electron-userData'
      if (name === 'documents') return '/tmp/vitest-electron-documents'
      return '/tmp/vitest-electron'
    },
    on: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn(),
    getName: vi.fn(() => 'zhijuan'),
  },
  shell: {
    trashItem: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    openPath: vi.fn().mockResolvedValue(undefined),
    showItemInFolder: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
    setApplicationMenu: vi.fn(),
  },
  BrowserWindow: vi.fn(() => ({
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    webContents: { on: vi.fn() },
    isDestroyed: vi.fn(() => false),
  })),
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  ipcRenderer: { on: vi.fn(), send: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn() },
}))
