import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-persp-'))
  return { tmp, userData: path.join(tmp, 'userData'), documents: path.join(tmp, 'doc') }
})

vi.mock('electron', () => ({
  app: { getPath: (n: string) => (n === 'userData' ? holder.userData : holder.documents) },
  shell: {}
}))
vi.mock('../../src/main/store', () => ({
  readDoc: vi.fn(),
  listChapters: vi.fn(),
  listDocs: vi.fn()
}))
vi.mock('../../src/main/agent/runtime', () => ({ driveSession: vi.fn() }))

import { extractPerspective, runAudit } from '../../src/main/agent/audit'
import { driveSession } from '../../src/main/agent/runtime'
import { listCapabilities } from '../../src/main/agent/subtask'
import { setSettings } from '../../src/main/settings'
import { readDoc, listChapters, listDocs } from '../../src/main/store'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

const driveMock = vi.mocked(driveSession)
const readMock = vi.mocked(readDoc)
const listChaptersMock = vi.mocked(listChapters)
const listDocsMock = vi.mocked(listDocs)

beforeEach(() => {
  vi.clearAllMocks()
  setSettings({ capabilities: {}, workspace: '', libraryRoot: '' })
})

describe('extractPerspective（多视角审读提取）', () => {
  it('保留 viewer；target 只在现有设定档案里才留，防编造', () => {
    const known = new Set(['人物/顾岸.md', '世界观/切片_灯塔.md'])
    const out = extractPerspective(
      '```json\n' +
        '{"summary":"设定党最在意灯塔重新点灯","items":[' +
        '{"viewer":"设定党","severity":"high","type":"setting","where":"第4章","what":"灯塔被写重新点灯","suggest":"补设定","target":"世界观/切片_灯塔.md"},' +
        '{"viewer":"角色粉","severity":"medium","type":"character","where":"第2章","what":"顾岸怕水却走夜潮","suggest":"给由头","target":"人物/不存在的人.md"},' +
        '{"viewer":"局外人","severity":"low","type":"pacing","where":"第3章","what":"节奏拖","suggest":"提前事件"}' +
        ']}\n' +
        '```',
      known
    )
    expect(out.summary).toContain('灯塔')
    expect(out.items).toHaveLength(3)
    // 真实存在的 target 保留
    expect(out.items[0].target).toBe('世界观/切片_灯塔.md')
    expect(out.items[0].viewer).toBe('设定党')
    // 编造的文件被剥掉 target
    expect(out.items[1].target).toBeUndefined()
    // 不认识的 viewer 也保留原串（只是不带展示名）
    expect(out.items[2].viewer).toBe('局外人')
  })

  it('散文化回复 → items 空；无数据整体返回空结构', () => {
    const out = extractPerspective('这一遍读下来感觉内容还挺顺的，整体没什么大问题。')
    expect(out.items).toEqual([])
    const blank = extractPerspective('{"summary":"","items":[]}')
    expect(blank.items).toEqual([])
    expect(blank.summary).toBe('')
  })
})

describe('runAudit 多视角审视（走子任务骨架）', () => {
  it('真实材料包被组装（含全部章节与设定档案），结果带 viewer 原样返回', async () => {
    readMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第1章_雾.md': '---\n章号: 1\n题名: 雾\n切片: 第一幕\n涉及人物: [顾岸]\n---\n顾岸的旧车是烟青色。',
        '人物/顾岸.md': '顾岸：怕水。',
        '世界观/切片_灯塔.md': '灯塔已废弃二十年。'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([{ file: '第1章_雾.md', name: '第1章_雾', fm: { 章号: 1 }, wordCount: 0, mtime: 0, hasPendingProposal: false }] as never)
    listDocsMock.mockImplementation((_id: string, dir: string) =>
      dir === '人物'
        ? [{ file: '顾岸.md', name: '顾岸', mtime: 0 }]
        : dir === '世界观'
          ? [{ file: '切片_灯塔.md', name: '切片_灯塔', mtime: 0 }]
          : []
    )

    driveMock.mockResolvedValue(
      '{"summary":"最要紧的是灯塔设定","items":[{"viewer":"设定党","severity":"high","type":"setting","where":"正文/第1章_雾.md","what":"灯塔提了一嘴","suggest":"补设定","target":"世界观/切片_灯塔.md"}]}'
    )
    const r = await runAudit('pj', 'perspectives')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.result.items).toHaveLength(1)
      expect(r.result.items[0].viewer).toBe('设定党')
      expect(r.result.items[0].target).toBe('世界观/切片_灯塔.md')
    }
    expect(driveMock).toHaveBeenCalledTimes(1)
    const prompt = driveMock.mock.calls[0][1]
    expect(prompt).toContain('多视角审读团')
    expect(prompt).toContain('角色粉')
    expect(prompt).toContain('顾岸的旧车')
    expect(prompt).toContain('世界观/切片_灯塔.md')
  })

  it('能力注册表里有 perspectives（设置页可开关）', () => {
    const all = listCapabilities()
    const p = all.find((c) => c.id === 'perspectives')
    expect(p?.title).toBe('多视角审视')
  })

  it('设置里关闭 perspectives → 短路返回并告知原因', async () => {
    setSettings({ capabilities: { perspectives: false }, workspace: '', libraryRoot: '' })
    const r = await runAudit('pj', 'perspectives')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('关闭')
    expect(driveMock).not.toHaveBeenCalled()
  })
})
