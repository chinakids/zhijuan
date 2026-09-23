import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

// 同 store.test.ts 先例：electron 唯一外部依赖，getPath 指向临时目录，其余真实文件系统
const holder = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os') as { tmpdir(): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path') as { join(...a: string[]): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-wlog-'))
  return {
    tmp,
    userData: path.join(tmp, 'userData'),
    documents: path.join(tmp, '文档'),
    projects: () => path.join(tmp, 'projects')
  }
})

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? holder.userData : holder.documents) },
  shell: { trashItem: vi.fn() }
}))

import * as store from '../../src/main/store'
import { setSettings } from '../../src/main/settings'
import { listWriteLog, appendWriteLog, writeLogPath, WRITE_LOG_CAP, HEAD_LEN } from '../../src/main/writeLog'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

const PID = 'wlog-proj'
function freshProject() {
  setSettings({ workspace: join(holder.tmp, 'ws'), libraryRoot: holder.projects() })
  store.createProject(PID, '写盘审计测试')
}

beforeEach(() => {
  rmSync(holder.projects(), { recursive: true, force: true })
  freshProject()
})

describe('writeDoc 写盘审计（write-log.jsonl）', () => {
  it('正文内容变化写盘 → 记录 time/rel/prevLen/newLen/head', () => {
    const rel = '正文/第01章_雾.md'
    const v1 = '# 第一段\n\n正文初始。\n'
    const v2 = '# 第一段\n\n正文初始。改。\n'
    store.writeDoc(PID, rel, v1)
    // 首次写盘（文件不存在）与快照同条件：不记录
    expect(listWriteLog(PID)).toHaveLength(0)
    store.writeDoc(PID, rel, v2)
    const entries = listWriteLog(PID)
    expect(entries).toHaveLength(1)
    expect(entries[0].rel).toBe(rel)
    expect(entries[0].prevLen).toBe(v1.length)
    expect(entries[0].newLen).toBe(v2.length)
    expect(entries[0].head.length).toBeLessThanOrEqual(HEAD_LEN)
  })

  it('已存在正文、内容变化写盘 → 记录（P1 清空写盘的留档形态）', () => {
    const rel = '正文/第01章_雾.md'
    const orig = '# 雾\n\n凌晨两点，雾把栈桥吞了一半。\n'
    store.writeDoc(PID, rel, orig)
    // 模拟 P1 现场：正文被写成「仅约定头 92B」（真实种子 fm：题名雾港栈桥+韩青/林晓）
    const fmOnly = '---\n章号: 1\n题名: 雾港栈桥\n切片: 第一幕_夜\n涉及人物: [韩青, 林晓]\n---\n'
    store.writeDoc(PID, rel, fmOnly)
    const entries = listWriteLog(PID, '正文/')
    expect(entries).toHaveLength(1) // 首次写盘无快照条件故不记录
    expect(entries[0].prevLen).toBe(orig.length)
    expect(entries[0].newLen).toBe(fmOnly.length)
    expect(entries[0].head.slice(0, 30)).toContain('章号: 1')
    // 长度剧变一眼可辨：92B 形态（UTF-8 字节数）
    expect(Buffer.byteLength(fmOnly, 'utf-8')).toBe(92)
  })

  it('内容不变写盘 → 不记录（与快照同条件）', () => {
    const rel = '正文/第01章_雾.md'
    const orig = '# 雾\n\n内容。\n'
    store.writeDoc(PID, rel, orig)
    store.writeDoc(PID, rel, orig)
    const entries = listWriteLog(PID)
    expect(entries).toHaveLength(0)
  })

  it('非版本化 rel（人物/）写盘 → 不记录', () => {
    store.writeDoc(PID, '人物/韩青.md', '---\n姓名: 韩青\n---\n\n# 基础档案\n\n- 本职：市政维修处\n')
    store.writeDoc(PID, '人物/韩青.md', '---\n姓名: 韩青\n---\n\n# 基础档案\n\n- 本职：市政维修处\n- 习惯：眼睛总往天上瞟\n')
    expect(listWriteLog(PID)).toHaveLength(0)
  })

  it('listWriteLog 按 rel 前缀过滤且最新在前', () => {
    const a = '正文/第01章.md'
    const b = '正文/第02章.md'
    const c = '大纲/第01章.md'
    store.writeDoc(PID, a, '# v1\n')
    store.writeDoc(PID, a, '# a2\n') // 首次写不记录，改一次才留档
    store.writeDoc(PID, b, '# v1\n')
    store.writeDoc(PID, b, '# b1\n')
    store.writeDoc(PID, c, '# v1\n')
    store.writeDoc(PID, c, '# c1\n')
    const all = listWriteLog(PID)
    expect(all.length).toBe(3)
    const body = listWriteLog(PID, '正文/')
    expect(body.every((e) => e.rel.startsWith('正文/'))).toBe(true)
    expect(body[0].rel).toBe(b) // 最新在前
  })

  it('超限裁剪：超过 WRITE_LOG_CAP 保留最新', () => {
    const rel = '正文/第01章.md'
    store.writeDoc(PID, rel, '# x\n')
    for (let i = 0; i < WRITE_LOG_CAP + 20; i++) {
      appendWriteLog(PID, { time: Date.now() + i, rel, prevLen: 1, newLen: i, head: 'h' })
    }
    const entries = listWriteLog(PID, '正文/')
    expect(entries.length).toBeLessThanOrEqual(WRITE_LOG_CAP)
    expect(entries[0].newLen).toBe(WRITE_LOG_CAP + 19)
  })

  it('损坏行跳过、文件不存在返回 []', () => {
    expect(listWriteLog('不存在项目')).toEqual([])
    const p = writeLogPath(PID)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, '{"time":1,"rel":"正文/x.md","newLen":2,"prevLen":0,"head":"a"}\n坏行\n', 'utf-8')
    const entries = listWriteLog(PID)
    expect(entries.length).toBe(1)
  })
})
