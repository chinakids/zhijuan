// 主进程应用级日志（src/main/log.ts）：行格式 / 尾部读取 / 5MB 轮转 / 崩溃捕获安装（2026-10-27 可见性 P1）
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os') as { tmpdir(): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path') as { join(...a: string[]): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-applog-'))
  return { tmp, userData: path.join(tmp, 'userData') }
})

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? holder.userData : holder.tmp),
    getVersion: () => '0.0.0-test',
    on: vi.fn()
  }
}))

import {
  LOG_MAX_BYTES,
  __resetLogCacheForTest,
  formatError,
  formatLogLine,
  installCrashHandlers,
  log,
  logDir,
  logPath,
  logPathRotated,
  readLogTail,
  readTailLines
} from '../../src/main/log'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(logDir(), { recursive: true, force: true })
  __resetLogCacheForTest()
})

afterEach(() => {
  __resetLogCacheForTest()
})

describe('formatLogLine / formatError', () => {
  it('行格式稳定：ISO 时间 + 级别 + scope + 消息', () => {
    const line = formatLogLine('error', 'uncaughtException', 'boom', Date.UTC(2026, 9, 27, 1, 2, 3, 4))
    expect(line).toBe('2026-10-27T01:02:03.004Z [error] [uncaughtException] boom')
    // 无 scope 时不出现空方括号
    expect(formatLogLine('info', '', 'hi', 0)).toBe('1970-01-01T00:00:00.000Z [info] hi')
  })

  it('异常转文本：Error 带栈、字符串原样、对象 JSON、循环引用不抛', () => {
    const e = new Error('磁盘满')
    expect(formatError(e)).toContain('Error: 磁盘满')
    expect(formatError('纯字符串')).toBe('纯字符串')
    expect(formatError({ code: 'ENOSPC' })).toBe('{"code":"ENOSPC"}')
    const cyc: Record<string, unknown> = {}
    cyc['self'] = cyc
    expect(() => formatError(cyc)).not.toThrow()
    expect(formatError(null)).toBe('null')
  })
})

describe('写入 / 读取 / 轮转', () => {
  it('写入落在 userData/logs/main.log，readLogTail 取最后 N 行', () => {
    expect(logDir()).toBe(join(holder.userData, 'logs'))
    for (let i = 1; i <= 5; i++) log('info', `line-${i}`, 'test')
    expect(existsSync(logPath())).toBe(true)
    const tail = readLogTail(3)
    expect(tail).toHaveLength(3)
    expect(tail[2]).toContain('line-5')
    expect(tail.join('\n')).not.toContain('line-2')
    // 目录不存在时也能自建（首启场景）
    expect(statSync(logPath()).size).toBeGreaterThan(0)
  })

  it('超过 5MB 轮转为 main.log.1，新文件从空开始', () => {
    mkdirSync(logDir(), { recursive: true })
    writeFileSync(logPath(), 'x'.repeat(LOG_MAX_BYTES + 16), 'utf-8')
    __resetLogCacheForTest() // 让写入时的 stat 看到刚才的大文件
    log('warn', 'after-rotate', 'test')
    expect(existsSync(logPathRotated())).toBe(true)
    const cur = readFileSync(logPath(), 'utf-8')
    expect(cur).toContain('after-rotate')
    expect(cur.length).toBeLessThan(1024)
  })

  it('轮转后 readLogTail 跨两代补齐（崩溃前那几行还在）', () => {
    mkdirSync(logDir(), { recursive: true })
    writeFileSync(logPathRotated(), 'prev-1\nprev-2\n', 'utf-8')
    log('info', 'cur-1', 'test')
    const tail = readLogTail(3)
    expect(tail.join('\n')).toContain('prev-2')
    expect(tail.join('\n')).toContain('cur-1')
  })

  it('文件不存在时 readTailLines 返回空数组（不抛）', () => {
    expect(readTailLines(join(holder.tmp, 'nope.jsonl'), 10)).toEqual([])
  })
})

describe('installCrashHandlers', () => {
  it('幂等安装未捕获异常/未处理 Promise 捕获，并落盘', () => {
    const beforeUE = process.listenerCount('uncaughtException')
    const beforeUR = process.listenerCount('unhandledRejection')
    installCrashHandlers()
    installCrashHandlers()
    expect(process.listenerCount('uncaughtException')).toBe(beforeUE + 1)
    expect(process.listenerCount('unhandledRejection')).toBe(beforeUR + 1)

    process.emit('uncaughtException', new Error('boom-from-test'))
    expect(readLogTail(20).join('\n')).toContain('boom-from-test')
  })
})
