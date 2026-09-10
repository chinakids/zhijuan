import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

// recent.ts 唯一外部依赖是 electron.app.getPath；测试里指向临时 userData，其余走真实文件系统
const holder = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('node:os') as { tmpdir(): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path') as { join(...a: string[]): string }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-recent-'))
  return {
    tmp,
    userData: path.join(tmp, 'userData')
  }
})

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? holder.userData : holder.tmp) },
  shell: { trashItem: vi.fn() }
}))

import { getRecentEntries, recordOpen, removeRecent, MAX_RECENTS } from '../../src/main/recent'

function recentsFile() {
  return join(holder.userData, 'zhijuan-recents.json')
}

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

beforeEach(() => {
  rmSync(recentsFile(), { force: true })
})

describe('recent（最近打开项目记录）', () => {
  it('无文件时返回空数组', () => {
    expect(getRecentEntries()).toEqual([])
  })

  it('recordOpen 写入后能读回（真实落盘），最新在前', () => {
    recordOpen('p1')
    recordOpen('p2')
    const out = getRecentEntries()
    expect(out.map((e) => e.id)).toEqual(['p2', 'p1'])
    expect(existsSync(recentsFile())).toBe(true)
    expect(out.every((e) => typeof e.openedAt === 'number')).toBe(true)
  })

  it('重复打开同一项目：去重并置顶（时间戳刷新）', () => {
    recordOpen('p1')
    recordOpen('p2')
    recordOpen('p1')
    expect(getRecentEntries().map((e) => e.id)).toEqual(['p1', 'p2'])
  })

  it('超过上限只保留最近 MAX_RECENTS 条', () => {
    for (let i = 0; i < MAX_RECENTS + 5; i++) recordOpen('p' + i)
    const out = getRecentEntries()
    expect(out).toHaveLength(MAX_RECENTS)
    expect(out[0]!.id).toBe('p' + (MAX_RECENTS + 4))
  })

  it('文件损坏时容错为空数组', () => {
    mkdirSync(holder.userData, { recursive: true })
    writeFileSync(recentsFile(), '{{not json', 'utf-8')
    expect(getRecentEntries()).toEqual([])
  })

  it('removeRecent：删除项目后残留记录被清掉', () => {
    recordOpen('pa')
    recordOpen('pb')
    recordOpen('pc')
    removeRecent('pb')
    const out = getRecentEntries()
    expect(out.map((e) => e.id)).toEqual(['pc', 'pa'])
  })

  it('文件里混入非法条目（缺字段）被过滤', () => {
    mkdirSync(holder.userData, { recursive: true })
    writeFileSync(recentsFile(), JSON.stringify([{ id: 'a', openedAt: 1 }, { id: 'b' }, { openedAt: 2 }, 'x']), 'utf-8')
    expect(getRecentEntries().map((e) => e.id)).toEqual(['a'])
  })
})
