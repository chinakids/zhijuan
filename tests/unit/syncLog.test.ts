import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// electron 是唯一外部依赖：把 userData/documents 指到临时目录（store.test 先例）
const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-synclog-'))
  return {
    tmp,
    userData: path.join(tmp, 'userData'),
    documents: path.join(tmp, 'documents')
  }
})

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? holder.userData : holder.documents) },
  shell: { trashItem: vi.fn() }
}))

import { setSettings } from '../../src/main/settings'
import { projectDir } from '../../src/main/store'
import { appendSyncLog, listSyncLog, clipLogError, syncLogPath, SYNC_LOG_CAP } from '../../src/main/agent/syncLog'

const PROJ = 'demo-aseya'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

beforeEach(() => {
  // 每次从干净库根出发（settings 内存态 + 磁盘均干净）
  setSettings({ libraryRoot: join(holder.tmp, '库根-' + Math.random().toString(36).slice(2)) })
})

function mkEntry(n: number) {
  return {
    time: 1_700_000_000_000 + n,
    chapter: `正文/第0${n}章_雾港.md`,
    slice: '雾港夜',
    castCount: 3,
    fileCount: 5,
    itemCount: n % 2,
    guardCount: n % 3 === 0 ? 1 : 0,
    ok: true
  }
}

describe('syncLog（切片同步历史日志）', () => {
  it('追加后能读回，且最新在前（reverse 口径）', () => {
    appendSyncLog(PROJ, mkEntry(1))
    appendSyncLog(PROJ, mkEntry(2))
    const l = listSyncLog(PROJ)
    expect(l).toHaveLength(2)
    expect(l[0].chapter).toBe('正文/第02章_雾港.md')
    expect(l[0].time).toBe(1_700_000_000_002)
    expect(l[1].chapter).toBe('正文/第01章_雾港.md')
  })

  it('日志落在 .zhijuan/sync-log.jsonl，一行一条 JSON（可 grep 可入 git）', () => {
    appendSyncLog(PROJ, mkEntry(1))
    const p = syncLogPath(PROJ)
    expect(existsSync(p)).toBe(true)
    const raw = readFileSync(p, 'utf-8')
    const lines = raw.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).chapter).toBe('正文/第01章_雾港.md')
  })

  it('失败条目记录 ok:false 与错误摘要（截断）', () => {
    appendSyncLog(PROJ, { ...mkEntry(1), ok: false, error: '模型回复未能解析为设定 JSON 数组（已重试一次仍失败）——原文节选：{...}' })
    const l = listSyncLog(PROJ)
    expect(l[0].ok).toBe(false)
    expect(l[0].error).toContain('模型回复未能解析')
  })

  it('文件不存在 / 空文件 → []', () => {
    expect(listSyncLog(PROJ + '-none')).toEqual([])
    // 空文件
    const p = syncLogPath(PROJ)
    mkdirSync(join(projectDir(PROJ), '.zhijuan'), { recursive: true })
    writeFileSync(p, '', 'utf-8')
    expect(listSyncLog(PROJ)).toEqual([])
  })

  it('损坏行跳过，其余照常返回', () => {
    appendSyncLog(PROJ, mkEntry(1))
    const p = syncLogPath(PROJ)
    writeFileSync(p, '{borken json', { flag: 'a' })
    writeFileSync(p, '\n' + JSON.stringify(mkEntry(2)) + '\n', { flag: 'a' })
    const l = listSyncLog(PROJ)
    expect(l).toHaveLength(2)
    expect(l[0].chapter).toBe('正文/第02章_雾港.md')
  })

  it('超过上限裁剪：只保留最新 SYNC_LOG_CAP 条', () => {
    for (let i = 1; i <= SYNC_LOG_CAP + 10; i++) appendSyncLog(PROJ, mkEntry(i))
    const l = listSyncLog(PROJ)
    expect(l).toHaveLength(SYNC_LOG_CAP)
    // 最新在前：首条应为最后追加的
    expect(l[0].chapter).toBe(`正文/第0${SYNC_LOG_CAP + 10}章_雾港.md`)
  })

  it('clipLogError：短串原样、长串截断到 120 字加省略号', () => {
    expect(clipLogError('短错误')).toBe('短错误')
    const long = '长'.repeat(200)
    const c = clipLogError(long)
    expect(c).toHaveLength(121)
    expect(c.endsWith('…')).toBe(true)
    expect(c.slice(0, 120)).toBe('长'.repeat(120))
  })

  it('append 对异常项目目录不抛出（旁路语义）', () => {
    expect(() => appendSyncLog('不存在项目-奇怪名/..', mkEntry(1))).not.toThrow()
  })
})
