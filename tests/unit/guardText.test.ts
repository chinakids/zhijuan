import { describe, expect, it } from 'vitest'
import { formatGuardIssuesText, guardIssueSummary } from '../../src/renderer/src/features/sync/guardText'
import type { SyncIssue } from '../../src/shared/types'

const iss = (patch: Partial<SyncIssue>): SyncIssue => ({
  target: '人物/沈眠.md',
  action: 'corrected',
  reason: '「沈眠」与现有档案近似，已纠正为 人物/沈藏.md',
  ...patch
})

describe('guardIssueSummary（守卫拦截摘要）', () => {
  it('无拦截返回空串（文本型承载不追加任何尾巴）', () => {
    expect(guardIssueSummary(undefined)).toBe('')
    expect(guardIssueSummary([])).toBe('')
  })
  it('有拦截给出「拦截 N 条」', () => {
    expect(guardIssueSummary([iss({})])).toBe('拦截 1 条')
    expect(guardIssueSummary([iss({}), iss({ action: 'dropped' })])).toBe('拦截 2 条')
  })
})

describe('formatGuardIssuesText（守卫拦截明细纯文本，toast 型承载）', () => {
  it('无拦截返回空串', () => {
    expect(formatGuardIssuesText(undefined)).toBe('')
    expect(formatGuardIssuesText([])).toBe('')
  })
  it('逐条给「处置 target：reason」，；分隔（完整 reason 不截断）', () => {
    const t = formatGuardIssuesText([
      iss({}),
      iss({ target: '人物/新角色1.md', action: 'dropped', reason: '本章「涉及人物」已列 新角色1，但 人物/新角色1.md 尚未建档' })
    ])
    expect(t).toBe(
      '已纠正 人物/沈眠.md：「沈眠」与现有档案近似，已纠正为 人物/沈藏.md；已丢弃 人物/新角色1.md：本章「涉及人物」已列 新角色1，但 人物/新角色1.md 尚未建档'
    )
  })
  it('target 与 reason 原样保留（不做任何截断/改写）', () => {
    const t = formatGuardIssuesText([iss({ target: '世界观/切片_第二幕.md', action: 'dropped', reason: 'A≤B：测试' })])
    expect(t).toContain('世界观/切片_第二幕.md')
    expect(t).toContain('A≤B：测试')
  })
})
