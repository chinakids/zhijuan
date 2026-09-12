// ===== 织卷 · 审读报告语义对比（智能层 2026-09-12 三期）=====
// 回答「上次说过什么、改了吗」：按条目身份 key（where+what 归一：换行/连续空白折叠＋trim）分桶，
// 计数匹配 → 语义三态：added（这次新发现）/ resolved（上次提过、这次没再提）/ same（两次都提）。
// same 项带 prevSeverity 与 severityChanged；同 where 一增一消的「措辞漂移」对额外标 shiftHint，
// 防「全改好又全犯」误判（模型对同一问题换措辞 = resolved+added 双计，提示人工核对）。
// 纯函数、可单测；不依赖 main（node 环境直跑）。
import type { AuditItem, AuditResult } from './types'

/** 空白归一：连续空白（含全角空格/换行）折叠成单个半角空格并 trim */
export function normalizeText(s: string): string {
  return String(s ?? '').replace(/[\s\u3000]+/g, ' ').trim()
}

/** 条目身份 key：where+what 归一后拼接（\u0001 分隔避免拼接歧义） */
export function auditItemKey(it: AuditItem): string {
  return normalizeText(it.where) + '\u0001' + normalizeText(it.what)
}

/** 依旧项：展示当前版条目 + 上次 severity（变化时标出） */
export interface AuditDiffItem {
  item: AuditItem
  prevSeverity?: AuditItem['severity']
  severityChanged?: boolean
}

export interface AuditDiffResult {
  /** 这次新发现（next 独有） */
  added: AuditItem[]
  /** 上次提过、这次没再提（prev 独有 → 视为已解决/消失） */
  resolved: AuditItem[]
  /** 两次都提（依旧；severity 变化标 severityChanged） */
  same: AuditDiffItem[]
  /** 同位置出现「已解决+新增」对的数量（疑似模型措辞漂移，需人工核对） */
  shiftHint: number
  counts: { prev: number; next: number; added: number; resolved: number; same: number }
}

function bucket(items: AuditItem[]): Map<string, AuditItem[]> {
  const m = new Map<string, AuditItem[]>()
  for (const it of items) {
    const k = auditItemKey(it)
    const arr = m.get(k) ?? []
    arr.push(it)
    m.set(k, arr)
  }
  return m
}

/** 语义三态对比（prev=上一版报告结果，next=本次报告结果） */
export function diffAuditReports(prev: AuditResult, next: AuditResult): AuditDiffResult {
  const pb = bucket(prev.items)
  const nb = bucket(next.items)
  const added: AuditItem[] = []
  const resolved: AuditItem[] = []
  const same: AuditDiffItem[] = []
  for (const [k, plist] of pb) {
    const nlist = nb.get(k) ?? []
    const min = Math.min(plist.length, nlist.length)
    for (let i = 0; i < min; i++) {
      same.push({
        item: nlist[i],
        prevSeverity: plist[i].severity,
        severityChanged: plist[i].severity !== nlist[i].severity
      })
    }
    for (let i = min; i < plist.length; i++) resolved.push(plist[i])
    for (let i = min; i < nlist.length; i++) added.push(nlist[i])
  }
  for (const [k, nlist] of nb) {
    if (!pb.has(k)) for (const it of nlist) added.push(it)
  }
  // 措辞漂移提示：同位置（where 归一后）一增一消
  const wSet = (items: AuditItem[]) => new Set(items.map((i) => normalizeText(i.where)))
  const addedW = wSet(added)
  let shiftHint = 0
  for (const w of wSet(resolved)) if (addedW.has(w)) shiftHint++
  return {
    added,
    resolved,
    same,
    shiftHint,
    counts: {
      prev: prev.items.length,
      next: next.items.length,
      added: added.length,
      resolved: resolved.length,
      same: same.length
    }
  }
}
