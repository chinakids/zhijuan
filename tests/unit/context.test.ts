import { beforeEach, describe, expect, it, vi } from 'vitest'

// store 的 readDoc / listChapters / listDocs 打桩，其余（fmatter 等）走真实实现
vi.mock('../../src/main/store', () => ({ readDoc: vi.fn(), listChapters: vi.fn(), listDocs: vi.fn() }))

import { buildWritingContext, buildProjectContext, isTemplateShell } from '../../src/main/agent/context'
import { findAnchorLine } from '../../src/shared/anchor'
import { actPlaceholder } from '../../src/shared/actsSeg'
import { WCTX_CAPS } from '../../src/shared/contextCaps'
import { readDoc, listChapters, listDocs } from '../../src/main/store'

const readDocMock = vi.mocked(readDoc)
const listChaptersMock = vi.mocked(listChapters)
const listDocsMock = vi.mocked(listDocs)

const FM_1 = ['---', '章号: 1', '题名: 第一章', '切片: 第一幕', '涉及人物: [林晚]', '---'].join('\n') + '\n'
const FM_2 = ['---', '章号: 2', '题名: 第二章', '切片: 第二幕', '涉及人物: [林晚, 周守, 顾知远, 苏禾, 第五]', '---'].join('\n') + '\n'
// 3 位涉及人物（≤maxChars 4，不触发预算截断——旧代码此时完全静默，部分无档无从知晓）
const FM_3 = ['---', '章号: 1', '题名: 第一章', '切片: 第一幕', '涉及人物: [林晚, 周守, 顾知远]', '---'].join('\n') + '\n'

const chEntry = (file: string, fm: Record<string, unknown> | null = null) => ({
  file,
  name: file.replace(/\.md$/, ''),
  fm,
  wordCount: 0,
  mtime: 0,
  hasPendingProposal: false
})
// 与真机 store.listChapters 同口径：ChapterEntry.fm 是已解析的约定头（2026-09-16 线内前驱依赖它）
const FM_OBJ_1 = { '章号': 1, '题名': '第一章', '切片': '第一幕', '涉及人物': ['林晚'] }
const FM_OBJ_2 = { '章号': 2, '题名': '第二章', '切片': '第二幕', '涉及人物': ['林晚', '周守', '顾知远', '苏禾', '第五'] }

