/** 中断草稿恢复判定（2026-09-29 体验层候选 1 · 任务线-02 Agent体验候选 6「响应开始前中断→恢复原 prompt 草稿重发」）。
 *
 * 行为基线＝Claude Code v2.1.83：在 Claude 未产出任何响应前中断（Ctrl+C/Esc），原输入自动恢复到
 * 输入框可编辑重发；响应已开始则输入框保持清空（靠 ↑ 回取最近草稿）。
 *
 * 口径：
 * - 以「正文 delta 是否已流式」为「响应已开始」判据——think（思考）不算响应已开始：思考不是作答，
 *   作者误停时恢复草稿仍符合其意图（相关轮次由本模块 2026-09-29 拍板，详见 04-体验层.md 迭代日志）。
 * - 白白字符（trim 后为空，如 "\n\n"）视同未产出。
 * - 仅 aborted（用户停止）触发恢复；done/error 不触发（error 已有 ErrorNotice「重试」按原载荷重发）。
 */

export type SendOutcome = 'done' | 'error' | 'aborted'

export function shouldRestorePromptAfterAbort(outcome: SendOutcome, streamedBody: string): boolean {
  return outcome === 'aborted' && streamedBody.trim() === ''
}
