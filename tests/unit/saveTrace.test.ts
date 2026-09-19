import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

// 同 writeLog.test.ts 先例：electron 唯一外部依赖，getPath 指向临时目录，其余真实文件系统
const holder = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os') as { tmpdir(): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path') as { join(...a: string[]): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-strace-'))
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
import { listSaveTrace, appendSaveTrace, saveTracePath, SAVE_TRACE_CAP } from '../../src/main/saveTrace'
import type { SaveTraceEntry } from '../../src/shared/types'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

const PID = 'strace-proj'
function freshProject() {
  setSettings({ workspace: join(holder.tmp, 'ws'), libraryRoot: holder.projects() })
  store.createProject(PID, '保存取证测试')
}

function entry(over: Partial<SaveTraceEntry> = {}): SaveTraceEntry {
  return {
    time: 1000,
    mdLen: 0,
    status: 'dirty',
    epoch: 3,
    confirmEmpty: false,
    diskBodyLen: -1,
    action: 'write',
    ...over
  }
}

beforeEach(() => {
  rmSync(holder.projects(), { recursive: true, force: true })
  freshProject()
})

describe('渲染层保存取证（save-trace.jsonl）', () => {
  it('append 后 list 返回且 rel 由调用方合成', () => {
    appendSaveTrace(PID, '正文/第01章_雾.md', entry({ mdLen: 123, status: 'saved', epoch: 7 }))
    const list = listSaveTrace(PID)
    expect(list).toHaveLength(1)
    expect(list[0].rel).toBe('正文/第01章_雾.md')
    expect(list[0].mdLen).toBe(123)
    expect(list[0].status).toBe('saved')
    expect(list[0].epoch).toBe(7)
    expect(list[0].confirmEmpty).toBe(false)
    expect(list[0].diskBodyLen).toBe(-1)
    expect(list[0].action).toBe('write')
  })

  it('P1 现场形态：空 md 被拦（action=blocked 且 diskBodyLen>0）可一眼回放', () => {
    appendSaveTrace(PID, '正文/第01章_雾.md', entry({ mdLen: 0, status: 'dirty', diskBodyLen: 761, action: 'blocked' }))
    appendSaveTrace(PID, '正文/第01章_雾.md', entry({ mdLen: 0, status: 'dirty', diskBodyLen: 761, action: 'allow-empty', confirmEmpty: true }))
    const list = listSaveTrace(PID)
    expect(list.map((e) => e.action)).toEqual(['allow-empty', 'blocked']) // 最新在前
  })

  it('action 过滤：只取 blocked', () => {
    appendSaveTrace(PID, '正文/a.md', entry({ action: 'write' }))
    appendSaveTrace(PID, '正文/a.md', entry({ action: 'blocked' }))
    const blocked = listSaveTrace(PID, 'blocked')
    expect(blocked).toHaveLength(1)
    expect(blocked[0].action).toBe('blocked')
    expect(listSaveTrace(PID, 'aborted')).toHaveLength(0)
  })

  it('超限裁剪：超过 SAVE_TRACE_CAP 保留最新', () => {
    for (let i = 0; i < SAVE_TRACE_CAP + 20; i++) {
      appendSaveTrace(PID, '正文/a.md', entry({ time: 1000 + i, mdLen: i }))
    }
    const list = listSaveTrace(PID)
    expect(list.length).toBeLessThanOrEqual(SAVE_TRACE_CAP)
    expect(list[0].time).toBe(1000 + SAVE_TRACE_CAP + 19)
  })

  it('损坏行跳过、字段缺失行跳过、文件不存在返回 []', () => {
    expect(listSaveTrace('不存在项目')).toEqual([])
    const p = saveTracePath(PID)
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(
      p,
      '{"time":1,"rel":"正文/a.md","mdLen":2,"status":"idle","epoch":0,"confirmEmpty":false,"diskBodyLen":-1,"action":"write"}\n坏行\n{"time":3,"rel":"正文/b.md"}\n',
      'utf-8'
    )
    const list = listSaveTrace(PID)
    expect(list.length).toBe(1)
    expect(list[0].rel).toBe('正文/a.md')
  })

  it('list 最新在前：两条时间倒序', () => {
    appendSaveTrace(PID, '正文/a.md', entry({ time: 100 }))
    appendSaveTrace(PID, '正文/a.md', entry({ time: 200 }))
    const list = listSaveTrace(PID)
    expect(list[0].time).toBe(200)
    expect(list[1].time).toBe(100)
  })

  it('append 异常不抛（旁路：非法路径被吞），list 异常返回 []', () => {
    // macOS/Node 对含 NUL 的路径抛 ERR_INVALID_ARG_VALUE——真正的「异常旁路」验证面
    expect(() => appendSaveTrace('bad\u0000id', '正文/a.md', entry())).not.toThrow()
    expect(listSaveTrace('bad\u0000id')).toEqual([])
  })
})
