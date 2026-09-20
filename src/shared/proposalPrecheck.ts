// 织卷 · 提案「应用前预检」（2026-09-21 候选 3「全部接受」前置预检）
// 判定源单一：applyAnchor 的所有「会失败」分支从这里取——渲染层「全部接受」前
// dry-run（kubectl --dry-run 同构：不改变状态、只报告会发生什么）与主进程真实应用
// 完全同判据，任一方改校验规则另一方自动跟随（防漂移）。
// 注意 msg 文案与 applyAnchor 既有 fail 文案逐字一致（用户可见文本不动）。
import type { ProposalItem } from './types'
import { findAnchorLine, normalizeAnchor } from './anchor'
import { extractSectionBody } from './proposalSection'

export type ApplyPrecheck = { ok: true } | { ok: false; msg: string }

/**
 * 预检一条提案在给定文档文本上「应用是否会失败」。
 * text 为 target 文件的完整内容（文件不存在传 ''，与 applyProposal 的
 * existsSync 分支语义一致：replace-text 漂移/小节被删会如实失败，追加类照常 ok）。
 */
export function precheckApply(text: string, it: ProposalItem): ApplyPrecheck {
  if (it.kind === 'append') return { ok: true }
  if (it.kind === 'replace-text') {
    // 批注同步：按原文文段精确替换（before 校验——原文被手动编辑过则失败，提示人工确认）
    if (!it.before) return { ok: false, msg: 'replace-text 缺少 before 文段' }
    if (!text.includes(it.before)) return { ok: false, msg: '原文段已变（可能被手动编辑），请人工确认' }
    return { ok: true }
  }
  const anchor = normalizeAnchor(it.anchor || '')
  if (!anchor) return { ok: true }
  const hit = findAnchorLine(text.split('\n'), anchor)
  if (!hit) {
    // 有基线（beforeExact 为字符串=生成时该节存在）而现在找不到该节 = 生成后节被删/改名
    if (it.beforeExact !== undefined && it.beforeExact !== null) {
      return { ok: false, msg: '目标小节已不存在（可能被改名或删除），请先核对' }
    }
    return { ok: true }
  }
  if (it.beforeExact !== undefined) {
    if (it.beforeExact === null) {
      // 生成时无该节、现在却有同名节 = 作者后建/其他提案新建 → 避免覆盖，请先核对
      return { ok: false, msg: '该小节生成时不存在、现已存在（可能为作者新建），为避免覆盖请先核对' }
    }
    const cur = extractSectionBody(text, it.anchor || '')
    if (cur.body !== it.beforeExact) {
      return { ok: false, msg: '该小节内容在本提案生成后已被修改（可能手动编辑或被其他提案更新），为避免覆盖请先核对' }
    }
  }
  return { ok: true }
}
