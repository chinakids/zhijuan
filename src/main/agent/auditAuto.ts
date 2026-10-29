// ===== 织卷 · 检查自动化（P1：本地 9 项 → 自动转提案）=====
// 设计：docs/检查自动化-提案收口-设计-2026-10-28.md
// 口径：
//   · 只跑 settings.auditAuto.enabled 开启的场景；AI 3 项由 settings.auditAuto.ai 决定（默认关）。
//   · 结果统一落「提案」箱（source='audit'），作者在提案抽屉统一处置。
//   · 去重：同 target+after 已有 pending 提案 → 跳过；同时保护旧 pending 不被 createProposals 置 stale。
//   · 只对带 target 的检查项生成提案（没有落点的纯建议不进提案箱，避免噪音）。
import { runAudit, type AuditKind } from './audit'
import { createProposals, listProposals } from '../proposals'
import { libraryRoot, readSettings } from '../settings'
import type { Proposal, ProposalItem } from '../../shared/types'
import { AUDIT_KIND_SHORT } from '../../shared/auditLabels'

/** 本地规则 9 项（零模型、秒级） */
export const LOCAL_AUDIT_KINDS: AuditKind[] = [
  'presence',
  'order',
  'unused',
  'actgaps',
  'sliceord',
  'nameform',
  'mixform',
  'overuse',
  'repeat'
]
/** AI 巡读 3 项（模型级、分钟级） */
export const AI_AUDIT_KINDS: AuditKind[] = ['consistency', 'review', 'perspectives']

/** 单类单轮转提案上限（设计 §3.3：默认 20，防一次保存把提案箱刷满） */
export const AUDIT_AUTO_MAX_PER_KIND = 20

export interface AuditAutoResult {
  ok: boolean
  created: number
  ran: { kind: AuditKind; items: number; proposals: number; error?: string }[]
}

export async function runAuditAuto(projectId: string, opts?: { ai?: boolean; kinds?: AuditKind[] }): Promise<AuditAutoResult> {
  const st = readSettings()
  const cfg = st.auditAuto ?? { enabled: true, ai: false }
  const ai = opts?.ai ?? cfg.ai
  const kinds = opts?.kinds ?? [...LOCAL_AUDIT_KINDS, ...(ai ? AI_AUDIT_KINDS : [])]
  const root = libraryRoot()
  const all = listProposals(root, projectId)
  const pending = all.filter((p) => p.status === 'pending')
  // 保护现有 pending 不被 createProposals 的「同章旧 pending 置 stale」冲掉（审计提案 chapter 都是 ''）
  const protectIds = new Set(pending.filter((p) => p.source === 'audit').map((p) => p.id))
  const keyOf = (p: { items: ProposalItem[] }): string => {
    const it = p.items[0]
    return `${it?.target ?? ''}\u0000${it?.before ?? ''}\u0000${it?.after ?? ''}`
  }
  // 去重集合=「已挂着的 pending」∪「作者已拒绝的」（2026-10-29 智能层）：
  // 只按 pending 去重会让作者拒绝过的条目在每次保存后 4s 又原样回魂（同一张卡反复弹），
  // 与 GitHub code scanning 的处置语义对齐——「Next time code scanning runs, the same code
  // won't generate an alert」（作者拒绝=已裁决，除非正文/约定头变了才会产生新的 before）。
  const seen = new Set<string>(pending.map(keyOf))
  for (const p of all) if (p.status === 'rejected') seen.add(keyOf(p))
  const ran: AuditAutoResult['ran'] = []
  let created = 0

  for (const kind of kinds) {
    try {
      const r = await runAudit(projectId, kind)
      if (!r.ok) {
        ran.push({ kind, items: 0, proposals: 0, error: r.error })
        continue
      }
      let n = 0
      for (const it of r.result.items) {
        // 单类上限（设计 §3.3：同一检查同一轮最多 20 条，防一次保存刷屏）
        if (n >= AUDIT_AUTO_MAX_PER_KIND) break
        // 落点判据：条目自带可执行 proposal（如在场核查改约定头）或自带 target（称谓/腐坏类）；
        // 两者都无=纯建议 → 只留在审计抽屉，不进提案箱（设计 §3.3「只对确定性项生成可执行卡」）。
        if (!it.proposal && !it.target) continue
        const item: ProposalItem =
          it.proposal ?? {
            target: it.target as string,
            anchor: '',
            kind: 'append',
            before: '',
            after: it.suggest + '\n\n> 依据：' + it.what,
            reason: '检查 · ' + AUDIT_KIND_SHORT[kind]
          }
        const key = `${item.target}\u0000${item.before}\u0000${item.after}`
        if (seen.has(key)) continue
        seen.add(key)
        const [p] = createProposals(root, projectId, 'audit', '', '', [item], { note: kind }, undefined, protectIds)
        protectIds.add(p.id)
        created++
        n++
      }
      ran.push({ kind, items: r.result.items.length, proposals: n })
    } catch (e) {
      ran.push({ kind, items: 0, proposals: 0, error: String((e as Error).message ?? e) })
    }
  }
  return { ok: true, created, ran }
}