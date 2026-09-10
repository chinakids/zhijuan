// ===== 织卷 · 工具结果失败判定（纯逻辑，可单测）=====
// dsh 会话的 `tool/result` 事件 data 形状（见 dsh-session SessionEventMap）：
//   { turn, step, message: { content: [ToolResultBlock...] }, error?: { name, code }, meta? }
// ToolResultBlock.isError?: boolean —— 模型面向的成败标志；顶层 error 是会话层内部失败身份。
// 渲染层「工具活动卡」据此渲染失败态；判定失败才把 ok 置 false（缺省成功，向后兼容旧事件）。

export function toolResultFailed(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, any>
  // 会话层失败标识（{ name, code }）出现即失败
  if (d.error && typeof d.error === 'object') return true
  // 模型面向的 ToolResultBlock：content[0].isError === true 即失败
  const blocks = d.message?.content
  if (Array.isArray(blocks) && blocks.length) {
    const b = blocks[0]
    if (b && typeof b === 'object' && (b as any).isError === true) return true
  }
  return false
}
