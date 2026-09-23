import { describe, expect, it } from 'vitest'
import {
  visibleBodyOf,
  countPhraseInText,
  overuseCheck,
  overuseItems,
  normalizeOveruseDict,
  BUILTIN_OVERUSE
} from '../../src/shared/wordfreq'

const ch = (file: string, body: string): { file: string; raw: string } => ({
  file,
  raw: `---\n章号: ${file.match(/(\d+)/)?.[1] ?? '1'}\n题名: ${file}\n涉及人物: [韩青]\n---\n` + body
})

describe('visibleBodyOf（正文清洗）', () => {
  it('剥约定头与 HTML 注释', () => {
    const b = visibleBodyOf('---\n章号: 1\n题名: X\n---\n<!-- 分幕缺段 -->\n他点了点头。')
    expect(b).not.toContain('章号')
    expect(b).not.toContain('分幕缺段')
    expect(b).toContain('他点了点头')
  })
  it('剥 markdown 行内符号（不隔断短语）', () => {
    expect(visibleBodyOf('*他懒得*点了点头。')).toContain('他懒得点了点头')
  })
})

describe('countPhraseInText（非重叠计数）', () => {
  it('同句多次与跨句', () => {
    expect(countPhraseInText('他点了点头。她点了点头。', '点了点头')).toBe(2)
  })
  it('重叠串按非重叠计（一下一下=含两个「一下」）', () => {
    expect(countPhraseInText('一下一下', '一下')).toBe(2)
  })
  it('短串套长串不互相污染', () => {
    expect(countPhraseInText('微微一笑', '微微')).toBe(1)
  })
  it('空短语返回 0', () => {
    expect(countPhraseInText('abc', '')).toBe(0)
  })
})

describe('overuseCheck（词表式频率报告）', () => {
  it('基础：命中条目含次数/每千字/章分布/severity', () => {
    const r = overuseCheck(
      [ch('正文/第01章.md', '他点了点头。她点了点头。')],
      { minCount: 1 }
    )
    expect(r).toHaveLength(1)
    const e = r[0]
    expect(e.phrase).toBe('点了点头')
    expect(e.count).toBe(2)
    expect(e.chapters).toEqual([{ file: '正文/第01章.md', count: 2 }])
    expect(e.perK).toBeGreaterThan(0)
    expect(e.severity).toBe('low')
  })
  it('跨章分布聚合、按章数降序', () => {
    const r = overuseCheck(
      [
        ch('正文/第01章.md', '他点了点头。'),
        ch('正文/第02章.md', '她点了点头。她点了点头。')
      ],
      { minCount: 1 }
    )
    const e = r[0]
    expect(e.count).toBe(3)
    expect(e.chapters.map((m) => m.count)).toEqual([2, 1])
  })
  it('minCount 阈值以下不报', () => {
    const r = overuseCheck([ch('正文/第01章.md', '他点了点头。')], { minCount: 3 })
    expect(r).toHaveLength(0)
  })
  it('约定头/注释里的词不计（正文清洗）', () => {
    const r = overuseCheck(
      [
        {
          file: '正文/第01章.md',
          raw: '---\n章号: 1\n题名: 点了点头\n---\n<!-- 点了点头 -->\n正文无。'
        }
      ],
      { minCount: 1 }
    )
    expect(r).toHaveLength(0)
  })
  it('自定义 dict 追加且去重', () => {
    const r = overuseCheck([ch('正文/第01章.md', '他器材室里摸出一支笔。')], {
      minCount: 1,
      dict: ['器材室里']
    })
    expect(r.map((e) => e.phrase)).toContain('器材室里')
    expect(new Set(r.map((e) => e.phrase)).size).toBe(r.length)
  })
  it('normalizeOveruseDict：trim/滤空串/滤纯空白/去重/非字符串过滤', () => {
    expect(normalizeOveruseDict([' 生死之交 ', '', '   ', '生死之交', 42 as any, ' 只见他 ']))
      .toEqual(['生死之交', '只见他'])
    expect(normalizeOveruseDict()).toEqual([])
    expect(normalizeOveruseDict([])).toEqual([])
  })
  it('自定义词表含空串/纯空白不产生误报条目（经 overuseCheck 合并清洗）', () => {
    const r = overuseCheck([ch('正文/第01章.md', '他点了点头。')], {
      minCount: 1,
      dict: ['', '  ', undefined as any]
    })
    expect(r.every((e) => e.phrase.length > 1 && !/\s/.test(e.phrase))).toBe(true)
  })
  it('空输入/零长度正文零条目', () => {
    expect(overuseCheck([])).toHaveLength(0)
    expect(overuseCheck([ch('正文/第01章.md', '')])).toHaveLength(0)
  })
  it('severity 分级：≥50 high / ≥15 medium / 其余 low（阈值实据见 wordfreq.ts 注释）', () => {
    const high = overuseCheck(
      [ch('正文/第01章.md', ('他点了点头。'.repeat(60)))],
      { minCount: 1 }
    )
    expect(high[0].severity).toBe('high')
    const mid = overuseCheck(
      [ch('正文/第01章.md', ('他点了点头。'.repeat(20)))],
      { minCount: 1 }
    )
    expect(mid[0].severity).toBe('medium')
    const low = overuseCheck(
      [ch('正文/第01章.md', ('他点了点头。'.repeat(5)))],
      { minCount: 1 }
    )
    expect(low[0].severity).toBe('low')
  })
})

describe('overuseItems（→ 审计条目）', () => {
  it('条目 what 含短语/次数/每千字，where 含分布', () => {
    const items = overuseItems(
      [ch('正文/第01章.md', '他点了点头。她点了点头。')],
      { minCount: 1 }
    )
    expect(items).toHaveLength(1)
    const it = items[0]
    expect(it.type).toBe('overuse')
    expect(it.what).toContain('「点了点头」')
    expect(it.what).toContain('2 次')
    expect(it.where).toContain('第01章')
    expect(it.suggest).toContain('审视')
  })
  it('内置词表为合理初始量（回归护栏）', () => {
    expect(BUILTIN_OVERUSE.length).toBeGreaterThanOrEqual(30)
  })
})
