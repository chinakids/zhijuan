import { describe, expect, it } from 'vitest'
import { countTrouble } from '../../src/renderer/src/features/check/trouble'
import type { DirectorCheckResult } from '../../src/shared/types'

const base = (over: Partial<DirectorCheckResult> = {}): DirectorCheckResult => ({
  summary: '',
  arcs: [],
  axes: [],
  redlines: [],
  hooks: [],
  ...over
})

const item = (status: string) => ({ ref: '', status, note: '' })

describe('countTrouble（兑现检查非绿灯计数）', () => {
  it('全绿灯 = 0（done/aligned/kept/paid）', () => {
    const r = base({
      arcs: [item('done')],
      axes: [item('aligned')],
      redlines: [item('kept')],
      hooks: [item('paid')]
    })
    expect(countTrouble(r)).toBe(0)
  })

  it('未兑现弧段/漂移与没写轴/被破红线/仍悬着钩子按条计数，新埋钩子不计', () => {
    const r = base({
      arcs: [item('partial'), item('missed'), item('done')],
      axes: [item('drifted'), item('absent')],
      redlines: [item('broken')],
      hooks: [item('open'), item('new'), item('paid')]
    })
    expect(countTrouble(r)).toBe(6)
  })

  it('空结果（导演板无核对项）= 0', () => {
    expect(countTrouble(base())).toBe(0)
  })
})
