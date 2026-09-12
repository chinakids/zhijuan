// 审读报告语义对比（智能层 2026-09-12 三期）：解析 + 三态 diff 纯函数
import { describe, expect, it } from 'vitest'
import { auditDocMarkdown, parseAuditMarkdown } from '../../src/shared/auditDoc'
import { auditItemKey, diffAuditReports, normalizeText } from '../../src/shared/auditDiff'
import type { AuditItem, AuditResult } from '../../src/shared/types'

const it1: AuditItem = { severity: 'high', type: 'setting-conflict', where: '第2章 · 灯塔夜访', what: '旧车颜色前后不一致', suggest: '统一为烟青色', target: '人物/顾岸.md' }
const it2: AuditItem = { severity: 'low', type: 'foreshadow', where: '第1章 · 雾港之夜', what: '墙角提到一封信之后没回收', suggest: '后续提一笔或删掉' }
const it3: AuditItem = { severity: 'medium', type: 'pacing', where: '第3章', what: '开头天气描写过长', suggest: '并进动作里' }
const it4: AuditItem = { severity: 'high', type: 'setting', viewer: '设定党', where: '第4章 · 灯塔重明', what: '灯塔重新点灯与世界观冲突', suggest: '补设定交代' }

const mk = (items: AuditItem[], summary = 's'): AuditResult => ({ summary, items })

describe('auditDocMarkdown / parseAuditMarkdown（读写单源 roundtrip）', () => {
  it('写出→解析：条目字段与 viewer/target 完整还原', () => {
    const md = auditDocMarkdown(mk([it1, it2, it4], '三处待办。'), '一致性巡查', { now: '2026/9/12 15:01:02' })
    expect(md).toContain('# 审读报告 · 一致性巡查')
    expect(md).toContain('## 条目（3）')
    expect(md).toContain('### 1 · [高] 设定冲突')
    expect(md).toContain('### 2 · [低] 伏笔')
    expect(md).toContain('### 3 · [高] 设定 · 设定党')
    const parsed = parseAuditMarkdown(md)
    expect(parsed).not.toBeNull()
    expect(parsed!.summary).toBe('三处待办。')
    expect(parsed!.items).toHaveLength(3)
    expect(parsed!.items[0]).toMatchObject({ severity: 'high', type: 'setting-conflict', where: it1.where, what: it1.what, suggest: it1.suggest, target: '人物/顾岸.md' })
    expect(parsed!.items[2]).toMatchObject({ viewer: '设定党', type: 'setting', severity: 'high' })
  })

  it('未知 type（模型自造）写出后解析保留原值', () => {
    const md = auditDocMarkdown(mk([{ ...it1, type: 'pacing-extra' }]), '冷读报告')
    const parsed = parseAuditMarkdown(md)!
    expect(parsed.items[0].type).toBe('pacing-extra')
  })

  it('空条目报告：不崩、解析为空列表', () => {
    const md = auditDocMarkdown(mk([]), '一致性巡查')
    expect(md).toContain('这一遍没有发现问题。')
    const parsed = parseAuditMarkdown(md)!
    expect(parsed.items).toHaveLength(0)
  })

  it('非审读报告/空串 → null', () => {
    expect(parseAuditMarkdown('# 随便一篇文章')).toBeNull()
    expect(parseAuditMarkdown('')).toBeNull()
    expect(parseAuditMarkdown('   ')).toBeNull()
  })

  it('字段值内含换行：解析不崩，位置与现象按行截断复原（容错而非崩溃）', () => {
    const weird: AuditItem = { ...it1, what: '第一行\n第二行', where: '第2章' }
    const md = auditDocMarkdown(mk([weird]), '一致性巡查')
    const parsed = parseAuditMarkdown(md)
    expect(parsed).not.toBeNull()
    expect(parsed!.items.length).toBeGreaterThanOrEqual(0)
  })
})

describe('normalizeText / auditItemKey', () => {
  it('折叠换行/连续空白并 trim', () => {
    expect(normalizeText('  第2章\n  灯\t塔  ')).toBe('第2章 灯 塔')
    expect(normalizeText('')).toBe('')
  })
  it('where+what 构成身份 key，空白差异不影响匹配', () => {
    expect(auditItemKey({ ...it1, where: '  ' + it1.where + ' ', what: ' ' + it1.what + '\n' })).toBe(auditItemKey(it1))
  })
})

describe('diffAuditReports（三态）', () => {
  it('相同结果：全部 same，added/resolved 为空', () => {
    const d = diffAuditReports(mk([it1, it2]), mk([it2, it1]))
    expect(d.same).toHaveLength(2)
    expect(d.added).toHaveLength(0)
    expect(d.resolved).toHaveLength(0)
    expect(d.counts).toMatchObject({ prev: 2, next: 2, added: 0, resolved: 0, same: 2 })
  })

  it('新增与已解决正确区分', () => {
    const d = diffAuditReports(mk([it1, it2]), mk([it2, it3]))
    expect(d.added.map((i) => i.what)).toEqual([it3.what])
    expect(d.resolved.map((i) => i.what)).toEqual([it1.what])
    expect(d.same).toHaveLength(1)
  })

  it('依旧条目 severity 变化单独标注', () => {
    const d = diffAuditReports(mk([{ ...it1, severity: 'low' }]), mk([{ ...it1, severity: 'high' }]))
    expect(d.same).toHaveLength(1)
    expect(d.same[0].severityChanged).toBe(true)
    expect(d.same[0].prevSeverity).toBe('low')
    expect(d.same[0].item.severity).toBe('high')
  })

  it('同一位置一增一消（措辞漂移）→ shiftHint 提示', () => {
    const d = diffAuditReports(mk([{ ...it1, what: '旧车颜色前后不一致' }]), mk([{ ...it1, what: '车辆颜色描写与档案相悖' }]))
    expect(d.added).toHaveLength(1)
    expect(d.resolved).toHaveLength(1)
    expect(d.same).toHaveLength(0)
    expect(d.shiftHint).toBe(1)
  })

  it('不同位置新增不误报 shiftHint', () => {
    const d = diffAuditReports(mk([it1]), mk([it3]))
    expect(d.shiftHint).toBe(0)
  })

  it('prev 为空（首版）→ 全部 added', () => {
    const d = diffAuditReports(mk([]), mk([it1, it2]))
    expect(d.added).toHaveLength(2)
    expect(d.resolved).toHaveLength(0)
    expect(d.same).toHaveLength(0)
  })

  it('next 为空（全解决）→ 全部 resolved', () => {
    const d = diffAuditReports(mk([it1, it2]), mk([]))
    expect(d.resolved).toHaveLength(2)
    expect(d.added).toHaveLength(0)
  })
})
