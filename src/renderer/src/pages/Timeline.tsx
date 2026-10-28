import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Clock, Users, History, Search } from 'lucide-react'
import LoadingIndicator from '../components/LoadingIndicator'
import type { SliceEntry } from '../../../shared/types'
import { listLinesFromEntries } from '../../../shared/line'
import LineFilterChips, { ALL_LINES } from '../features/common/LineFilterChips'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { cn } from '../lib/utils'
import { EmptyState } from '../components/EmptyState'
import { PageHeader } from '../components/PageHeader'
import SyncLogDrawer from '../features/sync/SyncLogDrawer'
import { useFsChanged } from '../features/fs/useFsEvents'

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
  /** 线筛选：ALL_LINES 或线名；仅多线项目显示切换器 */
  const [filter, setFilter] = useState<string>(ALL_LINES)
  /** 切片搜索：章名/题名/时间/人物/线名，输入即筛（纯本地过滤，不走主进程） */
  const [q, setQ] = useState('')
  /** fs 事件触发的静默重读：不把 slices 置空，避免列表闪回 loading */
  const silentRef = useRef(false)

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
  const visibleGroups = useMemo(() => (filter === ALL_LINES ? groups : groups.filter((g) => g.line === filter)), [groups, filter])

  const qNorm = q.trim().toLowerCase()
  // 搜索过滤（空格分词 AND，与 ⌘K/素材库同口径）：命中章文件名、题名、切片时间、涉及人物、线名
  const shownGroups = useMemo(() => {
    if (!qNorm) return visibleGroups
    const terms = qNorm.split(/\s+/).filter(Boolean)
    return visibleGroups
      .map((g) => ({
        line: g.line,
        entries: g.entries.filter((s) => {
          const hay = [s.name, s.chapter, s.time ?? '', (s.chars ?? []).join(' '), s.line ?? ''].join(' ').toLowerCase()
          return terms.every((t) => hay.includes(t))
        })
      }))
      .filter((g) => g.entries.length > 0)
  }, [visibleGroups, qNorm])

  const shownCount = useMemo(() => shownGroups.reduce((n, g) => n + g.entries.length, 0), [shownGroups])

  useEffect(() => {
    if (!id) return
    let alive = true
    setLoadErr('')
    // 切项目/重试时先回 loading，防旧项目切片闪现（2026-09-21 体验层）；fs 静默刷新保留列表
    if (!silentRef.current) setSlices(null)
    silentRef.current = false
    void window.zhijuan
      .listSlices(id)
      .then((s) => alive && setSlices(s))
      .catch((e) => alive && setLoadErr(String((e as Error).message ?? e)))
    return () => {
      alive = false
    }
  }, [id, retryTick])

  // 正文是切片的唯一来源：正文目录变化（保存/删章/改章头）即静默重读，无需手动刷新
  const reloadSilent = useCallback(() => {
    silentRef.current = true
    setRetryTick((t) => t + 1)
  }, [])
  useFsChanged(id ?? '', '正文/', reloadSilent)

  // 页头（loading/错误/空态共用，2026-09-21 体验层：加载与失败时标题+「同步记录」常驻不闪失）
  const syncBtn = (
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
  )
  const simpleHead = <PageHeader title="项目时间线" actions={syncBtn} />

  if (slices === null && !loadErr) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        {simpleHead}
        <div className="flex items-center justify-center gap-2 p-6 text-sm text-ink-3">
          <LoadingIndicator size={16} />
          <span>正在读取项目时间线…</span>
        </div>
      </div>
    )
  }
  if (loadErr) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        {simpleHead}
        <div className="mx-auto mt-10 max-w-sm rounded-xl border border-dashed border-danger/40 p-8 text-center">
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
      </div>
    )
  }
  if (!slices || !slices.length) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        {simpleHead}
        <EmptyState
          art="timeline"
          title="还没有时间切片"
          hint="每个带约定头的正文章节就是一个切片（front matter 里的「切片」字段）；写好正文保存后，它会出现在这里。章头可用「时间线: 线名」分线（缺省=主线）。"
          className="mt-4"
          dataTestId="empty-timeline"
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="../novel">去正文创作写第一章</Link>
            </Button>
          }
        />
        <SyncLogDrawer projectId={id ?? ''} open={syncOpen} onClose={() => setSyncOpen(false)} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <PageHeader
        title="项目时间线"
        subtitle={
          multi
            ? '按线分组的故事时间切片一览；每线独立时间序，可切换查看。'
            : '按章号排序的「故事时间切片」一览；切片是各章节对应时刻的世界状态。'
        }
        actions={syncBtn}
      />
      {/* 搜索：章名/题名/时间/人物/线名（切片数量有限，本地过滤即够；空查询还原全部） */}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索切片：章节名、时间、人物…"
          aria-label="搜索时间切片"
          data-testid="timeline-search"
          className="h-8 pl-8 pr-8 text-xs"
        />
        {q.trim() !== '' && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="清除搜索"
            className="absolute right-2 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-well hover:text-ink"
          >
            ×
          </button>
        )}
      </div>
      {multi && (
        <LineFilterChips
          lines={lines}
          value={filter}
          onChange={setFilter}
          ariaLabel="时间线筛选"
          className="mb-5"
        />
      )}
      {qNorm !== '' && (
        <p className="mb-3 text-xs text-ink-3" data-testid="timeline-hit-count">
          {shownCount > 0 ? `匹配 ${shownCount} 个切片` : '没有匹配的切片'}
        </p>
      )}
      {qNorm !== '' && shownCount === 0 && (
        <EmptyState
          compact
          hint="换个关键词试试：章节题名、年份地点、人物名或线名。"
          className="mb-4 rounded-lg border border-dashed border-hair"
          action={
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setQ('')}>
              清除搜索
            </Button>
          }
        />
      )}
      {shownGroups.map((g) => (
        <section key={g.line} className={cn(multi && 'mb-8 last:mb-0')} aria-label={`时间线：${g.line}`}>
          {multi && (
            <div className="mb-3 flex items-center gap-2">
              <span data-testid="timeline-line-head" className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">
                {g.line}
              </span>
              <span className="text-xs text-ink-3">{g.entries.length} 章</span>
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
                      <Link
                        to={`../novel?ch=${encodeURIComponent(s.chapter + '.md')}`}
                        className="shrink-0 rounded-md border border-hair px-2 py-1 text-xs text-ink-2 transition-colors hover:bg-well"
                      >
                        打开正文
                      </Link>
                    </div>
                    {(s.time || s.chars?.length) && (
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
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