// ===== 应用级日志与全局崩溃捕获（2026-10-27 可见性 P1）=====
// 背景：主进程此前的所有异常只落在控制台——打包后用户看不到；一次渲染异常即白屏且无痕。
// 本文件是**唯一**主进程日志出口：写 userData/logs/main.log（超 5MB 轮转为 main.log.1），
// 并提供 installCrashHandlers() 捕获未处理异常/未处理 Promise/渲染进程与子进程退出。
// 三条铁律：
//   1) 日志自身绝不抛（写盘失败静默——不能让「记录失败」变成新的崩溃源）；
//   2) 不改变退出语义（只写日志，不调 app.exit/app.quit）；
//   3) 行格式稳定（`ISO时间 [级别] [scope] 消息`），设置页「导出诊断」按行尾读取。
import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** 轮转阈值（5MB；超出后当前文件改名为 main.log.1，新文件重开） */
export const LOG_MAX_BYTES = 5 * 1024 * 1024

let cachedDir: string | null = null
/** 已知当前日志字节数；-1 = 未知（下次写入时 stat 一次） */
let cachedBytes = -1

/** 日志目录：userData/logs（app 未就绪/取不到时退回 ~/.zhijuan/logs） */
export function logDir(): string {
  if (cachedDir) return cachedDir
  let base: string
  try {
    base = app.getPath('userData')
  } catch {
    base = join(homedir(), '.zhijuan')
  }
  cachedDir = join(base, 'logs')
  return cachedDir
}

/** 当前日志文件 */
export function logPath(): string {
  return join(logDir(), 'main.log')
}

/** 轮转归档（单份，覆盖上一份；日志是排障线索不是审计档案，保留两代足够） */
export function logPathRotated(): string {
  return join(logDir(), 'main.log.1')
}

/** 一行日志文本（纯函数，单测直测；iso 时间可在测试里固定） */
export function formatLogLine(level: LogLevel, scope: string, message: string, at: number = Date.now()): string {
  const head = `${new Date(at).toISOString()} [${level}]${scope ? ` [${scope}]` : ''} `
  return head + message
}

/** 任意异常/值 → 可读文本（Error 带栈；其余 JSON 兜底，JSON 本身失败再 String） */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    const stack = err.stack && !err.stack.includes(err.message) ? `\n${err.stack}` : (err.stack ?? '')
    return `${err.name}: ${err.message}${stack}`
  }
  if (typeof err === 'string') return err
  if (err === null || err === undefined) return String(err)
  if (typeof err === 'object') {
    try {
      return JSON.stringify(err)
    } catch {
      // 循环引用等：退回 String
    }
  }
  return String(err)
}

/** 超阈值则把当前文件改名为 .1（POSIX rename 覆盖同名） */
function rotateIfNeeded(): void {
  try {
    const p = logPath()
    if (cachedBytes < 0) cachedBytes = existsSync(p) ? statSync(p).size : 0
    if (cachedBytes < LOG_MAX_BYTES) return
    if (existsSync(p)) renameSync(p, logPathRotated())
    cachedBytes = 0
  } catch {
    cachedBytes = -1
  }
}

/** 写一条日志（同步追加：崩溃现场也要落盘；任何异常静默） */
export function log(level: LogLevel, message: string, scope = ''): void {
  const line = formatLogLine(level, scope, String(message ?? ''))
  try {
    mkdirSync(logDir(), { recursive: true })
    rotateIfNeeded()
    appendFileSync(logPath(), line + '\n', 'utf-8')
    if (cachedBytes >= 0) cachedBytes += Buffer.byteLength(line, 'utf-8') + 1
  } catch {
    // 日志自身绝不抛（见文件头铁律 1）
  }
}

/** 记一条异常（带 scope，便于按来源过滤） */
export function logError(scope: string, err: unknown): void {
  log('error', formatError(err), scope)
}

/** 读文件尾部 N 行（文件不存在/读失败返回 []；损坏无关，按原始行读——取证日志就是原始行） */
export function readTailLines(path: string, maxLines = 40): string[] {
  try {
    const raw = readFileSync(path, 'utf-8')
    if (!raw) return []
    const lines = raw.split('\n').filter((l) => l.length > 0)
    return lines.slice(-maxLines)
  } catch {
    return []
  }
}

/** 主进程日志尾部：当前文件不够就从 main.log.1 补（跨轮转也能看到崩溃前那几行） */
export function readLogTail(maxLines = 200): string[] {
  let lines = readTailLines(logPath(), maxLines)
  if (lines.length < maxLines) {
    const prev = readTailLines(logPathRotated(), maxLines)
    if (prev.length) lines = prev.concat(lines).slice(-maxLines)
  }
  return lines
}

let installed = false

/** 仅测试用：清掉目录/字节缓存（同一进程内多组用例共用 log.ts 时避免相互污染） */
export function __resetLogCacheForTest(): void {
  cachedDir = null
  cachedBytes = -1
}

/** 安装全局崩溃/异常捕获（index.ts 入口最早调用；重复调用幂等） */
export function installCrashHandlers(): void {
  if (installed) return
  installed = true

  // 主进程未捕获异常：只记录，不 exit（保持既有退出语义——Electron 主进程默认也不因它退出）
  process.on('uncaughtException', (err) => {
    logError('uncaughtException', err)
    try {
      console.error('[zhijuan] uncaughtException', err)
    } catch {
      // 控制台不可用（无 tty）时忽略
    }
  })
  process.on('unhandledRejection', (reason) => {
    logError('unhandledRejection', reason)
  })

  // 渲染进程崩溃（白屏根因之一：GPU/JS 崩溃后窗口只剩空白，此前无痕）
  app.on('render-process-gone', (_event, webContents, details) => {
    let url = ''
    try {
      url = webContents?.getURL?.() ?? ''
    } catch {
      url = '(无法读取 URL)'
    }
    log('error', `reason=${details?.reason ?? '?'} exitCode=${details?.exitCode ?? '?'} url=${url}`, 'render-process-gone')
  })

  // 子进程退出（写作引擎 / GPU / utility）：引擎崩溃时设置页「引擎离线」的原因就在这里
  app.on('child-process-gone', (_event, details) => {
    log('error', `type=${details?.type ?? '?'} reason=${details?.reason ?? '?'} exitCode=${details?.exitCode ?? '?'} name=${details?.name ?? '?'}`, 'child-process-gone')
  })
}
