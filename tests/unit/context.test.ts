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
        '世界观/切片_第二幕.md': '切片设定',
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
      '世界观/切片_第二幕.md',
      '大纲/第2章_雾.md',
      '素材库/索引.md'
    ])
    // 第 5 位（第五）不进档案，但名单要全量给出（2026-09-10 上下文审计修复）
    expect(blocks).toHaveLength(10)
    expect(blocks[0]).toContain('第二章正文')
    expect(blocks[1]).toContain('第一章正文')
    const extra = blocks.find((b) => b.includes('涉及人物补充'))
    expect(extra).toContain('共 5 位')
    expect(extra).toContain('第五')
    expect(extra).toContain('zj_read_doc')
    expect(blocks.join('\n').indexOf('涉及人物补充')).toBeGreaterThan(blocks.join('\n').indexOf('人物档案：苏禾'))
    // front matter 不泄漏进上下文
    expect(blocks.join('\n')).not.toMatch(/^---\n?/)
    expect(blocks.join('\n')).not.toContain('章号:')
  })

  it('预算硬控：正文 ≤8000、人物 ≤4000、切片 ≤4000、素材索引 ≤1200', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_b.md') return FM_1 + '甲'.repeat(9000)
      if (rel === '人物/林晚.md') return '乙'.repeat(5000)
      if (rel === '世界观/切片_第一幕.md') return '丙'.repeat(5000)
      if (rel === '素材库/索引.md') return '丁'.repeat(3000)
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_b.md')
    const all = blocks.join('\n')
    expect(all).toMatch(/甲{8000}/)
    expect(all).not.toMatch(/甲{8001}/)
    // 正文超预算：改装配结尾并注明省略（续写最需要「刚写到哪里」；2026-09-10 修复）
    expect(all).toContain('已省略')
    expect(all).toContain('zj_read_doc')
    expect(all).toMatch(/乙{4000}/)
    expect(all).not.toMatch(/乙{4001}/)
    expect(all).toMatch(/丙{4000}/)
    expect(all).not.toMatch(/丙{4001}/)
    expect(all).toMatch(/丁{1200}/)
    expect(all).not.toMatch(/丁{1201}/)
  })

  it('正文超预算装配**结尾**：续写场景拿到「刚写到哪里」，开头可 zj_read_doc 现读', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_b.md') return FM_1 + '【开头标记】' + '中'.repeat(8990) + '【结尾标记】'
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_b.md')
    const chapter = blocks.find((b) => b.includes('当前章节'))
    expect(chapter).toBeTruthy()
    expect(chapter).toContain('【结尾标记】') // 尾部保留
    expect(chapter).not.toContain('【开头标记】') // 开头被省略（预算内 8000 字符不够首尾都在）
    expect(chapter).toContain('已省略')
    expect(chapter).toContain('zj_read_doc')
  })

  it('正文未超预算：原样全量装配，无省略提示', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_b.md') return FM_1 + '短正文'
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_b.md')
    const chapter = blocks.find((b) => b.includes('当前章节'))
    expect(chapter).toContain('短正文')
    expect(chapter).not.toContain('已省略')
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

  it('旧无「切片_」前缀的世界文件仍可装配（兼容旧项目数据）', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_a.md') return FM_1 + '第一章正文'
      if (rel === '世界观/第一幕.md') return '旧名切片设定'
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks, sources } = await buildWritingContext('p', '正文/第1章_a.md')
    const sl = blocks.find((b) => b.includes('当前切片设定'))
    expect(sl).toContain('旧名切片设定')
    // 来源清单报实际读取到的文件（2026-09-10 起：新名缺失/空壳时回看旧名，sources 跟随实际来源）
    expect(sources).toContain('世界观/第一幕.md')
  })

  it('本切片无设定文件时回退上一章切片状态（§6.5 状态基准），人物流向已在存档里', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第2章_雾.md': FM_2 + '第二章正文',
        '正文/第1章_云.md': FM_1 + '第一章正文',
        '世界观/切片_第一幕.md': '第一幕的世界状态：大雾栈桥'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_云.md'), chEntry('第2章_雾.md')] as never)

    const { blocks, sources } = await buildWritingContext('p', '正文/第2章_雾.md')
    const sl = blocks.find((b) => b.includes('上一切片设定'))
    expect(sl).toBeTruthy()
    expect(sl).toContain('第一幕的世界状态：大雾栈桥')
    expect(sources).toContain('世界观/切片_第一幕.md')
    // 本切片块不被误标为「当前切片设定」
    expect(blocks.find((b) => b.includes('当前切片设定'))).toBeUndefined()
  })

  it('本切片与上一章都无世界文件时回退总纲（长期不变项）', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第1章_a.md': FM_1 + '第一章正文',
        '世界观/总纲.md': '总纲：近未来滨海小城'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_a.md')] as never)

    const { blocks, sources } = await buildWritingContext('p', '正文/第1章_a.md')
    const g = blocks.find((b) => b.includes('世界观总纲'))
    expect(g).toContain('总纲：近未来滨海小城')
    expect(sources).toContain('世界观/总纲.md')
  })

  it('世界切片文件为模板空壳（只有标题+说明行）时不挡回退：回看旧无前缀名，再到上一章切片', async () => {
    // 本切片 切片_第一幕.md = 空壳模板；旧无前缀名 世界观/第一幕.md 也被空壳挡住？——旧名有事实则用旧名
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第2章_雾.md': FM_2 + '第二章正文',
        '正文/第1章_云.md': FM_1 + '第一章正文',
        '世界观/切片_第一幕.md': '# 切片：第一幕\n\n> 本切片的世界状态（规则、事件、环境）。正文保存时的切片同步会把本切片的新状态写入这里；长期不变设定请放《总纲》。\n',
        '世界观/第一幕.md': '旧名：凌晨两点栈桥大雾'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_云.md'), chEntry('第2章_雾.md')] as never)

    const { blocks, sources } = await buildWritingContext('p', '正文/第2章_雾.md')
    // 本切片空壳 → 回看旧名有事实 → 以「上一切片设定」标签进入（本切片无有效设定）
    const sl = blocks.find((b) => b.includes('上一切片设定'))
    expect(sl).toBeTruthy()
    expect(sl).toContain('旧名：凌晨两点栈桥大雾')
    expect(sources).toContain('世界观/第一幕.md')
  })

  it('世界切片文件为模板空壳且旧名也无事实 → 继续回退总纲（空壳不挡链）', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第1章_a.md': FM_1 + '第一章正文',
        '世界观/切片_第一幕.md': '# 切片：第一幕\n\n> 本切片的世界状态（规则、事件、环境）。正文保存时的切片同步会把本切片的新状态写入这里；长期不变设定请放《总纲》。\n',
        '世界观/总纲.md': '总纲：雾港常年有雾'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_a.md')] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_a.md')
    expect(blocks.find((b) => b.includes('世界观总纲'))).toContain('雾港常年有雾')
    // 空壳模板的文字不应进入上下文
    expect(blocks.join('\n')).not.toContain('本切片的世界状态（规则、事件、环境）')
  })

  it('读不到的内容静默跳过，绝不抛错', async () => {
    readDocMock.mockReturnValue(null)
    listChaptersMock.mockReturnValue([] as never)
    const { blocks, sources } = await buildWritingContext('p', '正文/第2章_雾.md')
    expect(blocks).toHaveLength(0)
    expect(sources).toHaveLength(0)
  })
})
