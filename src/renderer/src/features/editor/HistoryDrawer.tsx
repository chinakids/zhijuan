// ===== 正文版本历史 · 抽屉（M3）：版本列表 + 行级 diff 对比 + 一键恢复 =====
// 形态：自动快照制（见 docs/正文版本历史-产品规划-2026-09-10.md）。
// 恢复 = 读该版全文 → writeDoc（主进程写入前会自动把当前版再留一档，恢复天然可反悔）。
import { useCallback, useEffect, useMemo, useState } from 'react'
import { History, Inbox, RotateCcw } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import type { HistorySnapshot } from '../../../../shared/types'
import { countWords } from '../../../../shared/count'
import { Button } from '../../components/ui/button'
import { ScrollArea } from '../../components/ui/scroll-area'
import { cn } from '../../lib/utils'
import { buildDiffView, DIFF_MAX_ROWS } from './diffView'

interface Props {
  projectId: string
  /** 相对项目根的文件路径（约定 正文/ 前缀） */
  rel: string
  open: boolean
  onClose: () => void
}

/** 版本文件名 yyyyMMdd-HHmmss-SSS → 2026-09-10 09:21:33 */
function fmtTime(name: string): string {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(\d{3})/)
  if (!m) return name.replace(/\.md$/, '')
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
}

export default function HistoryDrawer({ projectId, rel, open, onClose }: Props) {
  const [snaps, setSnaps] = useState<HistorySnapshot[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [curText, setCurText] = useState('')
  const [oldText, setOldText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (keepMsg = false) => {
    setLoading(true)
    if (!keepMsg) setMsg('')
    try {
      const list = await window.zhijuan.listHistory(projectId, rel)
      const cur = (await window.zhijuan.readDoc(projectId, rel)) ?? ''
      setSnaps(list)
      setCurText(cur)
      setSel(null)
      setOldText(null)
      setConfirming(false)
      // 默认选中最新一版，打开即可看对比
      if (list.length > 0) {
        const t = await window.zhijuan.readHistory(projectId, rel, list[0].name)
        setSel(list[0].name)
        setOldText(t)
      }
    } finally {
      setLoading(false)
    }
  }, [projectId, rel])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const pick = async (name: string) => {
    setSel(name)
    setConfirming(false)
    setMsg('')
    const t = await window.zhijuan.readHistory(projectId, rel, name)
    setOldText(t)
  }

  const restore = async () => {
    if (!sel || oldText === null || busy) return
    setBusy(true)
    setMsg('')
    try {
      await window.zhijuan.writeDoc(projectId, rel, oldText)
      setMsg('✓ 已恢复；恢复前的正文已自动留档，可在列表继续找回。')
      await load(true)
    } catch (e) {
      setMsg('恢复失败：' + String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const view = useMemo(() => (sel && oldText !== null && oldText !== curText ? buildDiffView(oldText, curText) : null), [sel, oldText, curText])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 animate-in fade-in">
      <div className="flex h-full w-[600px] flex-col border-l border-hair bg-paper shadow-[var(--shadow)] animate-in fade-in slide-in-from-right-3">
        <div className="flex h-12 shrink-0 items-center border-b border-hair px-4">
          <History className="mr-2 h-4 w-4 text-accent" />
          <span className="text-sm font-medium">版本历史</span>
          <span className="ml-2 truncate text-[11px] text-ink-3" title={rel}>{rel}</span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-[11px]" onClick={onClose}>收起</Button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-ink-3">
            <LoadingIndicator size={16} /> 读取历史…
          </div>
        ) : snaps.length === 0 ? (
          <div className="flex flex-1 flex-col items-center gap-2 py-20 text-ink-3">
            <Inbox className="h-6 w-6" />
            <p className="max-w-xs text-center text-xs">还没有历史版本。保存正文且内容有变化时，旧内容会自动留档一版（每文件最多 50 版）。</p>
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center gap-px border-b border-hair px-3 py-2">
              <ScrollArea className="flex-1">
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-1 py-0.5 text-[10px] text-ink-3">共 {snaps.length} 版（新→旧，最多 50 版）</span>
                  {snaps.map((s, i) => (
                    <button
                      key={s.name}
                      onClick={() => void pick(s.name)}
                      className={cn(
                        'h-6 shrink-0 whitespace-nowrap rounded-full border px-2 text-[10px] transition-colors',
                        sel === s.name ? 'border-accent bg-accent-soft text-accent' : 'border-hair bg-surface-2 text-ink-2 hover:border-accent/50'
                      )}
                      title={`${fmtTime(s.name)} · ${s.size} 字节${i === 0 ? ' · 最新' : ''}`}
                    >
                      {i === 0 ? '最新' : `v${snaps.length - i}`} · {fmtTime(s.name)}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-3 py-2">
              {msg && <p className="mb-2 rounded-md bg-accent-soft/60 px-2 py-1 text-[11px] text-accent">{msg}</p>}
              {sel && oldText !== null && (
                <>
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] text-ink-3">
                    <span className="shrink-0">对比：{fmtTime(sel)} → 当前</span>
                    <span className="shrink-0">−{view?.del ?? 0} / +{view?.ins ?? 0} 行</span>
                    <span className="ml-auto shrink-0">当前正文约 {countWords(curText)} 字；本版约 {countWords(oldText)} 字</span>
                  </div>
                  {view && view.rows.length > 0 ? (
                    <div className="rounded-lg border border-hair bg-surface font-mono text-[11px] leading-5">
                      {view.rows.map((r, i) => (
                        <div key={i}>
                          {r.skipped !== undefined && r.skipped > 0 && (
                            <div className="px-2 py-0.5 text-center text-[10px] text-ink-3">⋯ 省略 {r.skipped} 行</div>
                          )}
                          <div
                            className={cn(
                              'whitespace-pre-wrap break-all px-2 py-px',
                              r.kind === 'del' && 'bg-danger-soft/70 text-danger',
                              r.kind === 'ins' && 'bg-accent-soft/70 text-accent',
                              r.kind === 'eq' && 'text-ink-2'
                            )}
                          >
                            <span className="mr-1 select-none opacity-60">{r.kind === 'del' ? '−' : r.kind === 'ins' ? '+' : ' '}</span>
                            {r.text || ' '}
                          </div>
                        </div>
                      ))}
                      {view.truncated && <div className="px-2 py-1 text-center text-[10px] text-ink-3">（差异过多，仅显示前 {DIFF_MAX_ROWS} 行）</div>}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-hair bg-surface p-4 text-center text-xs text-ink-3">该版本与当前正文完全一致，无差异。</div>
                  )}
                  <div className="mt-2 flex items-center gap-2 pb-2">
                    <Button
                      size="sm"
                      className={cn('h-7 shrink-0 px-2 text-[11px] [&_svg]:size-3', confirming && 'bg-danger text-white')}
                      disabled={busy || oldText === null}
                      onClick={() => {
                        if (!confirming) { setConfirming(true); return }
                        void restore()
                      }}
                    >
                      <RotateCcw className="mr-1" />
                      {confirming ? '再次点击确认恢复' : '恢复此版本'}
                    </Button>
                    <span className="text-[10px] text-ink-3">恢复前会自动留存当前版本，误点可在列表找回。</span>
                  </div>
                </>
              )}
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  )
}
