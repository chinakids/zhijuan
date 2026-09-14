// ===== 切片同步「比对基准」证据小字（2026-09-14 21:45 创作层轮）=====
// 产品问题：同步结果呈现面已修齐（失败可重试/守卫明细），唯独「成功且无变化」只有一句
// 「✓ 无设定变化」——作者无法低成本确认同步真跑了、比对基准是什么（正文为源设流，
// 这个判断是作者可信基础；12:45 曾修「静默空」只覆盖模型跑偏，不含成功无变化证据）。
// 本文件：把 runSync 侧 evidence（本次比对的切片/人物清单）做成「无变化」文案的追加小字。
// 纯函数、零 IO；main（engine.ts 组装）/renderer（sliceSync.ts 透传 + 各入口文案）共用；
// 类型 SyncEvidence 在 shared/types.ts（与 SyncIssue 同类先例）。
import type { SyncEvidence } from './types'

/**
 * 「无设定变化」时的证据小字（带前导「 · 」）；无证据/全零返回 ''（调用方保持原文案）。
 * 口径（文案口径表：用户层实体「人物」，「切片」定名）：
 * - 正常：` · 已比对 切片「X」、人档 N`（+ `、M 人未建档` 仅当有盲区）
 * - 未设切片（硬信号）：` · 已比对 ⚠约定头未设切片名、人档 N`
 */
export function describeSyncEvidence(e?: SyncEvidence | null): string {
  if (!e) return ''
  const hasAny = e.slice || e.knownFiles > 0 || e.castCount > 0 || e.unarchived > 0
  if (!hasAny) return ''
  const note: string[] = []
  if (e.slice) note.push(`切片「${e.slice}」`)
  else note.push('⚠约定头未设切片名')
  note.push(`人档 ${e.knownFiles}`)
  if (e.unarchived > 0) note.push(`${e.unarchived} 人未建档`)
  return ' · 已比对 ' + note.join('、')
}
