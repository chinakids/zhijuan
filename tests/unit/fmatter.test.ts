import { describe, expect, it } from 'vitest'
import { extractFrontMatter, serializeFrontMatter, withBody, withFrontMatter, addFrontMatterListItem } from '../../src/shared/fmatter'

describe('extractFrontMatter', () => {
  it('解析完整约定头：标量、数组、行内注释', () => {
    const { fm, body, raw } = extractFrontMatter(
      '---\n章号: 1\n题名: 夏夜的信 # 下部\n涉及人物: [林晚, 顾知远]\n---\n## 正文'
    )
    expect(fm).toEqual({ '章号': '1', '题名': '夏夜的信', '涉及人物': ['林晚', '顾知远'] })
    expect(body).toBe('## 正文')
    expect(raw).toContain('涉及人物')
  })

  it('无约定头 → fm 为 null，正文原样返回', () => {
    const r = extractFrontMatter('只有正文，没有约定头')
    expect(r.fm).toBeNull()
    expect(r.body).toBe('只有正文，没有约定头')
    expect(r.raw).toBe('')
  })

  it('跳过无冒号、空键、空值行；值两侧去空白', () => {
    const r = extractFrontMatter('---\n纯文本行\n: 空键\n正常:  带空格  \n---\n')
    expect(r.fm).toEqual({ '正常': '带空格' })
  })

  it('数组中的空项被剔除；全空数组不落键', () => {
    const r = extractFrontMatter('---\n列表: [a, , b]\n空列表: [,]\n---\nx')
    expect(r.fm).toEqual({ '列表': ['a', 'b'] })
  })

  it('行尾注释只取 # 之前的部分', () => {
    const r = extractFrontMatter('---\n切片: 第一幕 # 时间起点\n---\nx')
    expect(r.fm).toEqual({ '切片': '第一幕' })
  })
})

describe('serializeFrontMatter', () => {
  it('跳过 undefined / null / 空串', () => {
    const s = serializeFrontMatter({ a: undefined, b: null, c: '', d: 1 })
    expect(s).toBe('---\nd: 1\n---\n')
  })

  it('数组按 comma 展开；空数组不落入结果', () => {
    const s = serializeFrontMatter({ '涉及人物': ['林晚', '顾知远'], '空': [] })
    expect(s).toContain('涉及人物: [林晚, 顾知远]')
    expect(s).not.toContain('空')
  })

  it('round-trip：serialize 后再 extract 得到同值（章号保持字符串形态）', () => {
    const doc = withFrontMatter('正文文字', { '章号': '7', '题名': '凌晨的站台', '涉及人物': ['周守', '林晚'] })
    const { fm, body } = extractFrontMatter(doc)
    expect(fm).toEqual({ '章号': '7', '题名': '凌晨的站台', '涉及人物': ['周守', '林晚'] })
    expect(body).toBe('正文文字')
  })
})

describe('withBody / withFrontMatter', () => {
  it('withBody：有约定头则保留，只换正文', () => {
    const raw = '---\n章号: 1\n---\n旧正文'
    expect(withBody(raw, '新正文')).toBe('---\n章号: 1\n---\n新正文')
  })

  it('withBody：无约定头直接返回新正文', () => {
    expect(withBody('旧正文', '新正文')).toBe('新正文')
  })

  it('withFrontMatter 替换约定头但保留原正文', () => {
    const out = withFrontMatter('---\n旧: 1\n---\n保留的正文', { '新': '2' })
    expect(out).toBe('---\n新: 2\n---\n保留的正文')
  })
})

describe('addFrontMatterListItem（约定头列表键追加一项）', () => {
  it('数组行：追加并保持其他行原样、正文不动', () => {
    const raw = '---\n章号: 1\n题名: 雾港\n涉及人物: [林晚, 顾知远]\n---\n# 正文\n'
    const out = addFrontMatterListItem(raw, '涉及人物', '沈藏')
    expect(out).toBe('---\n章号: 1\n题名: 雾港\n涉及人物: [林晚, 顾知远, 沈藏]\n---\n# 正文\n')
  })

  it('单值写法：转数组形式', () => {
    const raw = '---\n涉及人物: 林晚\n---\n正文'
    expect(addFrontMatterListItem(raw, '涉及人物', '沈藏')).toBe('---\n涉及人物: [林晚, 沈藏]\n---\n正文')
  })

  it('已存在：原样返回，不做任何改动', () => {
    const raw = '---\n涉及人物: [林晚]\n---\n正文'
    expect(addFrontMatterListItem(raw, '涉及人物', '林晚')).toBe(raw)
  })

  it('键不存在：追加到约定头块末（正文保留）', () => {
    const raw = '---\n章号: 1\n题名: 雾港\n---\n正文'
    const out = addFrontMatterListItem(raw, '涉及人物', '沈藏')
    expect(out).toBe('---\n章号: 1\n题名: 雾港\n涉及人物: [沈藏]\n---\n正文')
  })

  it('无约定头或空值：原样返回', () => {
    expect(addFrontMatterListItem('没有约定头', '涉及人物', '沈藏')).toBe('没有约定头')
    expect(addFrontMatterListItem('---\n涉及人物: [林晚]\n---\n正文', '涉及人物', '  ')).toBe('---\n涉及人物: [林晚]\n---\n正文')
  })
})
