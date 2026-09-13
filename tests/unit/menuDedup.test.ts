import { describe, expect, it } from 'vitest'
import { MENU_DEDUP_WINDOW_MS, shouldSkipKeydown } from '../../src/shared/menuDedup'

describe('shouldSkipKeydown（菜单双触发去重窗口）', () => {
  it('窗口内同 id → 跳过', () => {
    expect(
      shouldSkipKeydown({ id: 'save', at: 1000 }, 'save', 1000 + MENU_DEDUP_WINDOW_MS - 1)
    ).toBe(true)
  })

  it('异 id → 不跳过（菜单刚处理过 save，keydown 是 findOpen）', () => {
    expect(shouldSkipKeydown({ id: 'save', at: 1000 }, 'findOpen', 1200)).toBe(false)
  })

  it('超过窗口 → 不跳过（用户再次主动按键）', () => {
    expect(
      shouldSkipKeydown({ id: 'save', at: 1000 }, 'save', 1000 + MENU_DEDUP_WINDOW_MS)
    ).toBe(false)
  })

  it('恰好等于窗口边界 → 不跳过（窗口为严格小于）', () => {
    expect(shouldSkipKeydown({ id: 'findNext', at: 0 }, 'findNext', MENU_DEDUP_WINDOW_MS)).toBe(false)
  })

  it('无记录（首次 keydown / 菜单从未动作）→ 不跳过', () => {
    expect(shouldSkipKeydown(null, 'save', Date.now())).toBe(false)
  })

  it('窗口外同 id（菜单动作远久之后）→ 不跳过', () => {
    expect(
      shouldSkipKeydown({ id: 'save', at: 0 }, 'save', MENU_DEDUP_WINDOW_MS + 500)
    ).toBe(false)
  })
})
