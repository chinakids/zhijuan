// ===== 正文写入后切片同步 · 统一收口（自动/批量写入入口） =====
// 正文为源、设定为流：正文写入后须触发切片同步。本文件是「非显式写入」入口的收口——
// EditCard 采纳[AgentPanel]/批注提案接受[ProposalDrawer]/历史版本恢复[HistoryDrawer]，
// 共享 60s 同文件节流（gate 在 shared/editSyncGate，纯逻辑可测），失败不节流。
// 注意：保存正文[Novel]/分幕采纳[Outline]是用户显式动作，直调 runSliceSync 每次必同步，
// 不过节流门（口径与三态语义见 docs/正文写入与切片同步-口径.md）。
// 非正文（人物/世界观/大纲审读）返回 'skipped'，绝不误触发。
import { runSliceSync, type SliceSyncResult } from './sliceSync'
import { EditSyncGate, isChapterTarget } from '../../../../shared/editSyncGate'

const gate = new EditSyncGate()

export function syncGateForTest(): EditSyncGate {
  return gate
}

/** 正文被写入后触发切片同步；返回 'skipped'（非正文）/ 'throttled'（60s 内已同步）/ 同步结果 */
export async function syncAfterChapterEdit(projectId: string, rel: string): Promise<SliceSyncResult | 'skipped' | 'throttled'> {
  if (!isChapterTarget(rel)) return 'skipped'
  const key = projectId + '|' + rel
  if (!gate.tryRun(key)) return 'throttled'
  const s = await runSliceSync(projectId, rel)
  if (!s.ok) gate.clear(key) // 失败不节流：用户再触发（采纳/保存/恢复）可重试
  return s
}
