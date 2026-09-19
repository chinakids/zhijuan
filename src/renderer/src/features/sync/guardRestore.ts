/**
 * 版本恢复防线（P1 F-20260917-10 衍生，2026-09-19 智能层）：
 * 历史版本「剥约定头后正文为空」而磁盘当前正文非空时，恢复该版本会把完好正文
 * 清成只剩约定头（＝2026-09-19 织卷smoke 现场「761B→92B 仅约定头」形态的破坏性重现），
 * 恢复入口必须拦截。判据与 15:00 轮 save-guard（空编辑器+非空磁盘=异常态）同构：
 * 旧版为空、现盘有正文 = 异常；两者皆空（正常首存/清空重写）不拦。
 * shouldBlockEmptyRestore 为纯函数（可单测）；调用方（HistoryDrawer.restore）负责现读磁盘。
 */
import { extractFrontMatter } from '../../../../shared/fmatter'

/** 旧版为空且现盘有正文时返回 true（应拦截恢复） */
export function shouldBlockEmptyRestore(oldText: string, curText: string): boolean {
  const o = extractFrontMatter(oldText)
  const c = extractFrontMatter(curText)
  // 该 rel 无约定头（审读报告等非章节文档）不适用本判据——零回归
  if (o.fm === null || c.fm === null) return false
  if (o.body.trim() !== '') return false
  return c.body.trim() !== ''
}
