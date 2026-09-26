import { useState } from 'react'
import { Check, HelpCircle, Send } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import type { AskQuestion, AskAnswer } from '../../../../shared/types'
import { answerAgent } from './harness'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/utils'

interface Props {
  id: string
  batch: string
  questions: AskQuestion[]
  onAnswered: () => void
  /** 已有已提交记录（store.answered）：重挂后恢复「已提交」态，防止重复提交 */
  answered?: boolean
  /** 轮次以停止/错误终了时问题未作答（2026-09-26 智能层候选1）：冻结交互并落「已取消 · 问题未作答」中性终态 */
  cancelled?: boolean
}

/** 单选（默认）选项项的选中态 */
type Sel = {
  options: string[]
  custom: string
}

function initSel(questions: AskQuestion[]): Sel[] {
  return questions.map((q) => ({ options: [], custom: '' }))
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

function pickOne(list: string[], v: string): string[] {
  return list.includes(v) ? [] : [v]
}

export default function AskCard({ id, batch, questions, onAnswered, answered, cancelled }: Props) {
  const [sel, setSel] = useState<Sel[]>(() => initSel(questions))
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(answered ?? false)
  const [err, setErr] = useState('')
  const ready = sel.some((s) => s.options.length > 0 || s.custom.trim())
  // 已取消=轮次停止/错误终了且未作答：交互冻结（提交按钮隐藏、选项与输入禁用），仅留中性终态声明
  const isCancelled = !!cancelled && !submitted

  async function submit() {
    if (!ready || submitting) return
    setSubmitting(true)
    setErr('')
    const answers: AskAnswer[] = questions.map((q, i) => ({
      id: q.id,
      selected: sel[i].options,
      custom: sel[i].custom.trim() || undefined
    }))
    const r = await answerAgent(batch, answers)
    if (r?.ok) {
      setSubmitted(true)
      onAnswered()
    } else {
      setErr(r?.error ?? '提交失败')
      setSubmitting(false)
    }
  }

  return (
    <div className="rounded-xl border border-hair bg-surface p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/15 text-accent">
          <HelpCircle className="h-3 w-3" />
        </span>
        <span className="text-xs font-medium text-ink">需要你确认</span>
      </div>
      <div className="space-y-3">
        {questions.map((q, qi) => (
          <div key={q.id}>
            {q.header && <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">{q.header}</div>}
            <div className="text-xs leading-5 text-ink">{q.question}</div>
            {q.options?.length ? (
              <div className="mt-1.5 space-y-1">
                {q.options.map((op) => {
                  const checked = sel[qi].options.includes(op.label)
                  return (
                    <button
                      key={op.label}
                      type="button"
                      disabled={isCancelled}
                      onClick={() =>
                        setSel((prev) => {
                          const next = prev.slice()
                          next[qi] = {
                            ...next[qi],
                            options: q.multiSelect ? toggle(next[qi].options, op.label) : pickOne(next[qi].options, op.label)
                          }
                          return next
                        })
                      }
                      className={cn(
                        'flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors',
                        checked ? 'border-accent bg-accent/10' : 'border-hair hover:bg-surface-2',
                        isCancelled && 'pointer-events-none opacity-60'
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                          q.multiSelect ? 'rounded' : 'rounded-full',
                          checked ? 'border-accent bg-accent text-accent-ink' : 'border-ink-3'
                        )}
                      >
                        {checked && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <span>
                        <span className="block text-xs text-ink">{op.label}</span>
                        {op.description && <span className="block text-[10px] leading-4 text-ink-3">{op.description}</span>}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null}
            <input
              value={sel[qi].custom}
              disabled={isCancelled}
              onChange={(e) =>
                setSel((prev) => {
                  const next = prev.slice()
                  next[qi] = { ...next[qi], custom: e.target.value }
                  return next
                })
              }
              placeholder="或直接输入你的回答…"
              className="mt-1.5 h-8 w-full rounded-lg border border-hair bg-surface-2 px-2 text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-accent/60 disabled:opacity-60"
            />
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {isCancelled ? (
          <span data-testid="ask-cancelled" className="flex items-center gap-1 text-xs text-ink-3">
            <HelpCircle className="h-3.5 w-3.5" /> 已取消 · 问题未作答
          </span>
        ) : submitted ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" /> 已提交，模型继续中…
          </span>
        ) : (
          <>
            <Button size="sm" className="h-7 px-3 text-xs [&_svg]:size-3" onClick={() => void submit()} disabled={!ready || submitting}>
              {submitting ? <LoadingIndicator size={12} /> : <Send />}
              <span className="ml-1">提交回答</span>
            </Button>
            {err && <span className="text-[11px] text-danger">{err}</span>}
          </>
        )}
      </div>
    </div>
  )
}
