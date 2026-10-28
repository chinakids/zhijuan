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
  const pending = listProposals(root, projectId).filter((p) => p.status === 'pending')
  // 保护现有 pending 不被 createProposals 的「同章旧 pending 置 stale」冲掉（审计提案 chapter 都是 ''）
  const protectIds = new Set(pending.filter((p) => p.source === 'audit').map((p) => p.id))
  const seen = new Set(pending.map((p) => `${p.items[0]?.target}\u0000${p.items[0]?.after}`))
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
        if (!it.target) continue
        const item: ProposalItem =
          it.proposal ?? {
            target: it.target,
            anchor: '',
            kind: 'append',
            before: '',
            after: it.suggest + '\n\n> 依据：' + it.what,
            reason: '检查 · ' + kind
          }
        const key = `${item.target}\u0000${item.after}`
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