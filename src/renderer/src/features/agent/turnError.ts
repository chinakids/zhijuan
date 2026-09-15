/**
 * 对话轮错误态分类（2026-09-16 智能层候选3「对话流负反馈离散场景」）。
 *
 * 背景：引擎超时/异常 → error 事件时，若本轮已产出正文修改卡（EditCard）或部分流式内容，
 * 作者其实握有可用成果；此时把错误渲染成红色硬失败（「请求失败：…」）会误导
 * 「本轮=零产出」。业界范式（Claude Code 官方 interactive-mode：Esc 中断
 * 「Claude keeps the work done so far」）= 中断保留成果、可重定向。本函数把
 * 「错误 + 本轮产出情况」归一为两种呈现：warn（成果保留，降级提示）/ danger（硬失败）。
 *
 * 纯函数，供 AgentPanel 渲染与单测使用；不依赖 zustand（类型用结构声明）。
 */
export type TurnErrorKind = 'warn' | 'danger'

/** 消息最小结构（与 AgentMsg 兼容的结构类型，避免运行时依赖 store） */
export interface TurnErrorMsg {
  role: string
  content: string
  error?: boolean
  errorText?: string
  kind?: string
  errorRetry?: unknown
}

export interface TurnErrorInfo {
  kind: TurnErrorKind
  /** 本轮（上一条 user 消息之后）是否已产出正文修改卡 */
  hasEditCards: boolean
  /** 错误前是否已有流式正文内容（errorText 路径下 content 非空） */
  hasPartial: boolean
  /** 旧 append 错误路径：无 errorText，content 即错误文案（不渲染 markdown，只出单条提示） */
  bare: boolean
  /** 是否可重试（有重试载荷） */
  canRetry: boolean
}

export function classifyTurnError(messages: readonly TurnErrorMsg[], idx: number): TurnErrorInfo {
  const m = messages[idx]
  if (!m || !m.error) return { kind: 'danger', hasEditCards: false, hasPartial: false, bare: true, canRetry: false }
  const bare = !m.errorText
  const hasPartial = !!m.errorText && m.content.trim().length > 0
  let hasEditCards = false
  // 本轮范围 = 本条 assistant（含）→ 下一条 user 消息（不含）；store 中工具卡（含 edit 卡）append 在气泡之后
  for (let i = idx + 1; i < messages.length; i++) {
    const x = messages[i]
    if (x.role === 'user') break
    if (x.role === 'tool' && x.kind === 'edit') {
      hasEditCards = true
      break
    }
  }
  const kind: TurnErrorKind = hasEditCards || hasPartial ? 'warn' : 'danger'
  return { kind, hasEditCards, hasPartial, bare, canRetry: !bare && !!m.errorRetry }
}
