/**
 * 渲染层单条回复显示截断（2026-09-27 体验层，候选 1「CHAR_LIMIT 渲染层截断评估」收口）。
 *
 * 背景：旧实现（AgentPanel.patch）在 final 时对超 60000 字的回复 `slice + '…（截断）'` **写回 content**
 * ——①消息历史载荷丢失长回复尾部（下一轮引擎 trimHistoryMessage 保头保尾，尾部已不在）；
 * ②标记拼进 content 进模型上下文（与 2026-09-26 修掉的「（已停止）/（输出已截断）」同族污染）；
 * ③流式期间 delta 路径本就全量渲染（patch trunc=false），final 才截=可见内容「缩水」突变。
 * 收口：content 存全量；显示截断移到渲染层（本模块纯函数派生，不写 store）。
 *
 * 与引擎截断（terminalMark 'truncated'，max-tokens 触顶=内容不完）**无交叠**：
 * 显示截断=内容完整、只是超长 → 中性提示不警示（HIG「don't warn when the outcome is expected」），
 * 故不复用「（输出已截断）」终态标记。
 */

/** 单条回复显示上限（渲染层安全网；非上下文预算——预算见 shared/contextCaps；引擎历史裁剪=shared/historyTrim） */
export const REPLY_DISPLAY_CAP = 60000

/** 显示截断：返回渲染文本与是否被截断（截断时仅渲染前缀；完整内容仍在 store 与后续历史载荷） */
export function clipBody(body: string, cap = REPLY_DISPLAY_CAP): { text: string; clipped: boolean } {
  if (body.length <= cap) return { text: body, clipped: false }
  return { text: body.slice(0, cap), clipped: true }
}
