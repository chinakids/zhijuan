import { RefreshCw } from 'lucide-react'
import type { AgentMsg } from './store'
import { classifyTurnError } from './turnError'
import { cn } from '../../lib/utils'

/**
 * 失败提示节（2026-09-16 智能层候选3「对话流负反馈离散场景」）。
 *
 * 语义：引擎超时/异常 → error 事件时，若本轮已产出正文修改方案或部分流式内容，
 * 呈现为 warn（琥珀）：说明「本轮未完整生成、但已有产出保留」，可继续采纳或一键重试——
 * 而不是红色硬失败（Claude Code 官方中断语义「keep the work done so far」）。
 * 无任何产出 → danger 硬失败 + 可重试。旧 append 错误路径（巡查/导演失败）→ bare 单条。
 */
export default function ErrorNotice({
  messages,
  idx,
  onRetry
}: {
  messages: AgentMsg[]
  idx: number
  onRetry?: (m: AgentMsg) => void
}) {
  const info = classifyTurnError(messages, idx)
  const m = messages[idx]
  if (!m) return null
  const errText = m.errorText || m.content || '请求失败'
  const btn = m.errorRetry && !m.retried ? (
    <button
      type="button"
      onClick={() => onRetry?.(m)}
      className={cn(
        'ml-1.5 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:opacity-80',
        info.kind === 'warn' ? 'border-warn/40 text-warn' : 'border-danger/40 text-danger'
      )}
    >
      <RefreshCw className="mr-0.5 h-2.5 w-2.5" />
      重试
    </button>
  ) : m.errorRetry && m.retried ? (
    <span className="ml-1.5 text-[10px] text-ink-3">已重试</span>
  ) : null

  if (info.bare) {
    // 旧路径（巡查/导演等直接 append 失败）：content 即错误文案，不出 markdown 只出单条提示
    return <p className="mt-1 rounded-md bg-danger-soft px-2 py-1 text-[11px] text-danger">{errText}</p>
  }
  if (info.kind === 'warn') {
    return (
      <div className="mt-1 rounded-md border border-warn/40 bg-warn-soft px-2.5 py-1.5 text-[11px] leading-relaxed text-warn">
        <span className="font-medium">本轮未完整生成：{errText}</span>
        <span className="block text-[10px] text-warn/90">
          {info.hasEditCards ? '已生成的正文修改方案仍保留，可直接查看采纳，或重试后继续' : '已生成的内容保留在上方，可重试后继续'}
          。
        </span>
        {btn}
      </div>
    )
  }
  return (
    <div className="mt-1 rounded-md bg-danger-soft px-2 py-1 text-[11px] leading-relaxed text-danger">
      <span>{errText}</span>
      {btn}
    </div>
  )
}
