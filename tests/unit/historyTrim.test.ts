import { describe, it, expect } from 'vitest'
import { trimHistoryMessage, HISTORY_MSG_CAP } from '../../src/shared/historyTrim'

describe('trimHistoryMessage（对话历史单条预算裁剪）', () => {
  it('短消息原样返回', () => {
    const s = '帮我看看这段结尾'
    expect(trimHistoryMessage(s)).toBe(s)
  })

  it('恰好等于预算时原样返回', () => {
    const s = 'a'.repeat(HISTORY_MSG_CAP)
    expect(trimHistoryMessage(s)).toBe(s)
  })

  it('超预算时保留头尾各半并注明省略长度', () => {
    const cap = HISTORY_MSG_CAP
    const head = '第一章开始'.repeat(600) // 3000 字
    const tail = '这是结尾'.repeat(400) // 1200 字
    const content = head + '中间大段'.repeat(1000) + tail
    const out = trimHistoryMessage(content)
    const half = Math.floor(cap / 2)
    expect(out.startsWith(content.slice(0, half))).toBe(true)
    expect(out.endsWith(content.slice(-half))).toBe(true)
    expect(out).toContain(`${cap} 字符预算`)
    expect(out).toContain(String(content.length - cap))
    // 头尾之外只有一条省略说明，没有把别的正文塞进来
    expect(out.split('…').length).toBe(3)
  })

  it('自定义小预算下仍头尾保半（cap 奇数取 floor）', () => {
    const content = '0123456789abcdefghij' // 20 字
    const out = trimHistoryMessage(content, 10)
    expect(out.startsWith('01234')).toBe(true)
    expect(out.endsWith('fghij')).toBe(true)
    expect(out).toContain('10 字符预算')
  })

  it('超出 1 字符也走裁剪（头尾不重叠）', () => {
    const content = 'x'.repeat(HISTORY_MSG_CAP + 1)
    const out = trimHistoryMessage(content)
    expect(out.startsWith('x'.repeat(2000))).toBe(true)
    expect(out.endsWith('x'.repeat(2000))).toBe(true)
    expect(out.length).toBeLessThan(HISTORY_MSG_CAP + 80)
  })
})
