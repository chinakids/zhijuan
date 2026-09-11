import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clapperboard, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react'
import type { DirectorCheckResult } from '../../../../shared/types'
import { cn } from '../../lib/utils'
import { toast } from '../../components/ui/toast'
import { countTrouble } from './trouble'

const SECTIONS: {
  key: keyof DirectorCheckResult
  title: string
  color: (s: string) => string
  label: (s: string) => string
}[] = [
  {
    key: 'arcs',
    title: '情绪弧分段',
    color: (s) => (s === 'done' ? 'bg-success-soft text-success' : s === 'partial' ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger'),
    label: (s) => (s === 'done' ? '兑现' : s === 'partial' ? '部分兑现' : '没兑现')
  },
  {
    key: 'axes',
    title: '人物行为轴',
    color: (s) => (s === 'aligned' ? 'bg-success-soft text-success' : s === 'drifted' ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger'),
    label: (s) => (s === 'aligned' ? '守位' : s === 'drifted' ? '漂移' : '没写到')
  },
  {
    key: 'redlines',
    title: '写作红线',
    color: (s) => (s === 'kept' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'),
    label: (s) => (s === 'kept' ? '守住' : '被破')
  },
  {
    key: 'hooks',
    title: '钩子',
    color: (s) => (s === 'paid' ? 'bg-success-soft text-success' : s === 'open' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent'),
    label: (s) => (s === 'paid' ? '已还' : s === 'open' ? '仍悬着' : '新埋')
  }
]

interface Props {
  projectId: string
  /** 当前选中章节（章卡或导演板都可映射回）；空时整抽屉只展示提示 */
  chapter: { name: string; file: string } | null
  open: boolean
  onClose: () => void
  /** 本章是否已有分幕草稿（没有时「重写该段」不可用：先分幕生成） */
  actsExists?: boolean
  /** 用户点「重写第 N 段」：只重写该分幕段（与补写缺段同一条 only 通道），由大纲区执行并刷新 */
  onRewriteSeg?: (seg: number) => void
  /** 重写进行中（按钮转圈/禁用） */
  rewriting?: boolean
}

/** 导演兑现检查：写完一章后对照导演板核对承诺兑没兑现（情绪弧 / 行为轴 / 红线 / 钩子） */
export default function DirectorCheckDrawer({ projectId, chapter, open, onClose, actsExists = false, onRewriteSeg, rewriting = false }: Props) {
  const [res, setRes] = useState<DirectorCheckResult | null>(null)
  const [running, setRunning] = useState(false)
  const [err, setErr] = useState('')

  // 抽屉是否在看的实时镜像：跑核对时用户可能关掉抽屉（组件不卸载、state 保留），
  // 完成后若抽屉已不在看，把「有 N 处未兑现/失败」用全局 toast 带到外面（HIG：当前视图已呈现则前台不通知）。
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])

  const run = useCallback(async () => {
    if (!chapter) return
    setRunning(true)
    setErr('')
    try {
      const r = await window.zhijuan.agentDirectorCheck(projectId, '正文/' + chapter.file)
      if (r.ok) {
        setRes(r.result)
        if (!openRef.current) {
          const n = countTrouble(r.result)
          if (n > 0)
            toast.add({ kind: 'warning', title: `兑现检查：${n} 处未兑现`, description: '重开「兑现检查」抽屉可看明细' })
        }
      } else {
        setErr(r.error ?? '兑现检查失败')
        if (!openRef.current) toast.add({ kind: 'error', title: '兑现检查失败', description: r.error ?? '未知原因' })
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      setErr(msg)
      if (!openRef.current) toast.add({ kind: 'error', title: '兑现检查失败', description: msg })
    } finally {
      setRunning(false)
    }
  }, [projectId, chapter])

  useEffect(() => {
    if (!open || !chapter) return
    setRes(null)
    setErr('')
    void run()
  }, [open, chapter, run])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/10 animate-in fade-in" onClick={onClose}>
      <div className="flex h-full w-[460px] max-w-[94vw] flex-col border-l border-hair bg-surface shadow-[var(--shadow)] animate-in fade-in slide-in-from-right-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-hair px-4 py-3">
          <Clapperboard className="h-4 w-4 text-accent" />
          <span className="truncate text-sm font-semibold">导演兑现检查 · {chapter?.name ?? '-'}</span>
          <span className="flex-1" />
          <button onClick={onClose} className="text-ink-3 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!chapter ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-ink-3">
            先在左边选中一章（章卡或导演板），再点「兑现检查」。这是「先设定后成文」的收尾：写完对照导演板看承诺兑没兑现。
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-hair px-4 py-2 text-[11px] text-ink-3">
              <ShieldCheck className="h-3.5 w-3.5" />
              {running ? (
                <span className="flex items-center gap-1 text-accent"><Loader2 className="h-3 w-3 animate-spin" /> 写作引擎对照导演板核本章…（一两分钟）</span>
              ) : err ? (
                <span className="text-danger">{err}</span>
              ) : (
                <span>对照导演板 {res?.arcs.length ?? 0} 段弧 / {res?.redlines.length ?? 0} 条红线核对完成。</span>
              )}
              <span className="flex-1" />
              {res && !running && (
                <button
                  onClick={() => {
                    setRes(null)
                    setErr('')
                    void run()
                  }}
                  className="flex items-center gap-1 text-ink-3 hover:text-ink"
                >
                  <RefreshCw className="h-3 w-3" /> 重跑
                </button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!err && res && res.summary && (
                <p className="mb-3 rounded-lg border border-hair bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">{res.summary}</p>
              )}
              {!err && res && SECTIONS.map((sec) => {
                const rows = (res[sec.key] as { ref: string; status: string; note: string }[]) ?? []
                if (!rows.length) return null
                return (
                  <div key={sec.key} className="mb-3">
                    <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-ink-2">
                      {sec.title}
                      <span className="text-ink-3">{rows.length} 条</span>
                    </p>
                    {rows.map((it, i) => (
                      <div key={sec.key + i} className={cn('mb-2 rounded-lg border bg-surface p-3', it.status === 'broken' || it.status === 'missed' ? 'border-danger/40' : 'border-hair')}>
                        <div className="flex items-start gap-2">
                          <span className={cn('mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', sec.color(it.status))}>{sec.label(it.status)}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs leading-snug text-ink">
                              {it.status === 'broken' || it.status === 'missed' ? <span className="mr-1 text-danger">▲</span> : it.status === 'paid' || it.status === 'done' || it.status === 'kept' || it.status === 'aligned' ? <span className="mr-1 text-success"><Check className="inline h-3 w-3" /></span> : null}
                              {it.ref}
                            </p>
                            <p className="mt-1 text-[11px] text-ink-2">{it.note}</p>
                            {sec.key === 'arcs' && (it.status === 'missed' || it.status === 'partial') && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onRewriteSeg?.(i + 1)
                                }}
                                disabled={rewriting || !actsExists}
                                title={
                                  actsExists
                                    ? `只重写「第 ${i + 1} 段」的草稿（其余段保留），写好后可再点「兑现检查」重查`
                                    : '本章还没有分幕草稿：先在左侧点「分幕生成」，再来重写这一段'
                                }
                                className="mt-1.5 flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-warn px-1.5 py-0.5 text-[10px] text-warn transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
                              >
                                <RefreshCw className={cn('h-2.5 w-2.5', rewriting && 'animate-spin')} />
                                {rewriting ? '重写中…' : `重写第 ${i + 1} 段`}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
              {!err && res && !res.summary && !res.arcs.length && !res.axes.length && !res.redlines.length && !res.hooks.length && (
                <p className="py-10 text-center text-xs text-ink-3">这一遍没有核对出值得写下的条目。</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
