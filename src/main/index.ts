import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { shutdownAgent } from './agent/ipc'
import { getSettings } from './settings'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

function createWindow() {
  const theme = getSettings().theme
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    title: '织卷',
    backgroundColor: theme === 'dark' ? '#141414' : '#fbf9f4',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']!)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 自动截图（内部调试用）：ZHJUAN_SHOT=1 时在页面加载后截一张并退出
  if (process.env['ZHJUAN_SHOT']) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win.webContents.capturePage()
        const { writeFileSync } = await import('fs')
        writeFileSync(process.env['ZHJUAN_SHOT']!, img.toPNG())
        app.quit()
      }, 3000)
    })
  }
}

app.whenReady().then(async () => {
  // 打包验收（ZHJUAN_SMOKE=1）：不进 GUI，直测主进程核心链路（引擎怠启动+设置）后退出
  // 用于无头环境验证发布包（2026-09-12 发布冲刺）
  if (process.env['ZHJUAN_SMOKE']) {
    try {
      const { ensureHarness } = await import('./agent/runtime')
      const err = await ensureHarness()
      const s = getSettings()
      console.log('ZHJUAN_SMOKE ' + JSON.stringify({ engineOnline: !err, engineErr: err ?? null, workspace: s.workspace, libraryRoot: s.libraryRoot, packaged: app.isPackaged }))
    } catch (e) {
      console.log('ZHJUAN_SMOKE ' + JSON.stringify({ error: String((e as Error).message ?? e) }))
    }
    app.exit(0)
    return
  }
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  shutdownAgent()
})
