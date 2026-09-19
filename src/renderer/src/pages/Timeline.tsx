import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Clock, Users, History } from 'lucide-react'
import LoadingIndicator from '../components/LoadingIndicator'
import type { SliceEntry } from '../../../shared/types'
import { listLinesFromEntries } from '../../../shared/line'
import { Button } from '../components/ui/button'
import { cn } from '../lib/utils'
import { EmptyState } from '../components/EmptyState'
import SyncLogDrawer from '../features/sync/SyncLogDrawer'

function chapterNo(chapter: string): number | null {
  const m = chapter.match(/第\s*(\d+)/)
  return m ? Number(m[1]) : null
}

/** 时间线视图（模块 J / E4 / 多时间线叙事 2026-09-16）：按线分组＋筛选；单线项目零打扰（保持原一维样式） */
export default function Timeline() {
  const { id } = useParams<{ id: string }>()
  const [slices, setSlices] = useState<SliceEntry[] | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [retryTick, setRetryTick] = useState(0)
  const [syncOpen, setSyncOpen] = useState(false)
  /** 线筛选：ALL 或线名；仅多线项目显示切换器 */
  const [filter, setFilter] = useState<string>('__all__')

  // 线枚举（正文为源：slices 已带 line；单线=老项目零回归）
  const lines = useMemo(() => listLinesFromEntries(slices ?? []), [slices])
  const multi = lines.length > 1
  const groups = useMemo(() => {
    if (!slices || !slices.length) return []
    if (!multi) return [{ line: '主线', entries: slices }]
    return lines
      .map((ln) => ({ line: ln.name, entries: slices.filter((s) => s.line === ln.name) }))
      .filter((g) => g.entries.length > 0)
  }, [slices, lines, multi])
  const visibleGroups = useMemo(() => (filter === '__all__' ? groups : groups.filter((g) => g.line === filter)), [groups, filter])

  useEffect(() => {
    if (!id) return
    let alive = true
    setLoadErr('')
    void window.zhijuan
      .listSlices(id)
      .then((s) => alive && setSlices(s))
      .catch((e) => alive && setLoadErr(String((e as Error).message ?? e)))
    return () => {
      alive = false
    }
  }, [id, retryTick])

  if (slices === null && !loadErr) {
    return (
      <div className="flex items-center justify-center gap-2 p-6 text-sm text-ink-3">
        <LoadingIndicator size={16} />
        <span>正在读取项目时间线…</span>
      </div>
    )
  }
  if (loadErr) {
    return (
      <div className="mx-auto mt-24 max-w-sm rounded-xl border border-dashed border-danger/40 p-8 text-center">
        <p className="text-sm font-medium text-danger">读取时间线失败</p>
        <p className="mt-1 break-all text-xs text-ink-3">{loadErr}</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => setRetryTick((t) => t + 1)}
        >
          重试
        </Button>
      </div>
    )
  }
  if (!slices || !slices.length) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">项目时间线</h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1 px-2 text-xs"
            data-testid="sync-log-open"
            onClick={() => setSyncOpen(true)}
          >
            <History className="h-3.5 w-3.5" />
            同步记录
          </Button>
        </div>
        <EmptyState
          art="timeline"
          title="还没有时间切片"
          hint="每个带约定头的正文章节就是一个切片（front matter 里的「切片」字段）；写好正文保存后，它会出现在这里。章头可用「时间线: 线名」分线（缺省=主线）。"
          className="mt-4"
          dataTestId="empty-timeline"
        />
        <SyncLogDrawer projectId={id ?? ''} open={syncOpen} onClose={() => setSyncOpen(false)} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">项目时间线</h2>
          <p className="mt-0.5 text-sm text-ink-3">
            {multi
              ? '按线分组的故事时间切片一览；每线独立时间序，可切换查看。'
              : '按章号排序的「故事时间切片」一览；切片是各章节对应时刻的世界状态。'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          data-testid="sync-log-open"
          onClick={() => setSyncOpen(true)}
        >
          <History className="h-3.5 w-3.5" />
          同步记录
        </Button>
      </div>
      {multi && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="时间线筛选">
          <button
            role="tab"
            aria-selected={filter === '__all__'}
            data-line="__all__"
            onClick={() => setFilter('__all__')}
            className={cn(
              'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
              filter === '__all__'
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-hair text-ink-2 hover:bg-well'
            )}
          >
            全部
          </button>
          {lines.map((ln) => (
            <button
              key={ln.name}
              role="tab"
              aria-selected={filter === ln.name}
              data-line={ln.name}
              onClick={() => setFilter(ln.name)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
                filter === ln.name
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-hair text-ink-2 hover:bg-well'
              )}
            >
              {ln.name} · {ln.chapters}
            </button>
          ))}
        </div>
      )}
      {visibleGroups.map((g) => (
        <section key={g.line} className={cn(multi && 'mb-8 last:mb-0')} aria-label={`时间线：${g.line}`}>
          {multi && (
            <div className="mb-3 flex items-center gap-2">
              <span data-testid="timeline-line-head" className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">
                {g.line}
              </span>
              <span className="text-[11px] text-ink-3">{g.entries.length} 章</span>
              <span className="h-px flex-1 bg-hair" />
            </div>
          )}
          <ol className="relative space-y-5 border-l border-hair pl-6">
            {g.entries.map((s) => {
              const no = chapterNo(s.chapter)
              return (
                <li key={s.chapter} className="relative">
                  <span className="absolute -left-[30px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent-soft ring-1 ring-accent/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  </span>
                  <div className="rounded-lg border border-hair bg-surface p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-medium text-ink">
                          <span className="truncate" title={`${no ? `第${no}章` : s.chapter} · ${s.name}`}>{no ? `第${no}章` : s.chapter} · {s.name}</span>
                          {multi && (
                            <span className="shrink-0 rounded bg-well px-1.5 py-px text-[10px] font-normal text-ink-3">
                              {s.line}
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-2" title={s.chapter}>{s.chapter}</p>
                      </div>
                      <Link to="../novel" className="shrink-0 rounded-md border border-hair px-2 py-1 text-[11px] text-ink-2 transition-colors hover:bg-well">
                        打开正文
                      </Link>
                    </div>
                    {(s.time || s.chars?.length) && (
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
                        {s.time && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {s.time}
                          </span>
                        )}
                        {!!s.chars?.length && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {s.chars.join('、')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      <div className="mt-5 text-center">
        <Link to="../novel" className="text-xs text-accent hover:underline">回正文创作</Link>
      </div>
      <SyncLogDrawer projectId={id ?? ''} open={syncOpen} onClose={() => setSyncOpen(false)} />
    </div>
  )
}
