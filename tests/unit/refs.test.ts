import { describe, expect, it } from 'vitest'
import { parseAtRefs, inflateRefs, refsBlock, expandAtRefs } from '../../src/main/agent/refs'

const read = (f: string) => (f === '人物/林晓.md' ? '---\n姓名: 林晓\n---\n## 基础档案\n- 外貌：白裙' : '')

describe('parseAtRefs', () => {
  it('无引用 → 空数组', () => {
    expect(parseAtRefs('普通消息，没有引用')).toEqual([])
    expect(parseAtRefs('')).toEqual([])
  })

  it('单个引用：类型/名称/路径完整解析（中文）', () => {
    const r = parseAtRefs('帮我看看〔人物·林晓｜人物/林晓.md〕')
    expect(r).toEqual([{ type: '人物', name: '林晓', file: '人物/林晓.md' }])
  })

  it('多个引用按出现顺序全量提取', () => {
    const r = parseAtRefs('〔章节·雾港｜正文/第01章_雾港.md〕和〔世界观·总纲｜世界观/总纲.md〕都看看')
    expect(r.map((x) => x.type)).toEqual(['章节', '世界观'])
    expect(r[1].file).toBe('世界观/总纲.md')
  })

  it('无括号/半角括号/缺字段不误提取', () => {
    expect(parseAtRefs('【人物·林晓｜人物/林晓.md】')).toEqual([]) // 半角方括号不是引用形态
    expect(parseAtRefs('〔人物·林晓｜〕')).toEqual([]) // 缺路径
    expect(parseAtRefs('〔人物·林晓·123〕')).toEqual([]) // 缺｜分隔，整体按类型/名称/路径三段解析不出来
    expect(parseAtRefs('〔·林晓｜人物/林晓.md〕')).toEqual([]) // 缺类型
  })

  it('名称与路径两侧空白被清理', () => {
    const r = parseAtRefs('看看〔 人物 · 林 晓 ｜ 人物 / 林晓.md 〕')
    expect(r).toEqual([{ type: '人物', name: '林 晓', file: '人物 / 林晓.md' }])
  })
})

describe('inflateRefs', () => {
  it('人物类型：保留 front matter（姓名/身份是档案内容，与 buildWritingContext 口径一致）', () => {
    const out = inflateRefs(parseAtRefs('〔人物·林晓｜人物/林晓.md〕'), read)
    expect(out[0].found).toBe(true)
    expect(out[0].content).toBe('---\n姓名: 林晓\n---\n## 基础档案\n- 外貌：白裙')
    expect(out[0].truncated).toBe(false)
  })

  it('章节类型：剥 front matter（章号/切片等元数据不进正文上下文）', () => {
    const chapterRead = () => '---\n章号: 1\n题名: 雾港\n切片: 第一幕\n---\n## 正文\n雾港的夜'
    const out = inflateRefs(parseAtRefs('〔章节·雾港｜正文/第01章_雾港.md〕'), chapterRead)
    expect(out[0].content).toBe('## 正文\n雾港的夜')
    expect(out[0].content).not.toContain('章号')
  })

  it('读不到文件 → found=false、内容空、块里给 zj_read_doc 指路', () => {
    const out = inflateRefs(parseAtRefs('〔人物·幽灵｜人物/幽灵.md〕'), read)
    expect(out[0].found).toBe(false)
    expect(out[0].content).toBe('')
    const block = refsBlock(out)
    expect(block).toContain('文件未读到')
    expect(block).toContain('zj_read_doc')
  })

  it('单引用超 each 预算 → 从开头截断并标记，块内说明', () => {
    const long = '甲'.repeat(5000)
    const out = inflateRefs([{ type: '人物', name: 'a', file: '人物/a.md' }], () => long, { each: 4000, total: 12000 })
    expect(out[0].truncated).toBe(true)
    expect(out[0].content.length).toBe(4000)
    expect(refsBlock(out)).toContain('已超预算')
  })

  it('合计超 total 预算 → 后续引用剩余额度截断', () => {
    const long = '乙'.repeat(6000)
    const refs = [
      { type: '人物', name: 'a', file: '人物/a.md' },
      { type: '人物', name: 'b', file: '人物/b.md' }
    ]
    const out = inflateRefs(refs, () => long, { each: 4000, total: 5000 })
    expect(out[0].content).toBe('乙'.repeat(4000))
    expect(out[1].content.length).toBe(1000) // 只剩 1000
    expect(out[1].truncated).toBe(true)
  })

  it('read 抛错（文件 IO 异常）不炸，按未读到处理', () => {
    const out = inflateRefs([{ type: '人物', name: 'a', file: '人物/a.md' }], () => {
      throw new Error('boom')
    })
    expect(out[0].found).toBe(false)
  })
})

describe('refsBlock', () => {
  it('空引用列表 → null（零开销短路）', () => {
    expect(refsBlock([])).toBeNull()
  })

  it('非空引用组装为可注入块，含标签与内容', () => {
    const inflated = inflateRefs(parseAtRefs('〔人物·林晓｜人物/林晓.md〕'), read)
    const block = refsBlock(inflated)
    expect(block).toContain('【用户引用展开】')
    expect(block).toContain('〔人物·林晓｜人物/林晓.md〕')
    expect(block).toContain('## 基础档案')
  })
})

describe('expandAtRefs（readDoc 注入包装；readDoc 由调用方经 mock 注入）', () => {
  it('无引用 → block 为 null，不读文件', async () => {
    const r = await expandAtRefs('p', '普通消息')
    expect(r.block).toBeNull()
    expect(r.refs).toEqual([])
  })
})
