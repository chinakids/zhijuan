import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, RefreshCw, Waypoints, X } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import type { StructureCheckResult } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { toast } from '../../components/ui/toast'
import { useModalA11y } from '../../lib/useModalA11y'

interface Props {
  projectId: string
  open: boolean
  onClose: () => void
}

/** 双线结构点巡检：按时间线核对全书结构点分布与早线收束状态（只读报告，不改稿；创作层 2026-09-21） */
export default function StructureCheckDrawer({ projectId, open, onClose }: Props) {
  const [res, setRes] = useState<StructureCheckResult | null>(null)
  // 弱结果标记：提取失败（runSubtask 带 lastRaw）≠ 零条目——显示「检查未完成」而非「没发现问题」
  const [weak, setWeak] = useState(false)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')

  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])
  const panelRef = useRef<HTMLDivElement>(null)
  useModalA11y(open, panelRef, onClose)

  const run = useCallback(async () => {
    setRunning(true)
    setErr('')
    try {
      const r = await window.zhijuan.agentStructureCheck(projectId)
      if (r.ok) {
        setRes(r.result)
        setWeak(r.lastRaw !== undefined)
        if (!openRef.current) {
          if (r.lastRaw !== undefined) {
            toast.add({ kind: 'error', title: '结构点巡检未完成', description: '写作引擎没有给出有效结果（输出可能被中断），重开「结构点巡检」可重试' })
          } else {
            const n = (r.result.lines?.length ?? 0) + (r.result.ends?.length ?? 0)
            if (n > 0) toast.add({ kind: 'warning', title: `结构点巡检：${n} 条结构发现`, description: '重开「结构点巡检」抽屉可看报告' })
          }
        }
      } else {
        setErr(r.error ?? '结构点巡检失败')
        if (!openRef.current) toast.add({ kind: 'error', title: '结构点巡检失败', description: r.error ?? '未知原因' })
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      setErr(msg)
      if (!openRef.current) toast.add({ kind: 'error', title: '结构点巡检失败', description: msg })
    } finally {
      setRunning(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!open) return
    setRes(null)
    setErr('')
    void run()
  }, [open, run])

  if (!open) return null

  const retry = () => {
    setRes(null)
    setWeak(false)
    setErr('')
    void run()
  }
  const empty =
    !!res && !weak && !res.summary && !res.lines.length && !res.ends.length && !(res.notes?.length)

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/10 animate-in fade-in" onClick={onClose}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label="双线结构点巡检"
        className="flex h-full w-[460px] max-w-[94vw] flex-col border-l border-hair bg-surface shadow-[var(--shadow)] animate-in fade-in slide-in-from-right-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-hair px-4 py-3">
          <Waypoints className="h-4 w-4 text-accent" />
          <span className="truncate text-sm font-semibold">双线结构点巡检</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-ink-3 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-hair px-4 py-2 text-[11px] text-ink-3">
          <Waypoints className="h-3.5 w-3.5" />
          {running ? (
            <span className="flex items-center gap-1 text-accent">
              <LoadingIndicator size={12} /> 写作引擎核对全书章卡与导演板…（几分钟）
            </span>
          ) : err ? (
            <span className="text-danger">{err}</span>
          ) : weak ? (
            <span className="text-warn">检查未完成：写作引擎没有给出有效结果（输出可能被中断），可重试。</span>
          ) : (
            <span>按时间线核对全书结构点分布与早线收束状态（只读，不改稿）。</span>
          )}
          <span className="flex-1" />
          {res && !running && (
            <button onClick={retry} className="flex items-center gap-1 text-ink-3 hover:text-ink">
              <RefreshCw className="h-3 w-3" /> 重跑
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!err && res && res.summary && (
            <p className="mb-3 rounded-lg border border-hair bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">{res.summary}</p>
          )}

          {!err && res && res.lines.map((line, li) => (
            <div key={li} className="mb-3">
              <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-ink-2">
                时间线：{line.name}
                <span className="text-ink-3">{line.points.length} 个结构点</span>
              </p>
              {line.points.map((p, pi) => (
                <div key={pi} className="mb-2 rounded-lg border border-hair bg-surface p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">{p.role}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-snug text-ink">{p.chapter}</p>
                      <p className="mt-1 text-[11px] text-ink-2">{p.note}</p>
                    </div>
                  </div>
                </div>
              ))}
              {line.pacingNote && <p className="px-1 text-[11px] text-ink-3">节奏观察：{line.pacingNote}</p>}
            </div>
          ))}

          {!err && res && res.ends.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-ink-2">
                早线收束检查（Weiland 双线法则⑥）
              </p>
              {res.ends.map((e, i) => (
                <div key={i} className="mb-2 rounded-lg border border-hair bg-surface p-3">
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        'mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                        e.status === 'settled' ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn'
                      )}
                    >
                      {e.status === 'settled' ? '已收束' : '仍悬着'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs leading-snug text-ink">
                        {e.status === 'settled' ? (
                          <span className="mr-1 text-success">
                            <Check className="inline h-3 w-3" />
                          </span>
                        ) : (
                          <span className="mr-1 text-warn">▲</span>
                        )}
                        早线「{e.line}」
                      </p>
                      <p className="mt-1 text-[11px] text-ink-2">{e.evidence}</p>
                      {e.note && <p className="mt-1 text-[11px] text-ink-3">{e.note}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!err && res && res.notes && res.notes.length > 0 && (
            <div className="mb-3">
              <p className="mb-1.5 px-0.5 text-[11px] font-medium text-ink-2">其他发现</p>
              {res.notes.map((n, i) => (
                <p key={i} className="mb-1.5 rounded-lg border border-hair bg-surface px-3 py-2 text-[11px] leading-relaxed text-ink-2">
                  {n}
                </p>
              ))}
            </div>
          )}

          {!err && res && weak && (
            <div className="py-10 text-center text-xs text-ink-3">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-warn" />
              <p>检查未完成：写作引擎没有给出有效结果（输出可能被中断）。</p>
              <button onClick={retry} className="mt-3 inline-flex items-center gap-1 rounded-md border border-hair px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent hover:text-accent">
                <RefreshCw className="h-3 w-3" /> 重试
              </button>
            </div>
          )}
          {empty && <p className="py-10 text-center text-xs text-ink-3">这一遍没有核对出值得写下的发现。</p>}
        </div>
      </div>
    </div>
  )
}
