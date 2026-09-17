import { describe, expect, it } from 'vitest'
import { computeTypewriterScroll } from '../../src/renderer/src/features/editor/typewriter'

describe('computeTypewriterScroll（打字机滚动目标位纯函数）', () => {
  it('光标在容器中线以下：滚到光标行中心与视口中线对齐', () => {
    // 光标行上缘 y=1000（内容坐标系）、行高 29.6、视口 612 → 目标 = 1000 + 14.8 - 306 = 708.8
    expect(computeTypewriterScroll(1000, 29.6, 612, 100000)).toBeCloseTo(708.8, 6)
  })

  it('光标在顶部附近：目标为负 → 钳到 0', () => {
    expect(computeTypewriterScroll(50, 29.6, 612, 100000)).toBe(0)
  })

  it('接近文档底部：超过 maxScroll → 钳到 maxScroll', () => {
    expect(computeTypewriterScroll(9000, 29.6, 612, 5000)).toBe(5000)
  })

  it('光标正好在视口中线：目标=当前 scrollTop（原地不动）', () => {
    // 光标中心 306 = 视口一半 → target 0
    expect(computeTypewriterScroll(306 - 14.8, 29.6, 612, 100000)).toBe(0)
  })

  it('maxScroll <= 0（内容不足视口）：返回 0 不滚', () => {
    expect(computeTypewriterScroll(100, 29.6, 612, 0)).toBe(0)
    expect(computeTypewriterScroll(100, 29.6, 612, -10)).toBe(0)
  })

  it('参数非法（NaN/负视口）：返回 NaN，调用方不滚', () => {
    expect(computeTypewriterScroll(NaN, 29.6, 612, 1000)).toBeNaN()
    expect(computeTypewriterScroll(100, NaN, 612, 1000)).toBeNaN()
    expect(computeTypewriterScroll(100, 29.6, 0, 1000)).toBeNaN()
    expect(computeTypewriterScroll(100, 29.6, -5, 1000)).toBeNaN()
    expect(computeTypewriterScroll(100, 29.6, 612, NaN)).toBeNaN()
  })
})
