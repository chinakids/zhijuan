import { describe, expect, it } from 'vitest'
import { filterAtCandidates, insertAtMention, parseAtTrigger, type AtCandidate } from '../../src/shared/mention'

const C = (type: AtCandidate['type'], name: string, file: string): AtCandidate => ({ type, name, file })

describe('parseAtTrigger（@ 触发解析）', () => {
  it('行首 @ 触发（无 query）', () => {
    expect(parseAtTrigger('@', 1)).toEqual({ at: 0, length: 0, query: '' })
  })

  it('空白前 @ 触发并取到 token', () => {
    expect(parseAtTrigger('帮我看看 @林晚 的设定', '帮我看看 @林晚'.length)).toEqual({
      at: 5,
      length: 2,
      query: '林晚'
    })
  })

  it('@ 前是汉字（a@b）不触发', () => {
    expect(parseAtTrigger('联系作者@林晚', '联系作者@林晚'.length)).toBeNull()
  })

  it('@ 前是行首/空白之外的符号不触发', () => {
    expect(parseAtTrigger('a@b', 3)).toBeNull()
    expect(parseAtTrigger('( @x', 4)).not.toBeNull() // 空白前 OK（此处 @ 前是空格）
  })

  it('token 含空白不触发（@ 后跟了别的词）', () => {
    expect(parseAtTrigger('@林晚 你好', 5)).toBeNull()
  })

  it('token 超 30 字符不触发', () => {
    const tok = 'x'.repeat(31)
    expect(parseAtTrigger('@' + tok, 1 + tok.length)).toBeNull()
    expect(parseAtTrigger('@' + 'x'.repeat(30), 31)).not.toBeNull()
  })

  it('caret 不在 @ 之后（@ 在光标后面）不触发', () => {
    expect(parseAtTrigger('@林晚', 0)).toBeNull()
  })

  it('多个 @ 取最近的', () => {
    expect(parseAtTrigger('@阿七 和 @沈藏', '@阿七 和 @沈藏'.length)).toEqual({ at: 6, length: 2, query: '沈藏' })
  })

  it('换行前 @ 也算行首触发', () => {
    expect(parseAtTrigger('第一行\n@沈', '第一行\n@沈'.length)).toEqual({ at: 4, length: 1, query: '沈' })
  })
})

describe('filterAtCandidates（候选过滤与限幅）', () => {
  const all: AtCandidate[] = [
    C('人物', '林晚', '人物/林晚.md'),
    C('人物', '沈藏', '人物/沈藏.md'),
    C('人物', '阿七', '人物/阿七.md'),
    C('章节', '雾港', '正文/第01章_雾港.md'),
    C('章节', '灯塔', '正文/第02章_灯塔.md'),
    C('世界观', '雾港之夜', '世界观/第一幕_雾港之夜.md'),
    C('素材', '追忆型开头', '素材库/桥段/追忆型开头.md'),
    C('素材', '旧茶楼账房', '素材库/人物/旧茶楼账房.md')
  ]

  it('query 为空：不包含素材，四类顺序=人物/章节/世界观', () => {
    const r = filterAtCandidates(all, '')
    expect(r.map((x) => x.type)).toEqual(['人物', '人物', '人物', '章节', '章节', '世界观'])
  })

  it('query 非空：四类参与并按名称包含过滤', () => {
    const r = filterAtCandidates(all, '雾')
    expect(r.map((x) => x.name)).toEqual(['雾港', '雾港之夜'])
  })

  it('大小写不敏感 + 每类限幅 + 总量限幅', () => {
    const many: AtCandidate[] = Array.from({ length: 20 }, (_, i) => C('人物', `P${i}`, `人物/P${i}.md`))
    const r = filterAtCandidates(many, 'p', { perType: 5, limit: 4 })
    expect(r).toHaveLength(4)
    const r2 = filterAtCandidates(many, 'p', { perType: 5 })
    expect(r2).toHaveLength(5)
    expect(r2.map((x) => x.name)).toEqual(['P0', 'P1', 'P2', 'P3', 'P4'])
  })
})

describe('insertAtMention（替换触发区间为引用文本）', () => {
  it('行中替换正确且光标落在引用后', () => {
    const trig = { at: 5, length: 2 }
    const r = insertAtMention('帮我看看 @林晚 的设定', trig, C('人物', '林晚', '人物/林晚.md'))
    expect(r.value).toBe('帮我看看 〔人物·林晚｜人物/林晚.md〕 的设定')
    expect(r.value.slice(0, r.caret)).toBe('帮我看看 〔人物·林晚｜人物/林晚.md〕')
    expect(r.value[r.caret]).toBe(' ')
  })

  it('行首空 query 替换', () => {
    const r = insertAtMention('@', { at: 0, length: 0 }, C('章节', '雾港', '正文/第01章_雾港.md'))
    expect(r.value).toBe('〔章节·雾港｜正文/第01章_雾港.md〕 ')
    expect(r.value.slice(0, r.caret)).toBe('〔章节·雾港｜正文/第01章_雾港.md〕 ')
  })

  it('@ 后的原文（光标后内容）保留且不产生双空格', () => {
    const r = insertAtMention('@沈藏 你好', { at: 0, length: 2 }, C('人物', '沈藏', '人物/沈藏.md'))
    expect(r.value).toBe('〔人物·沈藏｜人物/沈藏.md〕 你好')
    // 后面已有空格时不补空格，光标落在引用文本之后
    expect(r.caret).toBe('〔人物·沈藏｜人物/沈藏.md〕'.length)
  })
})
