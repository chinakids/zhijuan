import { describe, expect, it } from 'vitest'
import { AUDIT_KIND_SHORT, AUDIT_KIND_TITLE } from '../../src/shared/auditLabels'
import type { AuditKind } from '../../src/shared/types'

// shared/auditLabels（2026-10-28 体验层抽表）：检查类名称的单一权威源。
//<|place_holder_mm_span_0442|> 主进程 auditAuto 用它拼提案理由（「检查 · 在场」），渲染层 AuditDrawer 用它做标题/菜单短名——
// 两边共引一份，防止「用户层出现 presence/order 这类内部 id」（文案口径表），也防新增检查类漏配。
const ALL: AuditKind[] = [
  'consistency', 'review', 'perspectives', 'presence', 'order', 'unused',
  'actgaps', 'sliceord', 'nameform', 'mixform', 'overuse', 'repeat'
]

describe('AUDIT_KIND_TITLE / AUDIT_KIND_SHORT（检查类名称权威表）', () => {
  it('12 类全部有全名与短名，均非空', () => {
    for (const k of ALL) {
      expect(AUDIT_KIND_TITLE[k], k).toBeTruthy()
      expect(AUDIT_KIND_SHORT[k], k).toBeTruthy()
    }
  })

  it('名称是中文（不含内部 id 的纯 ASCII 形态），短名不长于全名', () => {
    for (const k of ALL) {
      expect(AUDIT_KIND_TITLE[k]).toMatch(/[\u4e00-\u9fa5]/)
      expect(AUDIT_KIND_SHORT[k]).toMatch(/[\u4e00-\u9fa5]/)
      expect(AUDIT_KIND_SHORT[k].length).toBeLessThanOrEqual(AUDIT_KIND_TITLE[k].length)
    }
  })

  it('短名互不重复（下拉菜单/徽标要靠它区分类别）', () => {
    const shorts = ALL.map((k) => AUDIT_KIND_SHORT[k])
    expect(new Set(shorts).size).toBe(shorts.length)
  })

  it('提案理由形态「检查 · <短名>」不含英文 id', () => {
    for (const k of ALL) {
      const reason = '检查 · ' + AUDIT_KIND_SHORT[k]
      expect(reason).not.toContain(k)
    }
  })
})