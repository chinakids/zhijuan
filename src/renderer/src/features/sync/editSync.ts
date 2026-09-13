// ===== 正文写入后切片同步 · 统一收口 =====
// 正文为源、设定为流：全部正文写入入口（保存正文[Novel]/分幕采纳[Outline]/EditCard 采纳[AgentPanel]/
// 批注提案接受[ProposalDrawer]/历史版本恢复[HistoryDrawer]）都走本函数触发 runSliceSync——
// 共享 60s 同文件节流（gate 在 shared/editSyncGate，纯逻辑可测），失败不节流。
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
