import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-pres-'))
  return { tmp, userData: path.join(tmp, 'userData'), documents: path.join(tmp, 'doc') }
})

vi.mock('electron', () => ({
  app: { getPath: (n: string) => (n === 'userData' ? holder.userData : holder.documents) },
  shell: {}
}))
vi.mock('../../src/main/store', () => ({
  readDoc: vi.fn(),
  writeDoc: vi.fn(),
  listChapters: vi.fn(),
  listDocs: vi.fn()
}))
vi.mock('../../src/main/agent/runtime', () => ({ driveSession: vi.fn() }))

import { listedFrom, parseAliases, presenceCheck } from '../../src/shared/presence'
import { runPresence } from '../../src/main/agent/audit'
import { setSettings } from '../../src/main/settings'
import { readDoc, listDocs } from '../../src/main/store'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

const readMock = vi.mocked(readDoc)
const listDocsMock = vi.mocked(listDocs)

beforeEach(() => {
  vi.clearAllMocks()
  setSettings({ capabilities: {}, workspace: '', libraryRoot: '' })
})

const fm = (listed: string[] | string) => {
  const v = Array.isArray(listed) ? '[' + listed.join(', ') + ']' : String(listed)
  return `---\n章号: 1\n题名: 雾港\n切片: 第一幕\n涉及人物: ${v}\n---\n`
}

describe('listedFrom（约定头「涉及人物」解析）', () => {
  it('数组写法 / 字符串写法 / [a, b] 字符串写法 / 缺省都收', () => {
    expect(listedFrom({ '涉及人物': ['阿七', '沈藏'] })).toEqual(['阿七', '沈藏'])
    expect(listedFrom({ '涉及人物': '阿七' })).toEqual(['阿七'])
    expect(listedFrom({ '涉及人物': '[阿七, 沈藏]' })).toEqual(['阿七', '沈藏'])
    expect(listedFrom({})).toEqual([])
  })
})

describe('presenceCheck（人物在场核查纯函数）', () => {
  const chapter = (file: string, listed: string[] | string, body: string) => ({
    file,
    raw: fm(listed) + body
  })

  it('missing：涉及人物列了但正文未出现署名 → medium 条目', () => {
    const r = presenceCheck({
      knownChars: [],
      chapters: [chapter('正文/第02章_灯塔.md', ['阿七'], '雨还在下。沈藏没有说话。')]
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({
      severity: 'medium',
      type: 'character',
      where: '雾港（正文/第02章_灯塔.md）',
      suggest: expect.stringContaining('阿七')
    })
    expect(r.summary).toContain('1 章与「涉及人物」不一致')
  })

  it('unlisted：正文出现署名但约定头没列 → low 条目（需 knownChars 提供）', () => {
    const r = presenceCheck({
      knownChars: ['沈藏'],
      chapters: [chapter('正文/第01章_雾港.md', ['阿七'], '阿七回头。沈藏点了根烟。')]
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ severity: 'low', what: expect.stringContaining('沈藏') })
  })

  it('单字名与不在档案清单的名字不参与机械匹配', () => {
    const r = presenceCheck({
      knownChars: ['顾', '沈藏'],
      chapters: [chapter('正文/第01章_雾港.md', ['顾'], '顾站在门口。沈藏走进来。')]
    })
    // 单字「顾」不参与（不报 missing）；「沈藏」出现但未列 → 只有 1 条 unlisted
    expect(r.items).toHaveLength(1)
    expect(r.items[0].what).toContain('沈藏')
  })

  it('全一致 → 空条目 + 「全部与约定头一致」摘要', () => {
    const r = presenceCheck({
      knownChars: ['阿七'],
      chapters: [chapter('正文/第01章_雾港.md', ['阿七'], '阿七提着灯。')]
    })
    expect(r.items).toHaveLength(0)
    expect(r.summary).toContain('全部与约定头「涉及人物」一致')
  })

  it('无正文章节 → 提示无章节', () => {
    const r = presenceCheck({ knownChars: [], chapters: [] })
    expect(r.items).toHaveLength(0)
    expect(r.summary).toContain('还没有正文章节')
  })

  it('无 front matter 的文档（正文裸文件）：listed 为空，仍能检 unlisted', () => {
    const r = presenceCheck({
      knownChars: ['沈藏'],
      chapters: [{ file: '正文/散记.md', raw: '沈藏推门进来。' }]
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ severity: 'low', where: '散记（正文/散记.md）' })
  })
})

describe('parseAliases（人物档案约定头「别名」解析）', () => {
  it('数组写法 / 字符串写法 / [a, b] 字符串写法 / 缺省都收', () => {
    expect(parseAliases({ '别名': ['小七', '七爷'] })).toEqual(['小七', '七爷'])
    expect(parseAliases({ '别名': '小七' })).toEqual(['小七'])
    expect(parseAliases({ '别名': '[小七, 七爷]' })).toEqual(['小七', '七爷'])
    expect(parseAliases({})).toEqual([])
    expect(parseAliases(null)).toEqual([])
  })
})

describe('presenceCheck 别名规则（机械层第三块·称谓一致性）', () => {
  const chapter = (file: string, listed: string[] | string, body: string) => ({
    file,
    raw: fm(listed) + body
  })

  it('missing 豁免：涉及人物列了、本名未出现但登记别名出现 → 不报（角色在场，只用别名）', () => {
    const r = presenceCheck({
      knownChars: ['阿七'],
      aliasMap: { 阿七: ['小七'] },
      chapters: [chapter('正文/第02章_灯塔.md', ['阿七'], '小七低着头，没有说话。')]
    })
    expect(r.items).toHaveLength(0)
    expect(r.summary).toContain('全部与约定头「涉及人物」一致')
  })

  it('unlisted（别名命中）：正文出现别名、约定头未列 → low，what 指明别名归属', () => {
    const r = presenceCheck({
      knownChars: ['沈藏'],
      aliasMap: { 沈藏: ['沈爷'] },
      chapters: [chapter('正文/第01章_雾港.md', ['阿七'], '阿七回头。沈爷点了根烟。')]
    })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ severity: 'low' })
    expect(String(r.items[0].what)).toContain('沈爷')
    expect(String(r.items[0].what)).toContain('沈藏')
  })

  it('别名冲突：同一别名被两个及以上人物登记 → medium 一条（与章无关）', () => {
    const r = presenceCheck({
      knownChars: ['阿七', '沈藏'],
      aliasMap: { 阿七: ['老七'], 沈藏: ['老七'] },
      chapters: [chapter('正文/第01章_雾港.md', ['阿七'], '阿七提着灯。')]
    })
    const conflict = r.items.find((i) => i.what.includes('别名'))
    expect(conflict).toBeDefined()
    expect(conflict).toMatchObject({ severity: 'medium', where: expect.stringContaining('阿七、沈藏') })
    expect(r.summary).toContain('别名冲突 1 处')
  })

  it('未登记别称仍不参与（口径不变）：无 aliasMap 时行为同旧版', () => {
    const r = presenceCheck({
      knownChars: ['阿七'],
      chapters: [chapter('正文/第02章_灯塔.md', ['阿七'], '小七低着头，没有说话。')]
    })
    expect(r.items).toHaveLength(1) // 未登记「小七」→ 仍报 missing
  })
})

