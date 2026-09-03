import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BookMarked, CheckCircle2, CircleDashed, Hammer, Loader2, ListTree, RefreshCw, ScrollText } from 'lucide-react'
import type { ChapterEntry } from '../../../shared/types'
import { cn } from '../lib/utils'
import DocEditor from '../features/editor/DocEditor'
import { useFsEvents } from '../features/fs/useFsEvents'

/** 大纲区：agent 把已有正文回建成章卡，画布随进度活起来。 */
export default function Outline() {
  const { id = '' } = useParams()
  const [chapters, setChapters] = useState<ChapterEntry[]>([])
  const [outlineFiles, setOutlineFiles] = useState<string[]>([])
  const [sel, setSel] = useState<string | null>('大纲/索引.md')
  const [building, setBuilding] = useState(false)
  const [msg, setMsg] = useState('')
  const events = useFsEvents(id)

  const refresh = useCallback(async () => {
    if (!id) return
    const [chs, docs] = await Promise.all([window.zhijuan.listChapters(id), window.zhijuan.listDocs(id, '大纲')])
    setChapters(chs)
    const files = docs.map((d) => '大纲/' + d.file)
    setOutlineFiles(files)
    setSel((s) => (s && files.includes(s) ? s : files.includes('大纲/索引.md') ? '大纲/索引.md' : null))
  }, [id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const ev = events[events.length - 1]
    if (ev && ev.path.startsWith('大纲/')) void refresh()
  }, [events, refresh])

  const cardRel = (c: ChapterEntry) => '大纲/' + c.name + '.md'
  const hasCard = (c: ChapterEntry) => outlineFiles.includes(cardRel(c))
  const missing = chapters.filter((c) => !hasCard(c))

  const build = async (only?: string[]) => {
    if (!id || building) return
    setBuilding(true)
    setMsg('')
    try {
      const r = await window.zhijuan.agentOutlineRebuild(id, only)
      if (r.ok) setMsg(`✓ 已回建 ${r.written.length} 张章卡（写作引擎逐章读正文，结果已落到 大纲/ 目录）`)
      else setMsg('✗ ' + r.error)
      await refresh()
    } catch (e: any) {
      setMsg('✗ ' + String(e?.message ?? e))
    } finally {
      setBuilding(false)
    }
  }

  const extVersion = useMemo(() => (sel ? events.filter((e) => e.path === sel).length : 0), [events, sel])

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-64 shrink-0 flex-col border-r border-hair bg-surface-2">
        <div className="flex items-center gap-2 border-b border-hair px-3 py-2.5">
          <BookMarked className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold text-ink">章卡</span>
          <span className="flex-1" />
          <span className="text-[10px] text-ink-3">{chapters.length} 章 · {outlineFiles.filter((f) => !f.endsWith('索引.md')).length} 已回建</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <button
            onClick={() => setSel('大纲/索引.md')}
            className={cn(
              'mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
              sel === '大纲/索引.md' ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-surface'
            )}
          >
            <ScrollText className="h-3.5 w-3.5" />
            章卡索引（全书）
          </button>
          {chapters.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-ink-3">还没有章节。去「正文创作」写第一章，再来回建章卡。</p>
          )}
          {chapters.map((c) => {
            const done = hasCard(c)
            return (
              <button
                key={c.file}
                onClick={() => setSel(cardRel(c))}
                className={cn(
                  'mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors',
                  sel === cardRel(c) ? 'bg-accent-soft' : 'hover:bg-surface'
                )}
              >
                {done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                ) : (
                  <CircleDashed className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                )}
                <span className={cn('truncate text-sm', sel === cardRel(c) ? 'font-medium text-accent' : 'text-ink')}>
                  {c.fm ? `第${c.fm['章号']}章 · ${c.fm['题名']}` : c.name}
                </span>
                {!done && <span className="ml-auto rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn">待回建</span>}
              </button>
            )
          })}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hair px-4">
          <ListTree className="h-3.5 w-3.5 text-ink-3" />
          <span className="truncate text-sm font-medium text-ink">
            {sel === '大纲/索引.md' ? '章卡索引' : sel?.replace('大纲/', '').replace(/\.md$/, '')}
          </span>
          <span className="flex-1" />
          {msg && <span className={cn('max-w-[40vw] truncate rounded-full px-2.5 py-0.5 text-[11px]', msg.startsWith('✓') ? 'bg-[#e6f0ee] text-success' : msg.startsWith('✗') ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent')}>{msg}</span>}
          {building && (
            <span className="flex items-center gap-1 text-[11px] text-accent">
              <Loader2 className="h-3 w-3 animate-spin" /> 写作引擎逐章回建中…（每章约一两分钟）
            </span>
          )}
          <button
            onClick={() => void build(missing.map((c) => c.file))}
            disabled={building || missing.length === 0}
            className="flex items-center gap-1 rounded-md border border-hair px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            title={missing.length ? `回建缺失的 ${missing.length} 张章卡` : '所有章节都已回建'}
          >
            <Hammer className="h-3 w-3" /> 回建缺失 {missing.length > 0 ? `(${missing.length})` : ''}
          </button>
          <button
            onClick={() => void build()}
            disabled={building}
            className="flex items-center gap-1 rounded-md border border-hair px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            title="全部章节重新回建（覆盖旧章卡）"
          >
            <RefreshCw className="h-3 w-3" /> 全部回建
          </button>
        </div>
        <div className="min-h-0 flex-1">
          {sel ? (
            <DocEditor projectId={id} rel={sel} extVersion={extVersion} onSave={() => void refresh()} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-3">
              还没有章卡。点右上角「回建缺失」把已有正文回建成章卡。
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
