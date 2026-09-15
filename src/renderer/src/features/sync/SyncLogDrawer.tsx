// ===== 切片同步历史日志 · 抽屉（创作层 2026-09-16：候选「同步历史日志」）=====
// 时间线页「同步记录」→ 右侧抽屉逐条列出最近切片同步（最新在前）：
// 时间/章节/切片/人档基数/提案数/守卫数/结果（失败附错误摘要）。只读、按需打开，不打扰创作流。
// 数据源：main/agent/syncLog.ts 读 `.zhijuan/sync-log.jsonl`（真机）/ devShim 内存（演示）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { History } from 'lucide-react'
import { ScrollArea } from '../../components/ui/scroll-area'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/utils'
import { useModalA11y } from '../../lib/useModalA11y'
import type { SyncLogEntry } from '../../../../shared/types'

interface Props {
  projectId: string
  open: boolean
  onClose: () => void
}

/** 时间戳 → 「MM-DD HH:mm」 */
function fmtTime(t: number): string {
  const d = new Date(t)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 章节相对路径 → 「第NN章 题名」；无章号则原样显示（兼容 第NN章_题名.md 下划线分隔） */
function fmtChapter(rel: string): string {
  const name = rel.replace(/^正文\//, '').replace(/\.md$/, '')
  const m = /^第\s*(\d+)\s*章[_-\s]*([\s\S]*)$/.exec(name)
  if (m) return `第${m[1]}章${m[2] ? ' ' + m[2].replace(/^[_-\s]+/, '') : ''}`
  return name
}

export default function SyncLogDrawer({ projectId, open, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  useModalA11y(open, panelRef, onClose)
  const [entries, setEntries] = useState<SyncLogEntry[] | null>(null)
  const [loadErr, setLoadErr] = useState('')

  const reload = useCallback(() => {
    setLoadErr('')
    setEntries(null)
    window.zhijuan
      .syncLogList(projectId)
      .then((l) => setEntries(l))
      .catch((e) => setLoadErr(String((e as Error).message ?? e)))
  }, [projectId])

  useEffect(() => {
    if (open) reload()
  }, [open, reload])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20 animate-in fade-in">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label="同步记录"
        className="flex h-full w-[400px] flex-col border-l border-hair bg-paper shadow-[var(--shadow)] animate-in fade-in slide-in-from-right-3"
      >
        <div className="flex h-12 shrink-0 items-center border-b border-hair px-4">
          <History className="mr-2 h-4 w-4 text-accent" />
          <span className="text-sm font-medium">同步记录</span>
          <span className="ml-2 shrink-0 text-[11px] text-ink-3">
            {entries !== null && !loadErr ? `最近 ${entries.length} 条` : ''}
          </span>
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-[11px]"
            onClick={onClose}
            data-testid="sync-log-close"
          >
            收起
          </Button>
        </div>

        {loadErr ? (
          <div className="p-4">
            <p className="text-sm font-medium text-danger">读取同步记录失败</p>
            <p className="mt-1 break-all text-xs text-ink-3">{loadErr}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={reload}>
              重试
            </Button>
          </div>
        ) : entries === null ? (
          <div className="p-4 text-sm text-ink-3">正在读取同步记录…</div>
        ) : entries.length === 0 ? (
          <div className="p-4">
            <p className="text-sm text-ink-2">还没有同步记录</p>
            <p className="mt-1 text-xs text-ink-3">保存正文会触发一次切片同步；每次比对都记在这里，可随时回溯。</p>
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            {entries.map((e, i) => (
              <div
                key={e.time + '|' + e.chapter + '|' + i}
                data-testid="sync-log-item"
                data-ok={e.ok ? '1' : '0'}
                className="border-b border-hair px-4 py-3"
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      e.ok ? 'bg-accent' : 'bg-danger'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="shrink-0 font-medium text-ink">{fmtTime(e.time)}</span>
                      <span className="min-w-0 truncate text-ink-2">{fmtChapter(e.chapter)}</span>
                      {e.slice && <span className="shrink-0 text-ink-3">切片「{e.slice}」</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-3">
                      <span>人档 {e.fileCount}</span>
                      <span>提案 {e.itemCount}</span>
                      {e.guardCount > 0 && <span className="text-warn">守卫 {e.guardCount}</span>}
                      {!e.ok && <span className="min-w-0 truncate text-danger">失败{e.error ? '：' + e.error : ''}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
