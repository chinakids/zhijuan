import { describe, expect, it } from 'vitest'
import { chapterLine, linePredecessor, listLinesFromEntries, lineSliceNames, filterCharDocByLine, prefillSource, DEFAULT_LINE, type LineEntryNode } from '../../src/shared/line'

describe('chapterLine（约定头「时间线」字段提取）', () => {
  it('缺省=主线（无字段/无 fm）', () => {
    expect(chapterLine(null)).toBe(DEFAULT_LINE)
    expect(chapterLine({})).toBe(DEFAULT_LINE)
  })

  it('空或纯空白 = 主线', () => {
    expect(chapterLine({ '时间线': '' })).toBe(DEFAULT_LINE)
    expect(chapterLine({ '时间线': '   ' })).toBe(DEFAULT_LINE)
  })

  it('自定义线名 trim 后返回', () => {
    expect(chapterLine({ '时间线': ' 过去线 ' })).toBe('过去线')
  })

  it('非字符串值按主线兜底', () => {
    expect(chapterLine({ '时间线': 42 } as never)).toBe(DEFAULT_LINE)
  })
})

describe('listLinesFromEntries（线枚举：正文为源、按出现序）', () => {
  it('按线名出现序返回 {name, chapters}；主线（缺省线）若存在自然在最前', () => {
    const entries = [{ line: '主线' }, { line: '过去线' }, { line: '主线' }, { line: '林晚线' }]
    expect(listLinesFromEntries(entries)).toEqual([
      { name: '主线', chapters: 2 },
      { name: '过去线', chapters: 1 },
      { name: '林晚线', chapters: 1 }
    ])
  })

  it('空输入 → 空列表；同一线全缺省单线项目 → 只有主线', () => {
    expect(listLinesFromEntries([])).toEqual([])
    expect(listLinesFromEntries([{ line: DEFAULT_LINE }, { line: DEFAULT_LINE }])).toEqual([
      { name: DEFAULT_LINE, chapters: 2 }
    ])
  })
})

describe('linePredecessor（线内前驱 = 同线、章号严格小于当前、且最大）', () => {
  const E = (file: string, no: number | null, line: string): LineEntryNode => ({ file, no, line })
  const e = (parts: [string, number | null, string][]): LineEntryNode[] => parts.map((p) => E(p[0], p[1], p[2]))

  it('两线交错：过去线第 4 章的前驱是过去线第 2 章（不是全局上一章主线第 3 章）', () => {
    const entries = e([
      ['第01章.md', 1, '主线'],
      ['第02章.md', 2, '过去线'],
      ['第03章.md', 3, '主线'],
      ['第04章.md', 4, '过去线']
    ])
    expect(linePredecessor(entries, '第04章.md')?.file).toBe('第02章.md')
  })

  it('主线第 3 章的前驱是主线第 1 章', () => {
    const entries = e([
      ['第01章.md', 1, '主线'],
      ['第02章.md', 2, '过去线'],
      ['第03章.md', 3, '主线']
    ])
    expect(linePredecessor(entries, '第03章.md')?.file).toBe('第01章.md')
  })

  it('单线项目退化为全局按章号前驱（零回归）', () => {
    const entries = e([
      ['第01章.md', 1, '主线'],
      ['第02章.md', 2, '主线'],
      ['第03章.md', 3, '主线']
    ])
    expect(linePredecessor(entries, '第03章.md')?.file).toBe('第02章.md')
    expect(linePredecessor(entries, '第01章.md')).toBeNull()
  })

  it('同线无更小章号 → null（线内第一章）', () => {
    const entries = e([
      ['第01章.md', 1, '主线'],
      ['第02章.md', 2, '过去线']
    ])
    expect(linePredecessor(entries, '第02章.md')).toBeNull()
  })

  it('当前章不在 entries → null', () => {
    const entries = e([['第01章.md', 1, '主线']])
    expect(linePredecessor(entries, '第99章.md')).toBeNull()
  })

  it('章号解析失败(no=null)不参与前驱选择；当前章 no=null 时取同线最后一章（与旧全局序兜底同构）', () => {
    const entries = e([
      ['第01章.md', 1, '主线'],
      ['第02章.md', 2, '主线'],
      ['第03章.md', null, '主线']
    ])
    expect(linePredecessor(entries, '第03章.md')?.file).toBe('第02章.md')
    // 当前章 no=null → 取同线最大章号
    const entries2 = e([
      ['第01章.md', 1, '主线'],
      ['第02章.md', 2, '主线'],
      ['第03章.md', null, '主线'],
      ['第04章.md', 4, '过去线']
    ])
    expect(linePredecessor(entries2, '第03章.md')?.file).toBe('第02章.md')
  })

  it('同号并列时按文件名序取后（稳定）', () => {
    const entries = e([
      ['第01章_a.md', 1, '主线'],
      ['第01章_b.md', 1, '主线'],
      ['第02章.md', 2, '主线']
    ])
    expect(linePredecessor(entries, '第02章.md')?.file).toBe('第01章_b.md')
  })
})

