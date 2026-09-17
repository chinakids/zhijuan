import { describe, expect, it } from 'vitest'
import { WCTX_CAPS, WCTX_MAX } from '../../src/shared/contextCaps'

describe('contextCaps（装配预算单一权威源）', () => {
  it('WCTX_MAX = 各块预算之和（含人物 × 人数上限）', () => {
    const sum =
      WCTX_CAPS.chapter +
      WCTX_CAPS.prevTail +
      WCTX_CAPS.char * WCTX_CAPS.maxChars +
      WCTX_CAPS.slice +
      WCTX_CAPS.card +
      WCTX_CAPS.director +
      WCTX_CAPS.material
    expect(WCTX_MAX).toBe(sum)
    // 2026-09-17 复核：chapter 8000→12000 后总量 36700→40700（正文为源，真实章长中位 8548）
    expect(WCTX_MAX).toBe(40700)
  })

  it('预算关键值回归锚点（改预算会先破这里）', () => {
    expect(WCTX_CAPS.chapter).toBe(12000)
    expect(WCTX_CAPS.char).toBe(4000)
    expect(WCTX_CAPS.maxChars).toBe(4)
  })
})
