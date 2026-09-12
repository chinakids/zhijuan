import { describe, expect, it } from 'vitest'
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  clampAgentWidth
} from '../../src/shared/uiPrefs'

describe('clampAgentWidth（Agent 面板宽度钳制）', () => {
  it('取值域自洽：min < 默认 < max', () => {
    expect(AGENT_PANEL_MIN_WIDTH).toBeLessThan(AGENT_PANEL_DEFAULT_WIDTH)
    expect(AGENT_PANEL_DEFAULT_WIDTH).toBeLessThan(AGENT_PANEL_MAX_WIDTH)
  })

  it('默认宽与旧固定 w-80 一致（零回归），且原样通过钳制', () => {
    expect(AGENT_PANEL_DEFAULT_WIDTH).toBe(320)
    expect(clampAgentWidth(320)).toBe(320)
  })

  it('越界钳制：低于 min 抬到 min，高于 max 压到 max', () => {
    expect(clampAgentWidth(100)).toBe(AGENT_PANEL_MIN_WIDTH)
    expect(clampAgentWidth(9999)).toBe(AGENT_PANEL_MAX_WIDTH)
    expect(clampAgentWidth(AGENT_PANEL_MIN_WIDTH - 1)).toBe(AGENT_PANEL_MIN_WIDTH)
    expect(clampAgentWidth(AGENT_PANEL_MAX_WIDTH + 1)).toBe(AGENT_PANEL_MAX_WIDTH)
  })

  it('小数取整、非有限值回落默认', () => {
    expect(clampAgentWidth(320.6)).toBe(321)
    expect(clampAgentWidth(279.6)).toBe(280)
    expect(clampAgentWidth(Number.NaN)).toBe(AGENT_PANEL_DEFAULT_WIDTH)
    expect(clampAgentWidth(Number.POSITIVE_INFINITY)).toBe(AGENT_PANEL_DEFAULT_WIDTH)
  })
})
