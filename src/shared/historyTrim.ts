// 对话历史单条消息的预算裁剪（2026-09-11 上下文管理收尾，对齐 buildWritingContext 「装配结尾」修复）。
// 此前 engine.ts 用 slice(0, 4000) 只留头部：用户粘贴长文（正文/设定片段 > 4000 字符）时模型只见开头，
// 结尾（往往是刚写到、正被讨论的部分）被裁掉。正解：超预算时保留头+尾各一半，中段注明省略——
// 模型知道中间还有内容、需要时可 zj_read_doc 现读；assistant 回复超长时同样保尾（结论常在末尾）。
export const HISTORY_MSG_CAP = 4000

export function trimHistoryMessage(content: string, cap = HISTORY_MSG_CAP): string {
  if (content.length <= cap) return content
  const half = Math.floor(cap / 2)
  const head = content.slice(0, half)
  const tail = content.slice(-half)
  const omitted = content.length - cap
  return `${head}\n…（本条消息超过 ${cap} 字符预算：中间 ${omitted} 字符已省略；需要中间内容请整段重贴或 zj_read_doc 读对应文档）…\n${tail}`
}
