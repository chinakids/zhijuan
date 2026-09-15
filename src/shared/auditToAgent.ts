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
  // 2026-09-15 体检：真模型实测「方向对但过度探查」——读完全部章节/跑 bash → 8 分钟引擎超时无产出；
  // 加范围约束：只处理本条、快速给方案（引导准确度与完成度双修）
  lines.push('只处理这一条发现：读完与此条相关的文件后直接给出修改方案；不要全面核查本项目，不要反复探查无关章节。')
  lines.push('定位先用 zj_read_doc 读相关文件；改动文件（正文或档案）一律用 zj_edit_doc 生成修改卡，不要整篇替换。')
  return lines.join('\n')
}
