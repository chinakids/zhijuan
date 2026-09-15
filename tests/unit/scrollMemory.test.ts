import { describe, expect, it } from 'vitest'
import { saveScroll, takeScroll } from '../../src/renderer/src/features/editor/scrollMemory'

describe('scrollMemory（会话内每文档滚动位置记忆）', () => {
  it('save 后 take 返回并消费（再次 take 为 undefined）', () => {
    saveScroll('p:正文/第01章.md', 1200)
    expect(takeScroll('p:正文/第01章.md')).toBe(1200)
    expect(takeScroll('p:正文/第01章.md')).toBeUndefined()
  })

  it('未保存的键 take 返回 undefined', () => {
    expect(takeScroll('p:没有.md')).toBeUndefined()
  })

  it('同键后写覆盖前写', () => {
    saveScroll('p:a.md', 10)
    saveScroll('p:a.md', 99)
    expect(takeScroll('p:a.md')).toBe(99)
  })

  it('LRU 上限 64：溢出淘汰最早保存的键', () => {
    for (let i = 0; i < 65; i++) saveScroll('k' + i, i)
    // 第 65 个写入后总数为 64，最早保存的 k0 被淘汰
    expect(takeScroll('k0')).toBeUndefined()
    expect(takeScroll('k1')).toBe(1)
    expect(takeScroll('k64')).toBe(64)
  })

  it('再保存会刷新 LRU 位置（x0 重新保存后不被淘汰）', () => {
    for (let i = 0; i < 64; i++) saveScroll('x' + i, i)
    saveScroll('x0', 0) // 把 x0 挪到最新
    for (let i = 0; i < 63; i++) saveScroll('y' + i, i + 1000)
    // 63 个新键只淘汰 x1..x63（x0 已在最新位，保留）
    expect(takeScroll('x0')).toBe(0)
    expect(takeScroll('x1')).toBeUndefined()
  })

  it('保存 0（未滚动）也可消费（恢复端按 >0 忽略）', () => {
    saveScroll('p:top0.md', 0)
    expect(takeScroll('p:top0.md')).toBe(0)
  })
})