beforeEach(() => {
  vi.clearAllMocks()
  // 2026-09-18 素材路标动态生成：素材库默认空（各用例按需覆盖；防 buildWritingContext 新 listDocs 调用 undefined 抛错）
  listDocsMock.mockReturnValue([] as never)
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
        '素材库/桥段/旧物定情.md': '---\n标签: [桥段, 旧物, 相遇]\n---\n\n# 旧物定情\n\n用一个旧物件串起两人第一次真正交集的场景。\n',
        '素材库/环境/雾海夜航.md': '---\n标签: [环境, 雾, 夜]\n---\n\n# 雾海夜航\n\n大雾的夜里，港口的能见度往往不足五十米。\n'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_云.md', FM_OBJ_1), chEntry('第2章_雾.md', FM_OBJ_2)] as never)
    // 素材库：素材文件为权威、路标运行时生成（2026-09-18）；采集池任务卡/索引.md 不注入
    listDocsMock.mockReturnValue([
      { file: '采集池/任务_1.md', name: '任务_1', mtime: 0 },
      { file: '索引.md', name: '索引', mtime: 0 },
      { file: '桥段/旧物定情.md', name: '旧物定情', mtime: 0 },
      { file: '环境/雾海夜航.md', name: '雾海夜航', mtime: 0 }
    ] as never)

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
      '素材库/桥段/旧物定情.md',
      '素材库/环境/雾海夜航.md'
    ])
    // 第 5 位（第五）不进档案，但名单要全量给出（2026-09-10 上下文审计修复）
    expect(blocks).toHaveLength(10)
    expect(blocks[0]).toContain('第二章正文')
    expect(blocks[1]).toContain('第一章正文')
    const extra = blocks.find((b) => b.includes('涉及人物补充'))
    expect(extra).toContain('共 5 位')
    expect(extra).toContain('第五')
    expect(extra).toContain('zj_read_doc')
    // 2026-09-16 审计修复：按实际附档名单点明已附/未附（原「已附前 4 位档案」与事实不符时误导模型）
    expect(extra).toContain('已附档案：林晚、周守、顾知远、苏禾')
    expect(extra).toContain('未附档案：第五')
    expect(blocks.join('\n').indexOf('涉及人物补充')).toBeGreaterThan(blocks.join('\n').indexOf('人物档案：苏禾'))
    // front matter 不泄漏进上下文
    expect(blocks.join('\n')).not.toMatch(/^---\n?/)
    expect(blocks.join('\n')).not.toContain('章号:')
    // 素材路标：内容=素材文件（类别/标题/标签/首段预览），采集池任务卡与索引.md 不进（2026-09-18）
    const mat = blocks.find((b) => b.includes('素材库索引'))
    expect(mat).toContain('桥段/旧物定情（标签：桥段、旧物、相遇）：用一个旧物件串起两人第一次真正交集的场景')
    expect(mat).toContain('环境/雾海夜航（标签：环境、雾、夜）：大雾的夜里，港口的能见度往往不足五十米')
    expect(mat).not.toContain('采集池')
    expect(mat).not.toContain('索引路标')
  })

  it('预算硬控：正文 ≤WCTX_CAPS.chapter、人物 ≤4000、切片 ≤4000、素材索引 ≤1200', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_b.md') return FM_1 + '甲'.repeat(WCTX_CAPS.chapter + 1000)
      if (rel === '人物/林晚.md') return '乙'.repeat(5000)
      if (rel === '世界观/切片_第一幕.md') return '丙'.repeat(5000)
      if (rel === '素材库/桥段/追忆型.md') return '---\n标签: [桥段]\n---\n\n# 追忆型\n\n' + '丁'.repeat(3000)
      return null
    })
    listChaptersMock.mockReturnValue([] as never)
    listDocsMock.mockReturnValue([{ file: '桥段/追忆型.md', name: '追忆型', mtime: 0 }] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_b.md')
    const all = blocks.join('\n')
    expect(all).toMatch(new RegExp('甲{' + WCTX_CAPS.chapter + '}'))
    expect(all).not.toMatch(new RegExp('甲{' + (WCTX_CAPS.chapter + 1) + '}'))
    // 正文超预算：改装配结尾并注明省略（续写最需要「刚写到哪里」；2026-09-10 修复）
    expect(all).toContain('已省略')
    expect(all).toContain('zj_read_doc')
    expect(all).toMatch(/乙{4000}/)
    expect(all).not.toMatch(/乙{4001}/)
    expect(all).toMatch(/丙{4000}/)
    expect(all).not.toMatch(/丙{4001}/)
    // 素材路标：内容=素材文件，预览按 48 字截断（2026-09-18 动态路标）
    const mat = blocks.find((b) => b.includes('素材库索引'))
    expect(mat).toContain('桥段/追忆型（标签：桥段）')
    expect(mat).toContain('丁'.repeat(48) + '…')
    expect(mat).not.toContain('丁'.repeat(49))
  })

  it('正文超预算装配**结尾**：续写场景拿到「刚写到哪里」，开头可 zj_read_doc 现读', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_b.md')
        return FM_1 + '【开头标记】' + '中'.repeat(WCTX_CAPS.chapter + 1000) + '【结尾标记】'
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_b.md')
    const chapter = blocks.find((b) => b.includes('当前章节'))
    expect(chapter).toBeTruthy()
    expect(chapter).toContain('【结尾标记】') // 尾部保留
    expect(chapter).not.toContain('【开头标记】') // 开头被省略（预算内 WCTX_CAPS.chapter 字符不够首尾都在）
    expect(chapter).toContain('已省略')
    expect(chapter).toContain('zj_read_doc')
  })

  it('正文含缺段占位：注入断链提示行，占位注释本体不进上下文', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_c.md')
        return FM_1 + '第一段正文。\n\n' + actPlaceholder(2) + '\n\n第三段正文。\n\n' + actPlaceholder(5) + '\n\n第六段正文。'
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_c.md')
    const chapter = blocks.find((b) => b.includes('当前章节'))
    expect(chapter).toBeTruthy()
    // 断链提示显式注入（模型知道缺第 2、5 段）
    expect(chapter).toContain('分幕缺段占位')
    expect(chapter).toContain('第 2、5 段未写成')
    expect(chapter).toContain('正文断链')
    // 注释本体仍被剥离（模型看到的是事实+提示，不是注释原文）
    expect(chapter).not.toContain('<!--')
    expect(chapter).toContain('第一段正文')
    expect(chapter).toContain('第三段正文')
  })

  it('正文只有缺段占位（无正文内容）：仍注入断链提示', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_d.md') return FM_1 + actPlaceholder(1)
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_d.md')
    const chapter = blocks.find((b) => b.includes('当前章节'))
    expect(chapter).toBeTruthy()
    expect(chapter).toContain('第 1 段未写成')
  })

  it('正文无占位：零提示零回归（无断链字样）', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_e.md') return FM_1 + '正常的正文，没有占位。'
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_e.md')
    const chapter = blocks.find((b) => b.includes('当前章节'))
    expect(chapter).toContain('正常的正文，没有占位。')
    expect(chapter).not.toContain('分幕缺段')
    expect(chapter).not.toContain('正文断链')
  })

  it('上一章含缺段占位：「上一章尾部」块注入断链提示，承接方感知上一章未写完', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第2章_雾.md': FM_2 + '第二章正文',
        '正文/第1章_云.md': FM_1 + '第一章前半。\n\n' + actPlaceholder(3) + '\n\n第一章结尾。'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_云.md', FM_OBJ_1), chEntry('第2章_雾.md', FM_OBJ_2)] as never)

    const { blocks, sources } = await buildWritingContext('p', '正文/第2章_雾.md')
    const prev = blocks.find((b) => b.includes('上一章尾部'))
    expect(prev).toBeTruthy()
    // 断链提示显式注入（模型知道上一章缺第 3 段）
    expect(prev).toContain('分幕缺段占位')
    expect(prev).toContain('第 3 段未写成')
    expect(prev).toContain('正文断链')
    // 尾部正文仍注入、占位注释本体被剥
    expect(prev).toContain('第一章结尾')
    expect(prev).not.toContain('<!--')
    expect(sources).toContain('正文/第1章_云.md')
  })

  it('上一章无缺段占位：上一章尾部零提示零回归', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第2章_雾.md': FM_2 + '第二章正文',
        '正文/第1章_云.md': FM_1 + '第一章正常完结。'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_云.md', FM_OBJ_1), chEntry('第2章_雾.md', FM_OBJ_2)] as never)

    const { blocks } = await buildWritingContext('p', '正文/第2章_雾.md')
    const prev = blocks.find((b) => b.includes('上一章尾部'))
    expect(prev).toContain('第一章正常完结')
    expect(prev).not.toContain('分幕缺段')
    expect(prev).not.toContain('正文断链')
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

  it('人物档案超预算装配**结尾**：最新切片状态保留，基础档案开头省略并提示可现读', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_b.md') return FM_1 + '短正文'
      if (rel === '人物/林晚.md') return '【基础档案头】' + '中'.repeat(3990) + '【最新切片状态尾】'
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_b.md')
    const char = blocks.find((b) => b.includes('人物档案：林晚'))
    expect(char).toBeTruthy()
    expect(char).toContain('【最新切片状态尾】') // 尾部（切片同步追写的最新状态）保留
    expect(char).not.toContain('【基础档案头】') // 头部基础档案被省略（预算内放不下首尾）
    expect(char).toContain('已省略')
    expect(char).toContain('zj_read_doc')
  })

  it('人物档案未超预算：原样全量装配，无省略提示', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_b.md') return FM_1 + '短正文'
      if (rel === '人物/林晚.md') return '短档案'
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_b.md')
    const char = blocks.find((b) => b.includes('人物档案：林晚'))
    expect(char).toContain('短档案')
    expect(char).not.toContain('已省略')
  })

  it('世界切片超预算装配**开头**：整节替换式当刻快照无追加式「最新在尾部」，与人物档保尾不同（2026-09-12 审计固化）', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_b.md') return FM_1 + '短正文'
      // 8 + 3990 + 8 = 4006 > 4000：首尾标记不可能同时装下
      if (rel === '世界观/切片_第一幕.md') return '【切片开头事实】' + '丙'.repeat(3990) + '【切片末尾话题】'
      return null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_b.md')
    const sl = blocks.find((b) => b.includes('当前切片设定'))
    expect(sl).toBeTruthy()
    expect(sl).toContain('【切片开头事实】') // 开头（H1 后的要点区）保留
    expect(sl).not.toContain('【切片末尾话题】') // 尾部被省略（无追加式最新状态，保头合理）
    expect(sl).toContain('已省略') // 与正文/人物口径同构：模型知道被截、可现读
    expect(sl).toContain('zj_read_doc')
  })

  it('第一章没有上一章；当前章不在章节列表时也没有', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第1章_a.md': FM_1 + '第一章正文',
        '正文/第9章_z.md': FM_2 + '独立章正文'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_a.md', FM_OBJ_1), chEntry('第2章_b.md', FM_OBJ_2)] as never)

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
          ['---', '章号: 2', '题名: 雾', '切片: 第二幕', '状态: 已生成', '---', '', '## 情绪弧分段', '1. **推进**：abc', '', '## 波峰', '', '第 3 段 · 高潮', '', '## 人物行为轴', '', '- **林晚（试探）**：步步靠近', '', '## 写作红线（不许破）', '', '- 不揭穿旧事', ''].join('\n') + '\n'
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
    listChaptersMock.mockReturnValue([chEntry('第1章_云.md', FM_OBJ_1), chEntry('第2章_雾.md', FM_OBJ_2)] as never)

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
    listChaptersMock.mockReturnValue([chEntry('第1章_云.md', FM_OBJ_1), chEntry('第2章_雾.md', FM_OBJ_2)] as never)

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

  it('新名不存在且旧无前缀名=模板空壳（只含标题+说明行）→ 说明行不得注入、继续回退总纲（2026-09-13 审计修复）', async () => {
    const shell = '# 切片：第一幕\n\n> 本切片的世界状态（规则、事件、环境）。正文保存时的切片同步会把本切片的新状态写入这里；长期不变设定请放《总纲》。\n'
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第1章_a.md': FM_1 + '第一章正文',
        '世界观/第一幕.md': shell,
        '世界观/总纲.md': '总纲：雾港常年有雾'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks, sources } = await buildWritingContext('p', '正文/第1章_a.md')
    const all = blocks.join('\n')
    expect(all).not.toContain('本切片的世界状态（规则、事件、环境）')
    expect(all).not.toContain('【当前切片设定：第一幕】')
    expect(blocks.find((b) => b.includes('世界观总纲'))).toContain('雾港常年有雾')
    expect(sources).toContain('世界观/总纲.md')
    expect(sources).not.toContain('世界观/第一幕.md')
  })

  it('HTML 注释（元信息）装配时统一剥离：正文/人物档/世界切片的注释不进上下文，事实保留', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第1章_a.md': FM_1 + '第一章正文<!-- 作者备忘：此处铺垫 -->',
        '人物/林晚.md':
          '林晚档案<!-- 正文保存后，切片同步会把本章新状态写入「## 切片：…」小节 -->\n- 年龄：17',
        '世界观/切片_第一幕.md': '# 切片：第一幕\n<!-- 骨架说明 -->\n- 事件：大雾'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_a.md')
    const all = blocks.join('\n')
    // 注释（模板说明/占位提示/作者备忘）不进入模型上下文
    expect(all).not.toContain('作者备忘')
    expect(all).not.toContain('切片同步会把')
    expect(all).not.toContain('骨架说明')
    expect(all).not.toContain('<!--')
    // 注释后的真实内容完整保留
    expect(all).toContain('第一章正文')
    expect(all).toContain('年龄：17')
    expect(all).toContain('事件：大雾')
  })

  it('涉及人物部分无档案（≤4 位不触发预算截断）：补充块按实际附档名单点明已附/未附（2026-09-16 审计修复）', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      const table: Record<string, string> = {
        '正文/第1章_a.md': FM_3 + '第一章正文',
        '人物/林晚.md': '林晚档案'
      }
      return table[rel] ?? null
    })
    listChaptersMock.mockReturnValue([] as never)

    const { blocks } = await buildWritingContext('p', '正文/第1章_a.md')
    const extra = blocks.find((b) => b.includes('涉及人物补充'))
    expect(extra).toBeTruthy()
    expect(extra).toContain('共 3 位')
    expect(extra).toContain('已附档案：林晚')
    expect(extra).toContain('未附档案：周守、顾知远')
    expect(extra).toContain('zj_read_doc')
    // 未附者没有档案块注入
    expect(blocks.find((b) => b.includes('人物档案：周守'))).toBeUndefined()
  })

  it('读不到的内容静默跳过，绝不抛错', async () => {
    readDocMock.mockReturnValue(null)
    listChaptersMock.mockReturnValue([] as never)
    const { blocks, sources } = await buildWritingContext('p', '正文/第2章_雾.md')
    expect(blocks).toHaveLength(0)
    expect(sources).toHaveLength(0)
  })

  it('isTemplateShell：剥离 HTML 注释再判定——注释式模板/说明不算「已有设定」', () => {
    // 只有标题+说明行+HTML 注释 = 空壳（模板骨架，2026-09-11 示例模板新口径）
    const shell =
      '# 切片：示例切片_初遇\n\n> 本切片的世界状态（规则、事件、环境）。正文保存时的切片同步会把本切片的新状态写入这里；长期不变设定请放《总纲》。\n\n<!-- 这是时间切片文件的骨架：正文保存后，切片同步会把本章揭示的世界新状态写入本文件；可按需组织小节，如「## 本切片时间点」。 -->\n'
    expect(isTemplateShell(shell)).toBe(true)
    // 只有注释 = 空壳
    expect(isTemplateShell('<!-- 只有注释说明 -->\n')).toBe(true)
    // 出现任何非注释、非标题、非标准说明行的内容 = 有设定
    expect(isTemplateShell(shell + '## 本切片时间点\n\n凌晨两点，大雾\n')).toBe(false)
  })

  it('内建「示例」世界切片模板与运行时形态同构：H1 可被切片锚点精确命中', () => {
    const tpl = '# 切片：示例切片_初遇\n\n> 本切片的世界状态（规则、事件、环境）。正文保存时的切片同步会把本切片的新状态写入这里；长期不变设定请放《总纲》。\n\n<!-- 骨架说明 -->\n'
    expect(isTemplateShell(tpl)).toBe(true)
    // 锚点「切片：示例切片_初遇」归一化后与 H1 精确相等（旧形态「# 世界观 · 切片：…」会 miss）
    expect(findAnchorLine(tpl.split('\n'), '切片：示例切片_初遇')).toEqual({ line: 0, level: 1 })
  })
})

