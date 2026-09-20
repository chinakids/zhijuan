// ===== 织卷 · 切片同步「重复提案」抑制（2026-09-20 创作层，候选 3 收口）=====
// 背景：runSync 每次保存都会让模型重新比对并产出「动向」补丁；作者拒绝某条提案后，
// 若正文未再变（或变化与设定无关），下次保存模型会再次产出同款动向——「刚拒又弹」，
// 设定流噪音 + 作者被迫反复处置同一件事（6117b68 已收口「空正文/复述档案」噪音的另一半）。
// 产品口径（与 GitHub code scanning dismiss 同构，见档案调研）：拒绝=作者显式裁决，
// 同款不再重提；裁决留痕（提案文件 status=rejected 即记录，长期可查可复看）。
// 只抑制 rejected、不抑制 accepted：accepted=「已应用」——若档案被回滚/正文新发生同一事态
// （GitHub「回滚后会重新告警」同构），重提是正确行为，只有「显式否决」才代表「不想再看到」。
// 判据=全字段归一化后精确相等（target/anchor/kind/before/after）——只抑制模型逐字复述的
// 同款，任何真变化（after 措辞不同/锚点不同/文本微差）都视为新动向不抑制（保守防误杀）。

import { normalizeAnchor } from './anchor'
import type { Proposal, ProposalItem } from './types'

/** 同款判定 key：全字段归一化（trim + 锚点归一）后以 \u0001 连接 */
export function sliceItemKey(it: ProposalItem): string {
  return [it.target.trim(), normalizeAnchor(it.anchor || ''), it.kind, (it.before || '').trim(), (it.after || '').trim()].join('\u0001')
}

/**
 * 候选 item 是否为「已拒绝历史」中的同款（仅 rejected 参与；settled 由调用方收集）。
 * 跨章不限定：切片设定是项目级进度（切片名已含在 anchor），作者在任意章裁决过即视为否决。
 */
export function isRejectedDuplicate(it: ProposalItem, settled: ProposalItem[]): boolean {
  const k = sliceItemKey(it)
  return settled.some((s) => sliceItemKey(s) === k)
}

/** 从候选中滤掉与已拒绝历史同款的条目；返回保留集与被抑制条数（供 UI「同款 N 条未重复提案」反馈） */
export function dedupeRejectedSliceItems(items: ProposalItem[], settled: ProposalItem[]): { kept: ProposalItem[]; suppressed: number } {
  const kept: ProposalItem[] = []
  let suppressed = 0
  for (const it of items) {
    if (isRejectedDuplicate(it, settled)) suppressed++
    else kept.push(it)
  }
  return { kept, suppressed }
}

/**
 * 未处置同款匹配（2026-09-20 候选 3「stale 同款重弹语义」）：
 * 作者见过某条 pending 切片提案但未处置（没接受没拒绝），正文再次保存后模型产出同款
 * 动向——既有语义=同章旧 pending 置 stale + 新同款照建（「刚看又弹」+ 旧卡变「已过期」）。
 * 业界对照：GitHub code scanning「未处置 alert 保持 open、不因再次扫描重开新实例」、
 * Sentry fingerprint 聚合（同一问题=同一 issue；resolved 后再现=regressed 回原实体，非新建）——
 * 未处置=同一实体继续等待作者裁决，不应复制。
 * 判据=同章 + source=slice-sync + 全字段归一化精确相等（与 isRejectedDuplicate 同 key，保守防误杀）。
 * 返回 { pending }=存在同款 pending（应保护：不置 stale、不新建）；
 *     { restore }=仅存在同款 stale（应恢复为 pending 复用旧卡，stale=技术性过期非作者裁决）。
 * sameChapter 由调用方收集（chapter 相同）；无同款返回 null。
 */
export function unsettledSameOf(it: ProposalItem, sameChapter: Proposal[]): { pending: Proposal } | { restore: Proposal } | null {
  const k = sliceItemKey(it)
  const same = (p: Proposal) => p.source === 'slice-sync' && p.items.some((x) => sliceItemKey(x) === k)
  const pend = sameChapter.find((p) => p.status === 'pending' && same(p))
  if (pend) return { pending: pend }
  const stale = sameChapter.find((p) => p.status === 'stale' && same(p))
  if (stale) return { restore: stale }
  return null
}
