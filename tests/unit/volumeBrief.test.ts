import { beforeEach, describe, expect, it, vi } from 'vitest'

// store 的 readDoc / listChapters / listDocs 打桩（与 context.test.ts 同模式）
vi.mock('../../src/main/store', () => ({ readDoc: vi.fn(), listChapters: vi.fn(), listDocs: vi.fn(), writeDoc: vi.fn(), projectDir: vi.fn(() => '/tmp/zj-项目') }))

import { volumeBrief } from '../../src/main/agent/audit'
import { WCTX_CAPS } from '../../src/shared/contextCaps'
import { readDoc, listChapters, listDocs } from '../../src/main/store'

const readDocMock = vi.mocked(readDoc)
const listChaptersMock = vi.mocked(listChapters)
const listDocsMock = vi.mocked(listDocs)

const FM = (no: number, name: string) =>
  ['---', `章号: ${no}`, `题名: ${name}`, '切片: 第一幕', '涉及人物: [林晓]', '---'].join('\n') + '\n'

const chEntry = (file: string, fm: Record<string, unknown> | null = null) => ({
  file,
  name: file.replace(/\.md$/, ''),
  fm,
  wordCount: 0,
  mtime: 0,
  hasPendingProposal: false
})

beforeEach(() => {
  vi.clearAllMocks()
  listDocsMock.mockReturnValue([] as never)
})

describe('volumeBrief（全卷巡查/冷读/多视角材料包读入口径：正文与 runChat 同源、设定档判据完整）', () => {
  it('正文 ≤12000 全量：中段唯一句在材料中、无省略注记（旧 clip(2400,1400) 3800 窗口必缺=防回退）', () => {
    const mid = '中段哨兵句：林晓把刑警队的旧证件塞回了抽屉最底层。'
    const body = '前文。'.repeat(1200) + mid + '后文。'.repeat(1200) // ≈ 7200 字符，中段句在 ~3600 处
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_雾.md') return FM(1, '雾') + body
      if (rel === '人物/林晓.md') return '林晓档案'
      return null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_雾.md', { '章号': 1, '题名': '雾', '切片': '第一幕', '涉及人物': ['林晓'] })] as never)
    listDocsMock.mockReturnValue([{ file: '林晓.md', name: '林晓', mtime: 0 }] as never)

    const out = volumeBrief('p')
    expect(out).toContain(mid)
    expect(out).not.toContain('省略中部')
    expect(out).not.toContain('字符预算')

    // 对照：旧 clip(2400,1400) 3800 窗口必缺中段句（证明本断言有区分度，非恒真绿）
    expect(body.slice(0, 2400) + body.slice(-1400)).not.toContain(mid)
  })

  it('正文超 12000 保尾 + 注明省略与现读路径（与 runChat/chapterBodyBlock 同口径）', () => {
    const head = '第1章开头独有的设定句。'
    const tail = '结尾哨兵句：她把钥匙留在了窗台。'
    const body = head + '填充。'.repeat(6500) + tail // ≈ 13050 字符 > 12000
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '正文/第1章_雾.md') return FM(1, '雾') + body
      return null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_雾.md', { '章号': 1, '题名': '雾', '切片': '第一幕', '涉及人物': ['林晓'] })] as never)

    const out = volumeBrief('p')
    // 保尾：结尾句在、开头句（超出预算部分）被裁
    expect(out).toContain(tail)
    expect(out).not.toContain(head)
    // 注明省略与现读路径
    expect(out).toContain(`已超 ${WCTX_CAPS.chapter} 字符预算`)
    expect(out).toContain('正文/第1章_雾.md')
  })

  it('设定档 ≤4000 全量：中段信息在材料中（旧 clip(1800,800) 2600 窗口裁 2600+ 处=防回退）', () => {
    const midChar = '人物中段哨兵信息：曾在刑警队值夜三年。'
    // ≈4527 字符：> 旧窗口 2600（必裁区间）且 ≤ 新窗口 4800（全量区间）——用例有区分度
    const charDoc = '档案头部。' + '内容。'.repeat(750) + midChar + '内容。'.repeat(750)
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '人物/林晓.md') return charDoc
      if (rel === '正文/第1章_雾.md') return FM(1, '雾') + '正文内容'
      return null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_雾.md', { '章号': 1, '题名': '雾', '切片': '第一幕', '涉及人物': ['林晓'] })] as never)
    listDocsMock.mockReturnValue([{ file: '林晓.md', name: '林晓', mtime: 0 }] as never)

    const out = volumeBrief('p')
    expect(charDoc.length).toBeGreaterThan(2600) // 前提：档超旧窗口边界（否则用例无区分度）
    expect(charDoc.length).toBeLessThanOrEqual(4800) // 前提：档在新窗口全量区间内
    expect(out).toContain(midChar)
    expect(out).not.toContain('省略中部')
    expect(out).not.toContain('字符预算')

    // 对照：旧 clip(1800,800) 2600 窗口必缺该中段句
    expect(charDoc.slice(0, 1800) + charDoc.slice(-800)).not.toContain(midChar)
  })

  it('设定档超 4000 保头 + 尾 800 + 省略注记（世界观总纲类长文档留尾部最新状态）', () => {
    const charDoc = '世界观头部句。' + '内容。'.repeat(1700) + '世界观尾部句。' // ≈5114 > 4800
    readDocMock.mockImplementation((_id: string, rel: string) => {
      if (rel === '世界观/总纲.md') return charDoc
      if (rel === '正文/第1章_雾.md') return FM(1, '雾') + '正文内容'
      return null
    })
    listChaptersMock.mockReturnValue([chEntry('第1章_雾.md', { '章号': 1, '题名': '雾', '切片': '第一幕', '涉及人物': ['林晓'] })] as never)
    listDocsMock.mockReturnValue([{ file: '总纲.md', name: '总纲', mtime: 0 }] as never)

    const out = volumeBrief('p')
    expect(out).toContain('世界观头部句。')
    expect(out).toContain('世界观尾部句。')
    expect(out).toContain('省略中部')
  })
})