describe('lineSliceNames（线 → 切片名集合，正文为源）', () => {
  const entries = [
    { line: '主线', slice: '幕1A' },
    { line: '过去线', slice: '幕0B' },
    { line: '主线', slice: ' 幕1C ' },
    { line: '过去线', slice: '' },
    { line: '主线', slice: undefined },
    { line: '未来线', slice: '幕2D' }
  ]
  it('只收指定线的非空切片名，trim 后入集合', () => {
    expect([...lineSliceNames(entries, '主线')].sort()).toEqual(['幕1A', '幕1C'])
    expect([...lineSliceNames(entries, '过去线')]).toEqual(['幕0B'])
    expect([...lineSliceNames(entries, '未来线')]).toEqual(['幕2D'])
  })
  it('空输入/未知线 → 空集合', () => {
    expect(lineSliceNames([], '主线').size).toBe(0)
    expect(lineSliceNames(entries, '不存在的线').size).toBe(0)
  })
})

describe('filterCharDocByLine（人物档案按线过滤，设计文档 §4.4）', () => {
  const doc = (sections: string) =>
    '---\n姓名: 林晚\n---\n林晚，设定。\n## 基础档案\n- 年龄：17\n' + sections

  it('多线档案：本线小节保留、他线小节整节剥除（含标题行），omitted 列名', () => {
    const raw = doc('## 切片：幕1A\n主线状态：A。\n## 切片：幕0B\n过去状态：B。\n## 切片：幕1C\n主线状态：C。\n')
    const r = filterCharDocByLine(raw, new Set(['幕1A', '幕1C']))
    expect(r.text).toContain('## 切片：幕1A')
    expect(r.text).toContain('主线状态：A。')
    expect(r.text).toContain('## 切片：幕1C')
    expect(r.text).toContain('主线状态：C。')
    expect(r.text).not.toContain('切片：幕0B')
    expect(r.text).not.toContain('过去状态：B。')
    expect(r.text).toContain('## 基础档案')
    expect(r.text).toContain('- 年龄：17')
    expect(r.text).toContain('---') // front matter 保留
    expect(r.omitted).toEqual(['幕0B'])
  })

  it('只有他线小节 → 剥到剩基础档案；omitted 含全部', () => {
    const raw = doc('## 切片：幕0B\n过去状态：B。\n')
    const r = filterCharDocByLine(raw, new Set(['幕1A']))
    expect(r.text).not.toContain('切片：幕0B')
    expect(r.text).toContain('## 基础档案')
    expect(r.omitted).toEqual(['幕0B'])
  })

  it('单线项目（keep=全部切片名）→ 全保留，零回归', () => {
    const raw = doc('## 切片：幕一\n一。\n## 切片：幕二\n二。\n')
    const r = filterCharDocByLine(raw, new Set(['幕一', '幕二']))
    expect(r.text).toBe(raw)
    expect(r.omitted).toEqual([])
  })

  it('无「## 切片：」小节（旧格式/手工档）→ 原样返回', () => {
    const raw = doc('## 成长轨迹\n- 初三…\n')
    const r = filterCharDocByLine(raw, new Set(['幕一']))
    expect(r.text).toBe(raw)
    expect(r.omitted).toEqual([])
  })

  it('H3~H6 级「切片：」不算 H2 小节，不碰（旧格式保守保留）', () => {
    const raw = doc('### 切片：幕一\n一。\n')
    const r = filterCharDocByLine(raw, new Set(['幕二']))
    expect(r.text).toBe(raw)
    expect(r.omitted).toEqual([])
  })

  it('切片名精确匹配（「幕一」不误命中「幕一X」）；跨线重名有本线引用则保留', () => {
    const raw = doc('## 切片：幕一\n一。\n## 切片：幕一X\n一X。\n')
    expect(filterCharDocByLine(raw, new Set(['幕一X'])).omitted).toEqual(['幕一'])
    expect(filterCharDocByLine(raw, new Set(['幕一', '幕一X'])).text).toBe(raw)
  })

  it('交错小节：他线小节多次出现全部剥除（含重复同名），顺序保真', () => {
    const raw = doc('## 切片：幕1A\nA1。\n## 切片：幕0B\nB1。\n## 切片：幕1A\nA2。\n')
    const r = filterCharDocByLine(raw, new Set(['幕1A']))
    expect(r.text).toContain('A1。')
    expect(r.text).toContain('A2。')
    expect(r.text).not.toContain('B1。')
    expect(r.omitted).toEqual(['幕0B'])
  })
})
describe('prefillSource（建章预填基准：多线项目续写非最新线时跟随选中章）', () => {
  it('选中章线 ≠ 最新章线（多线交错续写非最新线）→ selection（预填跟随选中章）', () => {
    expect(prefillSource('过去线', '主线')).toBe('selection')
    expect(prefillSource('主线', '现在线')).toBe('selection')
  })

  it('无选中章 → latest（与旧行为一致）', () => {
    expect(prefillSource(null, '主线')).toBe('latest')
    expect(prefillSource(null, null)).toBe('latest')
  })

  it('无最新章（首章场景）→ latest', () => {
    expect(prefillSource('过去线', null)).toBe('latest')
  })

  it('选中即最新章（同章）→ latest', () => {
    expect(prefillSource('主线', '主线')).toBe('latest')
  })

  it('同线但选中章非最新章（单线/主线中间章）→ latest：预填仍最新章，零回归', () => {
    expect(prefillSource('主线', '主线')).toBe('latest')
  })

  it('线名为空串（falsy 防御）→ latest；空白串非契约输入（调用方 chapterLine 已归一，恒非空串）', () => {
    expect(prefillSource('', '主线')).toBe('latest')
  })
})

