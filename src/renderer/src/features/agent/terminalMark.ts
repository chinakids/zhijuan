/**
 * 终态标记族（2026-09-26 体验层，候选 1「输出截断标记视觉走查」收口）。
 *
 * 背景：智能层 3801421 曾经把「（输出已截断）」直接拼进 assistant 消息 content 尾部，
 * 与更早的「（已停止）」同法（`\n\n<标记>`）。体验层走查结论=标记与正文同字号同色渲染，
 * ①可辨识性不足（被当回复正文）；②标记进后续轮次历史载荷（污染模型上下文）。
 * 收口：终态改为消息级字段 `terminalMark`，独立状态元素渲染（11px + 语义分级色 + icon），
 * content 保持纯模型文本；本模块只读纯函数 `parseTerminalSuffix` 兼容旧会话内消息
 * （旧实现拼在 content 尾部的标记在渲染前剥离，不差分毫）。
 *
 * 分级口径（HIG Feedback「match the significance to how it's delivered」+
 *「don't warn when the outcome is expected」）：stopped=用户主动停止=预期结果→中性不警示；
 * truncated=max-tokens 触顶=非自愿内容不全→警示（与 HealthBar/大纲「待回建」同 warn 语义色）。
 * 文案=文案口径表既有行（文本不动，勿改写）。
 */

export type TerminalMark = 'stopped' | 'truncated'

/** 终态标记文案（与文案口径表行一致，勿改文本） */
export const TERMINAL_TEXT: Record<TerminalMark, string> = {
  stopped: '（已停止）',
  truncated: '（输出已截断）'
}

/** 旧实现拼进 content 尾部的后缀与终态类型的映射（截断在前：两个标记不会同时出现，顺序无关紧要） */
const SUFFIXES: Array<[TerminalMark, string]> = [
  ['truncated', '（输出已截断）'],
  ['stopped', '（已停止）']
]

/**
 * 剥离 content 尾部的旧式终态标记（仅精确匹配 `\n\n<标记>` 后缀；作者正文末尾
 * 恰好有这样一句的概率可忽略，且保留了「标记只认固定全串」的严格性）。
 * 返回剥离后的 body 与识别出的终态（未识别=null）。
 */
export function parseTerminalSuffix(content: string): { body: string; mark: TerminalMark | null } {
  for (const [mark, text] of SUFFIXES) {
    const suffix = '\n\n' + text
    if (content.endsWith(suffix)) return { body: content.slice(0, -suffix.length), mark }
  }
  return { body: content, mark: null }
}
