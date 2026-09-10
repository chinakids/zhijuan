// ===== 织卷 · 审计条目 → agent 指令文本（纯函数，可单测） =====
// 「审读发现」一键交给 agent 改（2026-09-09）：审读存档之后的下游处置入口——
// 抽屉每条目「让 agent 改」→ 把条目打包成一条用户消息发给 agent 区，
// 模型按建议定位原文并用 zj_edit_doc 出修改卡（采纳才写入），与「兑现检查→重写第 N 段」同一哲学。
// 2026-09-10：条目带 refFile（别名登记处等：仅指路）或 target（可转提案的目标档案）时，
// 指令里给出结构化档案路径，模型先 zj_read_doc 读它核实，再决定改档案还是正文。
import type { AuditItem } from './types'

/** 审计条目 → 发送给 agent 区的指令文本 */
export function auditItemToAgentPrompt(it: AuditItem): string {
  const lines = [
    '请处理下面这条审读发现：',
    `类型：${it.type}（严重度 ${it.severity}）`,
    `位置：${it.where}`,
    `现象：${it.what}`,
    `建议：${it.suggest}`
  ]
  const ref = it.refFile ?? it.target
  if (ref) lines.push(`关联档案：${ref}（处置前先 zj_read_doc 读它核实）`)
  lines.push('定位先用 zj_read_doc 读相关文件；改动文件（正文或档案）一律用 zj_edit_doc 生成修改卡，不要整篇替换。')
  return lines.join('\n')
}
