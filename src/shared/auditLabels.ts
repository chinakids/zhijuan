// ===== 织卷 · 检查类名称（shared 单一权威源，2026-10-28 体验层） =====
// 为什么抽出来：检查类名此前只活在渲染层 AuditDrawer（K_TITLE/K_SHORT 两个局部常量），
// 而主进程 auditAuto 生成提案理由时只能拼内部 id（'检查 · presence'）——用户层直接看到英文 id
// （违 docs/文案口径表「用户层术语中文」）。两处共引一份表，再加新检查类只改这里。
// 口径：TITLE=抽屉标题/toast/报告名（「人物在场核查」）；SHORT=菜单项/徽标/提案理由（「在场」）。
import type { AuditKind } from './types'

export const AUDIT_KIND_TITLE: Record<AuditKind, string> = {
  consistency: '一致性巡查',
  review: '冷读报告',
  perspectives: '多视角审视',
  presence: '人物在场核查',
  order: '切片时序核查',
  unused: '人物档案腐坏核查',
  actgaps: '正文缺段核查',
  sliceord: '档案切片核查',
  nameform: '称谓发现核查',
  mixform: '称谓混用核查',
  overuse: '用词重复核查',
  repeat: '复读检测核查'
}

export const AUDIT_KIND_SHORT: Record<AuditKind, string> = {
  consistency: '巡查',
  review: '冷读',
  perspectives: '视角',
  presence: '在场',
  order: '时序',
  unused: '档案',
  actgaps: '缺段',
  sliceord: '切片',
  nameform: '称谓',
  mixform: '混用',
  overuse: '用词',
  repeat: '复读'
}