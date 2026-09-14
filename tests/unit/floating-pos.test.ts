import { describe, it, expect } from 'vitest'
import { computeFloatingPos, FLOAT_EDGE, FLOAT_GAP } from '../../src/renderer/src/features/editor/floatingPos'

const VW = 1280
const VH = 800
const S = { w: 200, h: 120 }

describe('floatingPos.computeFloatingPos', () => {
  it('正常场景：锚点上方空间充足 → 浮层在锚点上方、水平居中', () => {
    const r = computeFloatingPos({ cx: 500, top: 400, bottom: 416 }, S, VW, VH)
    expect(r.below).toBe(false)
    expect(r.x).toBe(500)
    expect(r.top).toBe(400 - FLOAT_GAP - S.h) // 底缘距锚点顶 FLOAT_GAP
    expect(r.top + S.h).toBe(400 - FLOAT_GAP)
  })

  it('贴顶（上方不够）→ 翻到下方，顶部距锚点底 FLOAT_GAP', () => {
    const r = computeFloatingPos({ cx: 500, top: 60, bottom: 76 }, S, VW, VH)
    expect(r.below).toBe(true)
    expect(r.top).toBe(76 + FLOAT_GAP)
  })

  it('贴底（上方充分）→ 仍放上方（above 优先，不需要翻到溢出区）', () => {
    const r = computeFloatingPos({ cx: 500, top: 700, bottom: 716 }, S, VW, VH)
    expect(r.below).toBe(false)
    expect(r.top + S.h).toBe(700 - FLOAT_GAP)
    expect(r.top).toBeGreaterThanOrEqual(FLOAT_EDGE)
  })

  it('双侧都不足（视口极矮）→ 取空间大的一侧并钳进视口', () => {
    // 锚点 top=50/bottom=66，vh=140：上方空间 50-18=32 <120，下方 140-66-18=56 <120，下方更大 → below
    const r = computeFloatingPos({ cx: 500, top: 50, bottom: 66 }, S, VW, 140)
    expect(r.below).toBe(true)
    expect(r.top).toBeGreaterThanOrEqual(FLOAT_EDGE)
    expect(r.top + S.h).toBeLessThanOrEqual(140 - FLOAT_EDGE)
  })

  it('水平右缘：中心钳到 vw - EDGE - w/2', () => {
    const r = computeFloatingPos({ cx: 1260, top: 400, bottom: 416 }, S, VW, VH)
    expect(r.x).toBe(VW - FLOAT_EDGE - S.w / 2)
  })

  it('水平左缘：中心钳到 EDGE + w/2', () => {
    const r = computeFloatingPos({ cx: 10, top: 400, bottom: 416 }, S, VW, VH)
    expect(r.x).toBe(FLOAT_EDGE + S.w / 2)
  })

  it('浮层比视口可用宽还大 → 水平居中', () => {
    const r = computeFloatingPos({ cx: 100, top: 400, bottom: 416 }, { w: 1000, h: 100 }, 500, VH)
    expect(r.x).toBe(250)
  })

  it('below 且下方不足（但优于上方）→ 底缘钳制：top+h ≤ vh-EDGE', () => {
    // 锚点 top=200，vh=300：上方 182 ≥ h？不（h=120 → 182≥120 → above 就够）→ 构造上方不足：top=150 → spaceAbove=132 ≥120 仍够
    // 用 h=160：spaceAbove=132 <160；spaceBelow=300-166-18=116 <160，下方小→below=false? 断言 above 钳制。
    const r = computeFloatingPos({ cx: 640, top: 150, bottom: 166 }, { w: 200, h: 160 }, VW, 300)
    expect(r.below).toBe(false)
    expect(r.top).toBe(FLOAT_EDGE) // 空间都不足选上方，钳到顶缘
    // 再构造下方更大：anchor top 更高（top=100,bottom=116），spaceAbove=82, spaceBelow=166 → below
    const r2 = computeFloatingPos({ cx: 640, top: 100, bottom: 116 }, { w: 200, h: 160 }, VW, 300)
    expect(r2.below).toBe(true)
    expect(r2.top + 160).toBeLessThanOrEqual(300 - FLOAT_EDGE) // 底缘钳制生效
  })

  it('间隙恒定：above 时 anchor.top-(top+h)=GAP；below 时 top-anchor.bottom=GAP（空间足够时）', () => {
    const a = computeFloatingPos({ cx: 500, top: 400, bottom: 416 }, S, VW, VH)
    expect(400 - (a.top + S.h)).toBe(FLOAT_GAP)
    const b = computeFloatingPos({ cx: 500, top: 60, bottom: 76 }, S, VW, VH)
    expect(b.top - 76).toBe(FLOAT_GAP)
  })

  it('批注气泡典型高（多行 note）在「旧启发式 bug 区间」锚点 → 翻到下方（旧实现会从视口顶溢出）', () => {
    // 锚点 top=150、气泡 h=180：上方空间 150-18=132 <180 → 必须 below；旧代码（top<140 才 below）判 above → 顶部 -40 溢出
    const r = computeFloatingPos({ cx: 500, top: 150, bottom: 166 }, { w: 300, h: 180 }, VW, 800)
    expect(r.below).toBe(true)
    expect(r.top).toBe(166 + FLOAT_GAP)
  })

  it('整型边界：锚点恰在视口边缘不产生负值/越界；视口放不下浮层+双边距时边距让位（浮层仍完全可见）', () => {
    const r = computeFloatingPos({ cx: 0, top: 0, bottom: 10 }, { w: 100, h: 50 }, 300, 60)
    expect(Number.isFinite(r.x)).toBe(true)
    expect(Number.isFinite(r.top)).toBe(true)
    expect(r.top).toBeGreaterThanOrEqual(0)
    expect(r.top + 50).toBeLessThanOrEqual(60) // 视口 60 放不下 50+8*2 时边距让位，浮层仍完全可见
  })
})
