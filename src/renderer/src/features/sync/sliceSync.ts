// ===== 织卷 S4 · 切片同步：保存正文后把当前切片的设定那几处也一并推进 =====
// 引擎固定走 harness（dsh 写作引擎）：模型可读章节与设定（当前章与相关设定由主进程装配注入），主进程返回解析好的补丁。
import { extractFrontMatter } from '../../../../shared/fmatter'
import { useProposalStore } from '../../store/proposals'
import type { SyncIssue } from '../../../../shared/types'
import type { SyncEvidence } from '../../../../shared/types'

export interface SliceSyncResult {
  ok: boolean
  items: number
  /** 与已拒绝提案同款而被抑制的条数（>0 时 UI 应明示「同款 N 条此前已拒绝，未重复提案」，
   * 而不是报「无设定变化」——「已被作者裁决」与「无新动向」是两种事实，2026-09-20 候选 3） */
  suppressed?: number
  /** 与未处置同款（同章已有 pending/stale）复用旧卡的条数（>0 时 UI 明示「同款 N 条待确认，
   * 未重复提案」——作者已见过但未裁决，2026-09-20 候选 3「stale 同款重弹」） */
  kept?: number
  /** 未处置复用旧卡的提案 id（与 kept 对应）：浮条「查看提案」可直接定位该卡（跨章聚合后
   * 提示在章 B、卡可能在章 A——直达路径，2026-09-20 候选 3 可行动性） */
  keptIds?: string[]
  /** 产物守卫（target 存在性防线）拦截/纠正的记录；有内容即作者需知道的处置 */
  issues?: SyncIssue[]
  /** 本次比对基准（无设定变化时的可信呈现；runSync 随 ok:true 返回） */
  evidence?: SyncEvidence
  error?: string
}

export async function runSliceSync(projectId: string, chapterRel: string): Promise<SliceSyncResult> {
  try {
    const r = await window.zhijuan.agentSync(projectId, chapterRel)
    if (!r.ok) return { ok: false, items: 0, error: r.error || '切片同步失败' }
    const issues = r.guard?.issues ?? []
    const clean = r.items ?? []
    const ch = (await window.zhijuan.readDoc(projectId, chapterRel)) ?? ''
    const slice = String(extractFrontMatter(ch).fm?.['切片'] ?? '')
    if (!clean.length) return { ok: true, items: 0, issues, evidence: r.evidence }
    const created = await window.zhijuan.createSliceProposals(projectId, chapterRel, slice, clean)
    useProposalStore.getState().refresh(projectId)
    return { ok: true, items: created.created.length, suppressed: created.suppressed, kept: created.kept, keptIds: created.keptIds ?? [], issues, evidence: r.evidence }
  } catch (e) {
    return { ok: false, items: 0, error: String((e as Error).message || e) }
  }
}
