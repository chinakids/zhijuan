import { describe, expect, it } from 'vitest'
import {
  normRepeatKey,
  isMarkerLine,
  paragraphsOf,
  sentencesOf,
  repeatCheckFile,
  repeatCheck,
  repeatItems,
  REPEAT_CAPS
} from '../../src/shared/repeat'

const ch = (file: string, body: string): { file: string; raw: string } => ({
  file,
  raw: `---\n章号: 1\n题名: ${file}\n涉及人物: [陈默]\n---\n` + body
})

/** 生成 N 句同句首文本（句长 ≥14 字） */
const startsSentences = (n: number): string =>
  Array.from({ length: n }, (_, i) => `他把她的长腿放下，让她侧躺下来，第${i + 1}次。`).join('')

describe('normRepeatKey / isMarkerLine', () => {
  it('标准化：去空白标点只留中英数字', () => {
    expect(normRepeatKey('他按住她胯骨，一挺腰。')).toBe('他按住她胯骨一挺腰')
    expect(normRepeatKey('  「 他说：你好！」 ')).toBe('他说你好')
  })
  it('标记行判据：标题/分隔/加粗括注/无中文行', () => {
    expect(isMarkerLine('**（第 15 人 · 内射前的求 · 时间的缝隙）**')).toBe(true)
    expect(isMarkerLine('### 场景一')).toBe(true)
    expect(isMarkerLine('——')).toBe(true)
    expect(isMarkerLine('***')).toBe(true)
    expect(isMarkerLine('The End')).toBe(true)
    expect(isMarkerLine('她把灯芯拨低了一线，光缩成琥珀色的核。')).toBe(false)
  })
})

describe('paragraphsOf / sentencesOf（正文清洗）', () => {
  it('剥约定头与标记行，保留正文段', () => {
    const ps = paragraphsOf(ch('第1章', '**（过渡）**\n\n她把灯芯拨低了一线。\n\n---\n\n他又说了一遍。').raw)
    expect(ps).toEqual(['她把灯芯拨低了一线。', '他又说了一遍。'])
  })
  it('句子切分同 splitSentences 口径', () => {
    const ss = sentencesOf(ch('第1章', '他说：「走吧。」她点点头。').raw)
    expect(ss).toContain('他说：「走吧')
    expect(ss).toContain('她点点头')
  })
})

