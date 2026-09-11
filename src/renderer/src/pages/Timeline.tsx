import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Clock, Users } from 'lucide-react'
import type { SliceEntry } from '../../../shared/types'
import { Button } from '../components/ui/button'

function chapterNo(chapter: string): number | null {
  const m = chapter.match(/第\s*(\d+)/)
  return m ? Number(m[1]) : null
}

/** 时间线视图（模块 J / E4）：按章号列出全部时间切片，每个切片对应当前一章的设定状态 */
export default function Timeline() {
  const { id } = useParams<{ id: string }>()
  const [slices, setSlices] = useState<SliceEntry[] | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [retryTick, setRetryTick] = useState(0)

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
    return <div className="p-6 text-sm text-ink-3">正在读取项目时间线…</div>
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
        <h2 className="text-lg font-semibold">项目时间线</h2>
        <p className="mt-2 text-sm text-ink-3">
          还没有可展示的时间切片。每个带约定头的正文章节就是一个切片（front matter 里的「切片」字段）；写好正文保存后，它会出现在这里。
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold">项目时间线</h2>
        <p className="mt-0.5 text-sm text-ink-3">按章号排序的「故事时间切片」一览；切片是各章节对应时刻的世界状态。</p>
      </div>
      <ol className="relative space-y-5 border-l border-hair pl-6">
        {slices.map((s) => {
          const no = chapterNo(s.chapter)
          return (
            <li key={s.chapter} className="relative">
              <span className="absolute -left-[30px] top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent-soft ring-1 ring-accent/30">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              <div className="rounded-lg border border-hair bg-surface p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {no ? `第${no}章` : s.chapter} · {s.name}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-2">{s.chapter}</p>
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
      <div className="mt-5 text-center">
        <Link to="../novel" className="text-xs text-accent hover:underline">回正文创作</Link>
      </div>
    </div>
  )
}
