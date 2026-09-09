import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'

const holder = vi.hoisted(() => {
  const os = require('node:os') as { tmpdir(): string }
  const path = require('node:path') as { join(...a: string[]): string }
  const fs = require('node:fs') as { mkdtempSync(p: string): string }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zj-audrep-'))
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

import { auditToMarkdown, auditReportRel, runAudit } from '../../src/main/agent/audit'
import { driveSession } from '../../src/main/agent/runtime'
import { setSettings } from '../../src/main/settings'
import { readDoc, writeDoc, listChapters, listDocs } from '../../src/main/store'

afterAll(() => {
  rmSync(holder.tmp, { recursive: true, force: true })
})

const driveMock = vi.mocked(driveSession)
const writeMock = vi.mocked(writeDoc)
const readMock = vi.mocked(readDoc)
const listChaptersMock = vi.mocked(listChapters)
const listDocsMock = vi.mocked(listDocs)

beforeEach(() => {
  vi.clearAllMocks()
  setSettings({ capabilities: {}, workspace: '', libraryRoot: '' })
})

describe('auditReportRel（审读存档路径）', () => {
  it('三类全卷检查分别落 大纲/审读_<名>.md', () => {
    expect(auditReportRel('consistency')).toBe('大纲/审读_一致性巡查.md')
    expect(auditReportRel('review')).toBe('大纲/审读_冷读报告.md')
    expect(auditReportRel('perspectives')).toBe('大纲/审读_多视角审视.md')
  })
})

describe('auditToMarkdown（审读报告 markdown 化）', () => {
  it('带条目：严重度/类型中文化、viewer、target 行', () => {
    const md = auditToMarkdown(
      {
        summary: '最要紧的是灯塔设定。',
        items: [
          { severity: 'high', type: 'setting-conflict', where: '第4章', what: '灯塔写成了亮的', suggest: '改回废弃', target: '世界观/切片_灯塔.md' },
          { severity: 'low', type: 'pacing', viewer: '节奏读者', where: '第3章', what: '拖', suggest: '提前事件' }
        ]
      },
      'perspectives',
      { now: '2026-09-09 13:00' }
    )
    expect(md).toContain('# 审读报告 · 多视角审视')
    expect(md).toContain('2026-09-09 13:00')
    expect(md).toContain('最要紧的是灯塔设定')
    expect(md).toContain('## 条目（2）')
    expect(md).toContain('[高] 设定冲突')
    expect(md).toContain('· 节奏读者')
    expect(md).toContain('- 关联档案：世界观/切片_灯塔.md')
    // 无 target 的条目不写关联档案行
    const idx = md.indexOf('### 2')
    expect(md.slice(idx)).not.toContain('- 关联档案')
  })

  it('空结果：留档证明跑过（写“这一遍没有发现问题”）', () => {
    const md = auditToMarkdown({ summary: '', items: [] }, 'consistency', { now: '2026-09-09 13:00' })
    expect(md).toContain('## 条目（0）')
    expect(md).toContain('这一遍没有发现问题。')
    expect(md).toContain('（无总结）')
  })
})

describe('runAudit 审读存档落盘', () => {
  it('审计成功后 writeDoc 写 大纲/审读_<名>.md 并回传 savedReport', async () => {
    readMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第1章_雾.md': '---\n章号: 1\n题名: 雾\n切片: 第一幕\n涉及人物: [顾岸]\n---\n顾岸的旧车是烟青色。',
        '人物/顾岸.md': '顾岸：怕水。'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([{ file: '第1章_雾.md', name: '第1章_雾', fm: { 章号: 1 }, wordCount: 0, mtime: 0, hasPendingProposal: false }] as never)
    listDocsMock.mockImplementation((_id: string, dir: string) =>
      dir === '人物' ? [{ file: '顾岸.md', name: '顾岸', mtime: 0 }] : []
    )
    driveMock.mockResolvedValue(
      '{"summary":"要改灯塔","items":[{"severity":"high","type":"setting","where":"第1章","what":"灯塔写亮","suggest":"改回","target":"人物/顾岸.md"}]}'
    )
    const r = await runAudit('pj', 'consistency')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.savedReport).toBe('大纲/审读_一致性巡查.md')
      expect(r.result.items).toHaveLength(1)
    }
    expect(writeMock).toHaveBeenCalledTimes(1)
    const [id, rel, md] = writeMock.mock.calls[0] as [string, string, string]
    expect(id).toBe('pj')
    expect(rel).toBe('大纲/审读_一致性巡查.md')
    expect(md).toContain('# 审读报告 · 一致性巡查')
    expect(md).toContain('要改灯塔')
  })

  it('盘写失败不阻断审计结果（savedReport 缺省）', async () => {
    readMock.mockImplementation((_id: string, rel: string) => (rel === '正文/第1章_雾.md' ? '---\n章号: 1\n题名: 雾\n切片: 第一幕\n---\n正文。' : null))
    listChaptersMock.mockReturnValue([{ file: '第1章_雾.md', name: '第1章_雾', fm: { 章号: 1 }, wordCount: 0, mtime: 0, hasPendingProposal: false }] as never)
    listDocsMock.mockReturnValue([])
    driveMock.mockResolvedValue('{"summary":"","items":[]}')
    writeMock.mockImplementation(() => {
      throw new Error('disk full')
    })
    const r = await runAudit('pj', 'review')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.savedReport).toBeUndefined()
  })
})