describe('预算截断可见性（2026-09-13 上下文审计第二轮收口）', () => {
  const noPrev = [] as never

  it('章卡超预算：保头 + 注明「已超/已省略/可现读」；开头保留、被裁的尾部不在上下文', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_a.md') return FM_1 + '第一章正文'
      if (rel === '大纲/第1章_a.md') return '【卡首标记】' + '卡'.repeat(2200) + '【卡尾标记】'
      return null
    })
    listChaptersMock.mockReturnValue(noPrev)
    const { blocks } = await buildWritingContext('p', '正文/第1章_a.md')
    const card = blocks.find((b) => b.includes('本章章卡'))
    expect(card).toBeTruthy()
    expect(card).toContain('已超 2000 字符预算')
    expect(card).toContain('已省略')
    expect(card).toContain('zj_read_doc')
    expect(card).toContain('【卡首标记】')
    expect(card).not.toContain('【卡尾标记】')
  })

  it('导演板超预算：保头 + 注明 + 可现读；硬指令说明仍在', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_a.md') return FM_1 + '第一章正文'
      if (rel === '大纲/第1章_a_导演.md') return '【板首标记】' + '板'.repeat(2600) + '【板尾标记】'
      return null
    })
    listChaptersMock.mockReturnValue(noPrev)
    const { blocks } = await buildWritingContext('p', '正文/第1章_a.md')
    const board = blocks.find((b) => b.includes('本章导演板'))
    expect(board).toBeTruthy()
    expect(board).toContain('硬指令')
    expect(board).toContain('已超 2500 字符预算')
    expect(board).toContain('已省略')
    expect(board).toContain('【板首标记】')
    expect(board).not.toContain('【板尾标记】')
  })

  it('素材库路标超预算（>1200 字符）：注明共 N 篇 + 超预算 + 指 zj_search（dir=素材库），保留可容纳的前若干条', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_a.md') return FM_1 + '第一章正文'
      // 20 个素材：每条「- 类别/素材NN（标签：…）：<48 字预览>」≈90 字符 → 合计 ≈1800 > 1200
      for (let i = 1; i <= 20; i++) {
        const cat = i % 2 ? '桥段' : '环境'
        if (rel === `素材库/${cat}/素材${String(i).padStart(2, '0')}.md`) {
          return `---\n标签: [${cat}, 标签${i}]\n---\n\n# 素材${String(i).padStart(2, '0')}\n\n` + `索${i}`.repeat(30)
        }
      }
      return null
    })
    listChaptersMock.mockReturnValue(noPrev)
    listDocsMock.mockReturnValue(
      Array.from({ length: 20 }, (_, i) => {
        const n = i + 1
        return { file: `${n % 2 ? '桥段' : '环境'}/素材${String(n).padStart(2, '0')}.md`, name: `素材${String(n).padStart(2, '0')}`, mtime: 0 }
      }) as never
    )
    const { blocks } = await buildWritingContext('p', '正文/第1章_a.md')
    const idx = blocks.find((b) => b.includes('素材库索引'))
    expect(idx).toBeTruthy()
    expect(idx).toContain('素材库共 20 篇')
    expect(idx).toContain('超 1200 字符预算')
    expect(idx).toContain('zj_search 搜索（dir=素材库）')
    // 保头：首条在；尾条被截掉
    expect(idx).toContain('素材01')
    expect(idx).not.toContain('素材20')
    // 路标整体 ≤1200（提示行 + 内容）
    expect(idx!.length - '【素材库索引】\n'.length).toBeLessThanOrEqual(1200)
  })

  it('素材库路标未超预算：素材文件（类别/标题/标签/首段预览）原样全量装配，零提示；索引.md/采集池不注入', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_a.md') return FM_1 + '第一章正文'
      if (rel === '大纲/第1章_a.md') return '章卡一句话'
      if (rel === '大纲/第1章_a_导演.md') return '导演板一句话'
      if (rel === '素材库/桥段/旧物定情.md') {
        return '---\n标签: [桥段, 旧物, 相遇]\n---\n\n# 旧物定情\n\n用一个旧物件串起两人第一次真正交集的场景。\n'
      }
      return null
    })
    listChaptersMock.mockReturnValue(noPrev)
    listDocsMock.mockReturnValue([
      { file: '索引.md', name: '索引', mtime: 0 },
      { file: '采集池/任务_1.md', name: '任务_1', mtime: 0 },
      { file: '桥段/旧物定情.md', name: '旧物定情', mtime: 0 }
    ] as never)
    const { blocks } = await buildWritingContext('p', '正文/第1章_a.md')
    const all = blocks.join('\n')
    expect(all).toContain('章卡一句话')
    expect(all).toContain('导演板一句话')
    expect(all).toContain('- 桥段/旧物定情（标签：桥段、旧物、相遇）：用一个旧物件串起两人第一次真正交集的场景')
    expect(all).not.toContain('索引.md')
    expect(all).not.toContain('已超')
    expect(all).not.toContain('已省略')
  })

  it('buildProjectContext：作品总纲/世界观总纲超预算注明省略，文档清单路标仍全量', async () => {
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === 'project.md') return '【总纲首标记】' + '纲'.repeat(3200) + '【总纲尾标记】'
      if (rel === '世界观/总纲.md') return '【世首标记】' + '世'.repeat(2300) + '【世尾标记】'
      return null
    })
    listDocsMock.mockImplementation((_id: string, dir: string) => {
      const table: Record<string, { name: string; file: string }[]> = {
        正文: [{ name: '第1章_a', file: '正文/第1章_a.md' }],
        人物: [{ name: '林晚', file: '人物/林晚.md' }],
        世界观: [{ name: '总纲', file: '世界观/总纲.md' }],
        素材库: []
      }
      return (table[dir] ?? []) as never
    })
    const { blocks } = await buildProjectContext('p')
    const all = blocks.join('\n')
    expect(all).toContain('已超 3000 字符预算')
    expect(all).toContain('已超 2000 字符预算')
    expect(all).toContain('【总纲首标记】')
    expect(all).not.toContain('【总纲尾标记】')
    expect(all).toContain('【世首标记】')
    expect(all).not.toContain('【世尾标记】')
    // 文档清单仍是全量路标（不因总纲截断受影响）
    const doclist = blocks.find((b) => b.includes('文档清单'))
    expect(doclist).toContain('正文/：1 篇')
    expect(doclist).toContain('人物/：1 篇')
  })

  it('buildProjectContext：文档清单路标排序稳定——正文按章号升序全量，其他目录按码位升序（与 mtime 无关）', async () => {
    const fmOf = (no: number) =>
      ['---', `章号: ${no}`, '题名: x', '切片: 第一幕', '涉及人物: []', '---'].join('\n') + '\n'
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel.startsWith('正文/')) {
        const no = Number(rel.match(/第(\d+)章/)?.[1])
        return fmOf(no)
      }
      if (rel === 'project.md') return '# 总纲'
      return null
    })
    // listDocs 返回乱序（模拟最近编辑漂移：第03章 mtime 最新却应排最后；人物/素材乱序）
    listDocsMock.mockImplementation((_id: string, dir: string) => {
      const table: Record<string, { file: string; name: string }[]> = {
        正文: [
          { file: '正文/第03章_c.md', name: '第03章_c' },
          { file: '正文/第01章_a.md', name: '第01章_a' },
          { file: '正文/第02章_b.md', name: '第02章_b' }
        ],
        人物: [
          { file: '人物/周守.md', name: '周守' },
          { file: '人物/陈默.md', name: '陈默' }
        ],
        素材库: [
          { file: '素材库/b.md', name: '桥段_b' },
          { file: '素材库/a.md', name: '场景_a' }
        ],
        世界观: []
      }
      return (table[dir] ?? []) as never
    })
    const { blocks } = await buildProjectContext('p')
    const doclist = blocks.find((b) => b.includes('文档清单'))!
    // 正文：章号升序（01 < 02 < 03），与 mtime 顺序无关
    const i1 = doclist.indexOf('第01章_a')
    const i2 = doclist.indexOf('第02章_b')
    const i3 = doclist.indexOf('第03章_c')
    expect(i1).toBeGreaterThan(0)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
    // 其他目录：码位升序（周 U+5468 < 陈 U+9648；场 U+573A < 桥 U+6865）——确定性、跨平台一致
    expect(doclist.indexOf('周守')).toBeLessThan(doclist.indexOf('陈默'))
    expect(doclist.indexOf('场景_a')).toBeLessThan(doclist.indexOf('桥段_b'))
  })
})
