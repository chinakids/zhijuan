import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { shutdownAgent } from './agent/ipc'
import { getSettings } from './settings'
import { registerMenuActions } from './menu'
import { installCrashHandlers, log, logError } from './log'

// 可见性 P1（2026-10-27）：入口最早安装全局捕获——此后任何未捕获异常/崩溃都落 userData/logs/main.log。
// 位置在 app.whenReady 之前：启动期（读设置/建窗）的失败同样是现场。
installCrashHandlers()

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

  // 白屏根因之二：页面没加载出来（dev server 没起/资源缺失）时此前只有控制台一行
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    log('error', `code=${code} desc=${desc} url=${url}`, 'did-fail-load')
  })
  win.webContents.on('unresponsive', () => {
    log('warn', '渲染层无响应（unresponsive）', 'renderer')
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
  log('info', `ready version=${app.getVersion()} electron=${process.versions['electron'] ?? '?'} packaged=${app.isPackaged} platform=${process.platform}/${process.arch}`, 'app')
  // 打包验收（ZHJUAN_SMOKE=1）：不进 GUI，直测主进程核心链路（引擎怠启动+设置）后退出
  // 用于无头环境验证发布包（2026-09-12 发布冲刺）
  if (process.env['ZHJUAN_SMOKE']) {
    try {
      const { ensureHarness } = await import('./agent/runtime')
      const err = await ensureHarness()
      const s = getSettings()
      console.log('ZHJUAN_SMOKE ' + JSON.stringify({ engineOnline: !err, engineErr: err ?? null, workspace: s.workspace, libraryRoot: s.libraryRoot, packaged: app.isPackaged }))
    } catch (e) {
      logError('smoke', e)
      console.log('ZHJUAN_SMOKE ' + JSON.stringify({ error: String((e as Error).message ?? e) }))
    }
    app.exit(0)
    return
  }
  registerIpc()
  // 系统菜单（docs/系统菜单-设计口径.md）：mac 菜单栏，主进程侧模板+动作分发（renderer 分发=下一刀）
  registerMenuActions()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  // 正常退出标记：下次排查时「最后一行不是 will-quit」即说明是被强杀/崩溃
  log('info', 'will-quit', 'app')
  shutdownAgent()
})
