/**
 * 守卫「未建档」条目快速建档共享实现（2026-09-15 创作层从 GuardIssuesNote 抽出）：
 * 四入口（Novel 浮条/Outline/HistoryDrawer/EditCard）的「建档案」按钮与
 * 批注接受 toast 的「为 N 名人物建档案」按钮共用同一判据与写盘语义，
 * 防两处行为漂移（一致性 = 同一实现）。
 *
 * personRelOf 为纯函数（可单测）；bulkQuickCreate 依赖 window.zhijuan 读写，
 * 置于单独的 guardBulk.ts（仅渲染层项目引用，node 单测项目不接触 window）。
 */
import type { SyncIssue } from '../../../../shared/types'
import { sanitizeFile } from '../../../../shared/paths'

/** 从守卫 target（人物/<名>.md）归一化出可写路径；非人物 target / 空名返回 null */
export function personRelOf(target: string): string | null {
  if (!target.startsWith('人物/')) return null
  const name = target.slice('人物/'.length).replace(/\.md$/, '').trim()
  if (!name) return null
  return `人物/${sanitizeFile(name)}.md`
}

/** 守卫明细里「未建档」条目的统一判据（toast 批量建档按钮只对这类条目生效） */
export function isUnfiledIssue(it: SyncIssue): boolean {
  return it.action === 'dropped' && it.unfiled === true
}
