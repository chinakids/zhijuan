import { describe, expect, it } from 'vitest'
import { chapterLine, linePredecessor, listLinesFromEntries, DEFAULT_LINE, type LineEntryNode } from '../../src/shared/line'

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