describe('runPresence（主进程：读人物档案题名 + 全卷正文后交给纯函数）', () => {
  it('过滤总览、子目录取末段、跳过空正文；正常输出 ok', () => {
    listDocsMock.mockImplementation((_id: string, dir: string) =>
      dir === '人物'
        ? [
            { file: '阿七.md', name: '阿七', mtime: 1 },
            { file: '总览.md', name: '总览', mtime: 1 },
            { file: '配角组/沈藏.md', name: '沈藏', mtime: 1 }
          ]
        : [{ file: '第01章_雾港.md', name: '第01章_雾港', mtime: 1 }]
    )
    readMock.mockImplementation((_id: string, rel: string) => (rel.endsWith('.md') && rel.startsWith('正文/') ? fm(['阿七']) + '阿七提着灯。' : null))
    const r = runPresence('demo')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.items).toHaveLength(0) // 阿七已列且出现；沈藏未出现
      expect(r.result.summary).toContain('全部与约定头「涉及人物」一致')
    }
  })

  it('读取人物档案约定头「别名」，别名命中未列 → unlisted', () => {
    listDocsMock.mockImplementation((_id: string, dir: string) =>
      dir === '人物'
        ? [{ file: '沈藏.md', name: '沈藏', mtime: 1 }]
        : [{ file: '第01章_雾港.md', name: '第01章_雾港', mtime: 1 }]
    )
    readMock.mockImplementation((_id: string, rel: string) => {
      if (rel.startsWith('人物/')) return '---\n姓名: 沈藏\n别名: [沈爷]\n---\n# 沈藏\n'
      if (rel.startsWith('正文/')) return fm(['阿七']) + '阿七回头。沈爷点了根烟。'
      return null
    })
    const r = runPresence('demo')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.items).toHaveLength(1)
      expect(String(r.result.items[0].what)).toContain('沈爷')
      expect(r.result.items[0].severity).toBe('low')
    }
  })
})
