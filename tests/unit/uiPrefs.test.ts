import { describe, expect, it } from 'vitest'
import {
  AGENT_PANEL_DEFAULT_WIDTH,
  AGENT_PANEL_MAX_WIDTH,
  AGENT_PANEL_MIN_WIDTH,
  CHAPTER_COL_WIDTH,
  EDITOR_MIN_WIDTH,
  SECTION_NAV_WIDTH,
  clampAgentWidth,
  shouldCollapseChapterList
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

// 窄窗正文保护（2026-09-14 体验层）：判据 = 窗口宽 - 240(SectionNav) - agentWd - 240(章列) < 360
// 默认 agentWd=320 时阈值 = 1160；agentWd 越宽阈值越高（正文始终受保护）
describe('shouldCollapseChapterList（窄窗正文保护判据）', () => {
  it('默认 Agent 宽 320：窗口 1160 时正文=360 恰好不折叠', () => {
    // 1160 - 240 - 320 - 240 = 360 → <360 为 false → 不折叠（边界含端点）
    expect(shouldCollapseChapterList(1160, 320)).toBe(false)
  })
  it('默认 Agent 宽 320：窗口 1159 时正文=359 → 折叠', () => {
    expect(shouldCollapseChapterList(1159, 320)).toBe(true)
  })
  it('minWidth 1000 + 默认 Agent 320：正文=200 → 折叠（问题场景实锤）', () => {
    expect(shouldCollapseChapterList(1000, 320)).toBe(true)
  })
  it('Agent 面板拖到最窄 280：阈值降为 1120', () => {
    expect(shouldCollapseChapterList(1120, AGENT_PANEL_MIN_WIDTH)).toBe(false)
    expect(shouldCollapseChapterList(1119, AGENT_PANEL_MIN_WIDTH)).toBe(true)
  })
  it('Agent 面板拖到最宽 560：阈值升为 1400', () => {
    expect(shouldCollapseChapterList(1400, AGENT_PANEL_MAX_WIDTH)).toBe(false)
    expect(shouldCollapseChapterList(1399, AGENT_PANEL_MAX_WIDTH)).toBe(true)
  })
  it('常量与计算式自洽（防未来宽度改动静默破坏边界）', () => {
    const edge = SECTION_NAV_WIDTH + AGENT_PANEL_DEFAULT_WIDTH + CHAPTER_COL_WIDTH + EDITOR_MIN_WIDTH
    expect(edge).toBe(1160)
    expect(shouldCollapseChapterList(edge, AGENT_PANEL_DEFAULT_WIDTH)).toBe(false)
    expect(shouldCollapseChapterList(edge - 1, AGENT_PANEL_DEFAULT_WIDTH)).toBe(true)
  })
  it('非有限值：不折叠（保守，不误伤宽窗）', () => {
    expect(shouldCollapseChapterList(Number.NaN, 320)).toBe(false)
    expect(shouldCollapseChapterList(Number.POSITIVE_INFINITY, 320)).toBe(false)
    expect(shouldCollapseChapterList(1000, Number.NaN)).toBe(false)
    expect(shouldCollapseChapterList(1000, Number.POSITIVE_INFINITY)).toBe(false)
  })
})
