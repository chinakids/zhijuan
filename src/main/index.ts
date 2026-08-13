import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { registerStoreIpc } from './store'
import { registerGenIpc } from './generator'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    title: '织卷',
    backgroundColor: '#0f1115',
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
      }, 2500)
    })
  }
}

app.whenReady().then(() => {
  registerStoreIpc()
  registerGenIpc()
  ipcMain.handle('app:getPaths', () => ({
    documents: app.getPath('documents')
  }))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
