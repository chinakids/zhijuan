import { beforeEach, describe, expect, it, vi } from 'vitest'

// store 的 readDoc / listChapters 打桩，其余（fmatter 等）走真实实现
vi.mock('../../src/main/store', () => ({ readDoc: vi.fn(), listChapters: vi.fn() }))

import { buildWritingContext } from '../../src/main/agent/context'
import { readDoc, listChapters } from '../../src/main/store'

const readDocMock = vi.mocked(readDoc)
const listChaptersMock = vi.mocked(listChapters)

const FM_1 = ['---', '章号: 1', '题名: 第一章', '切片: 第一幕', '涉及人物: [林晚]', '---'].join('\n') + '\n'
const FM_2 = ['---', '章号: 2', '题名: 第二章', '切片: 第二幕', '涉及人物: [林晚, 周守, 顾知远, 苏禾, 第五]', '---'].join('\n') + '\n'

const chEntry = (file: string) => ({
  file,
  name: file.replace(/\.md$/, ''),
  fm: null,
  wordCount: 0,
  mtime: 0,
  hasPendingProposal: false
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildWritingContext（写作上下文装配）', () => {
  it('完整装配：当前章、上一章尾部、最多前4位人物、切片、章卡、素材索引；且约定头被剥掉', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第2章_雾.md': FM_2 + '第二章正文',
        '正文/第1章_云.md': FM_1 + '第一章正文',
        '人物/林晚.md': '林晚档案',
        '人物/周守.md': '周守档案',
        '人物/顾知远.md': '顾知远档案',
        '人物/苏禾.md': '苏禾档案',
        '世界观/第二幕.md': '切片设定',
        '大纲/第2章_雾.md': '章卡一句话',
        '素材库/索引.md': '索引路标'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_云.md'), chEntry('第2章_雾.md')] as never)

    const { blocks, sources } = await buildWritingContext('p', '正文/第2章_雾.md')

    // 人物最多带 4 位（列出 5 个，第 5 个不进）
    expect(sources).toEqual([
      '正文/第2章_雾.md',
      '正文/第1章_云.md',
      '人物/林晚.md',
      '人物/周守.md',
      '人物/顾知远.md',
      '人物/苏禾.md',
      '世界观/第二幕.md',
      '大纲/第2章_雾.md',
      '素材库/索引.md'
    ])
    expect(blocks).toHaveLength(9)
    expect(blocks[0]).toContain('第二章正文')
    expect(blocks[1]).toContain('第一章正文')
    // front matter 不泄漏进上下文
    expect(blocks.join('\n')).not.toMatch(/^---\n?/)
    expect(blocks.join('\n')).not.toContain('章号:')
  })

  it('预算硬控：正文 ≤8000、人物 ≤4000、切片 ≤4000、素材索引 ≤1200', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_b.md') return FM_1 + '甲'.repeat(9000)
      if (rel === '人物/林晚.md') return '乙'.repeat(5000)
      if (rel === '世界观/第一幕.md') return '丙'.repeat(5000)
      if (rel === '素材库/索引.md') return '丁'.repeat(3000)
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_b.md')
    const all = blocks.join('\n')
    expect(all).toMatch(/甲{8000}/)
    expect(all).not.toMatch(/甲{8001}/)
    expect(all).toMatch(/乙{4000}/)
    expect(all).not.toMatch(/乙{4001}/)
    expect(all).toMatch(/丙{4000}/)
    expect(all).not.toMatch(/丙{4001}/)
    expect(all).toMatch(/丁{1200}/)
    expect(all).not.toMatch(/丁{1201}/)
  })

  it('第一章没有上一章；当前章不在章节列表时也没有', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第1章_a.md': FM_1 + '第一章正文',
        '正文/第9章_z.md': FM_2 + '独立章正文'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_a.md'), chEntry('第2章_b.md')] as never)

    const first = await buildWritingContext('p', '正文/第1章_a.md')
    expect(first.sources).toEqual(['正文/第1章_a.md'])

    // 当前章不在章节列表 → 无上一章，但也只有当前章
    const ghost = await buildWritingContext('p', '正文/第9章_z.md')
    expect(ghost.sources).toEqual(['正文/第9章_z.md'])
  })

  it('导演板（若已有）随行注入：剥 front matter、带硬指令说明、进 sources；front matter 不泄漏', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第2章_雾.md': FM_2 + '第二章正文',
        '大纲/第2章_雾.md': '章卡一句话',
        '大纲/第2章_雾_导演.md':
          ['---', '章号: 2', '题名: 雾', '切片: 第二幕', '状态: 已生成', '---', '', '## 情绪弧分段', '1. **推进**：abc', '', '## 波峰', '', '第 3 段 · 高潮', '', '## 人物行为轴', '', '- **林晚（试探）**：步步靠近', '', '## 写作红线（不许破）', '', '- 不揭穿旧事', ''].join('\n') + '\n',
        '素材库/索引.md': '索引路标'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks, sources } = await buildWritingContext('p', '正文/第2章_雾.md')

    expect(sources).toContain('大纲/第2章_雾_导演.md')
    const board = blocks.find((b) => b.includes('本章导演板'))
    expect(board).toBeTruthy()
    expect(board).toContain('情绪弧分段')
    expect(board).toContain('硬指令')
    // 导演板自己的 front matter 不泄漏进上下文
    expect(board).not.toContain('状态:')
    expect(board).not.toContain('题名:')
  })

  it('读不到的内容静默跳过，绝不抛错', async () => {
    readDocMock.mockReturnValue(null)
    listChaptersMock.mockReturnValue([] as never)
    const { blocks, sources } = await buildWritingContext('p', '正文/第2章_雾.md')
    expect(blocks).toHaveLength(0)
    expect(sources).toHaveLength(0)
  })
})