describe('repeatCheckFile（章内复读检测）', () => {
  it('完全重复句（≥14 字）命中 medium', () => {
    const body =
      '海风湿漉漉地贴着窗面，她把灯芯拨低了一线。她听到雨在铁皮屋顶上走。海风湿漉漉地贴着窗面，她把灯芯拨低了一线。'
    const hits = repeatCheckFile('正文/第01章.md', ch('第01章', body).raw)
    const s = hits.find((h) => h.kind === 'sentence')
    expect(s).toBeDefined()
    expect(s?.count).toBe(2)
    expect(s?.severity).toBe('medium')
  })
  it('短句（<14 字）重复不报', () => {
    const body = '她点点头。她点点头。她点点头。'
    const hits = repeatCheckFile('x', ch('x', body).raw)
    expect(hits).toHaveLength(0)
  })
  it('标记行双现不误报（第十一章实锤形态）', () => {
    const body =
      '正文一句。\n\n**（第 15 人 · 内射前的求 · 时间的缝隙）**\n\n正文二句。\n\n**（第 15 人 · 内射前的求 · 时间的缝隙）**\n\n正文三句。'
    const hits = repeatCheckFile('x', ch('x', body).raw)
    expect(hits).toHaveLength(0)
  })
  it('完全重复段（≥20 字）命中 medium', () => {
    const para = '她听到雨在铁皮屋顶上走，步子不紧不慢，像某个迟到的人一直在附近徘徊。'
    const hits = repeatCheckFile('x', ch('x', `${para}\n\n中间段。\n\n${para}`).raw)
    const p = hits.find((h) => h.kind === 'paragraph')
    expect(p?.count).toBe(2)
    expect(p?.severity).toBe('medium')
  })
  it('句首 2 连 → low（真数据「他把她的…」形态）', () => {
    const body =
      '他把她的长腿放下，又把她摆成侧躺，从后面托着她。他把她的两条腿并拢，抬起，压到她的胸前。'
    const hits = repeatCheckFile('x', ch('x', body).raw)
    const st = hits.find((h) => h.kind === 'sentence-start')
    expect(st).toBeDefined()
    expect(st?.count).toBe(2)
    expect(st?.severity).toBe('low')
  })
  it('连续 3 句同句首 → medium（真数据零命中=严格信号）', () => {
    const hits = repeatCheckFile('x', ch('x', startsSentences(3)).raw)
    const st = hits.find((h) => h.kind === 'sentence-start')
    expect(st?.count).toBe(3)
    expect(st?.severity).toBe('medium')
  })
  it('全等句对不双报（sentence 类报、句首组跳过）', () => {
    const body =
      '海风湿漉漉地贴着窗面，她把灯芯拨低了一线。她听到雨在铁皮屋顶上走。海风湿漉漉地贴着窗面，她把灯芯拨低了一线。'
    const hits = repeatCheckFile('x', ch('x', body).raw)
    expect(hits.filter((h) => h.kind === 'sentence')).toHaveLength(1)
    expect(hits.filter((h) => h.kind === 'sentence-start')).toHaveLength(0)
  })
  it('同句首但间隔 > 窗口 → 不报', () => {
    const filler = (n: number) =>
      ['雨声渐渐远了，她随手关上了窗。', '风把帐幔掀动了一次，她没回头。', '远处有汽笛长长地响了一声。', '她数着自己的心跳，慢慢合上眼。']
        .slice(0, n)
        .join('')
    const body = '他把她的长腿放下，又把她摆成侧躺。' + filler(4) + '他把她的两条腿并拢，抬起。'
    const hits = repeatCheckFile('x', ch('x', body).raw)
    expect(hits.find((h) => h.kind === 'sentence-start')).toBeUndefined()
  })
})

describe('repeatCheck / repeatItems（全卷聚合与审计条目）', () => {
  it('跨章完全重复不报（一期仅章内）', () => {
    const s = '海风湿漉漉地贴着窗面，她把灯芯拨低了一线。'
    const hits = repeatCheck([ch('正文/第01章.md', s), ch('正文/第02章.md', s)])
    expect(hits).toHaveLength(0)
  })
  it('repeatItems 输出 AuditItem 同构（type=repeat，what/where/suggest 齐）', () => {
    const body =
      '他把她的长腿放下，又把她摆成侧躺，从后面托着她。他把她的两条腿并拢，抬起，压到她的胸前。'
    const items = repeatItems([ch('正文/第01章.md', body)])
    expect(items).toHaveLength(1)
    expect(items[0].type).toBe('repeat')
    expect(items[0].severity).toBe('low')
    expect(items[0].where).toBe('正文/第01章.md')
    expect(items[0].what).toContain('同形开头')
    expect(items[0].suggest).toContain('排比')
  })
  it('clean 正文（无重复）零命中', () => {
    const body =
      '她把灯芯拨低了一线，光就缩成一颗琥珀色的核。雨在铁皮屋顶上走，步子不紧不慢。远处泊船的铁链拖过栈桥，声音被水咽掉一半。她忽然想起那晚的事。'
    const hits = repeatCheck([ch('正文/第01章.md', body)])
    expect(hits).toHaveLength(0)
  })
})

describe('REPEAT_CAPS 判据护栏', () => {
  it('常量锚点（改判据先看真数据评估基线）', () => {
    expect(REPEAT_CAPS.minSentenceLen).toBe(14)
    expect(REPEAT_CAPS.minParaLen).toBe(20)
    expect(REPEAT_CAPS.startPrefixLen).toBe(4)
    expect(REPEAT_CAPS.startWindow).toBe(3)
  })
})
