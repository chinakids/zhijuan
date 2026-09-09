// ===== 织卷 · 审计条目 → agent 指令文本（纯函数，可单测） =====
// 「审读发现」一键交给 agent 改（2026-09-09）：审读存档之后的下游处置入口——
// 抽屉每条目「让 agent 改」→ 把条目打包成一条用户消息发给 agent 区，
// 模型按建议定位原文并用 zj_edit_doc 出修改卡（采纳才写入），与「兑现检查→重写第 N 段」同一哲学。
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
  if (it.target) lines.push(`关联档案：${it.target}`)
  lines.push('改正文请用 zj_read_doc 先读原文定位，再用 zj_edit_doc 工具生成修改卡（不要整篇替换正文）。')
  return lines.join('\n')
}
