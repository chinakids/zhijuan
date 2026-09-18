import { describe, expect, it } from 'vitest'
import { isImeComposing } from '../../src/renderer/src/lib/ime'

describe('isImeComposing（IME 组合期守卫）', () => {
  it('组合态（isComposing=true）返回 true', () => {
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true)
  })
  it('非组合态（isComposing=false）返回 false', () => {
    expect(isImeComposing({ nativeEvent: { isComposing: false } })).toBe(false)
  })
  it('无 isComposing 字段（旧内核/合成事件）返回 false——不误伤正常提交', () => {
    expect(isImeComposing({ nativeEvent: {} })).toBe(false)
  })
  it('无 nativeEvent（防御）返回 false', () => {
    expect(isImeComposing({})).toBe(false)
  })
})
