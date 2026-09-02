import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, BookOpen } from 'lucide-react'
import type { ChapterEntry } from '../../../shared/types'
import { serializeFrontMatter } from '../../../shared/fmatter'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose
} from '../components/ui/dialog'
import { cn } from '../lib/utils'

export default function Novel() {
  const { id } = useParams<{ id: string }>()
  const [chapters, setChapters] = useState<ChapterEntry[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [content, setContent] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [slice, setSlice] = useState('')
  const [cast, setCast] = useState('')
  const [pitch, setPitch] = useState('')

  const refresh = useCallback(async () => {
    if (!id) return
    setChapters(await window.zhijuan.listChapters(id))
  }, [id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!id || !sel) return
    void window.zhijuan.readDoc(id, sel).then((t) => setContent(t ?? ''))
  }, [id, sel])

  async function createChapter() {
    if (!id || !title.trim()) return
    const num = chapters.reduce((max, c) => Math.max(max, c.fm?.['章号'] ?? 0), 0) + 1
    const fm = serializeFrontMatter({
      章号: num,
      题名: title.trim(),
      切片: slice.trim() || `${num}`,
      涉及人物: cast.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    })
    const name = `第${String(num).padStart(2, '0')}章_${title.trim()}.md`
    const body = pitch.trim() ? `# ${title.trim()}\n\n> 本章梗概：${pitch.trim()}\n` : `# ${title.trim()}\n`
    await window.zhijuan.writeDoc(id, `正文/${name}`, fm + body)
    setCreating(false)
    setTitle('')
    setSlice('')
    setCast('')
    setPitch('')
    await refresh()
  }

  return (
    <div className="flex h-full">
      {/* 章节列表 */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-hair bg-surface-2">
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <span className="text-xs font-medium text-ink-3">章节（按时间切片）</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="新建章节" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto px-2">
          {chapters.length === 0 && (
            <p className="px-2 py-4 text-xs text-ink-3">还没有章节。点右上角 ＋ 新建第一章。</p>
          )}
          {chapters.map((c) => (
            <button
              key={c.file}
              onClick={() => setSel(c.file)}
              className={cn(
                'mb-0.5 w-full rounded-lg px-2.5 py-2 text-left transition-colors',
                sel === c.file ? 'bg-accent-soft' : 'hover:bg-well'
              )}
            >
              <p className={cn('truncate text-sm', sel === c.file ? 'font-medium text-accent' : 'text-ink')}>
                {c.fm ? `第${c.fm['章号']}章 · ${c.fm['题名']}` : c.name}
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-3">
                <BookOpen className="h-3 w-3" />
                {c.fm?.['切片'] ?? '未设切片'} · {c.wordCount} 字
              </p>
            </button>
          ))}
        </div>
      </aside>

      {/* 正文预览（S2 换成 Milkdown 编辑器） */}
      <main className="min-w-0 flex-1 overflow-auto bg-paper">
        {!sel ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-3">
            <BookOpen className="h-8 w-8" />
            <p className="text-sm">选择左侧一个章节开始</p>
            <p className="text-xs">（编辑器将在 S2 接入）</p>
          </div>
        ) : (
          <div className="paper-canvas whitespace-pre-wrap">{content}</div>
        )}
      </main>

      {/* 新建章节向导 */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新建章节</DialogTitle>
            <DialogDescription>一章 = 一个时间切片（按你定的规矩）。约定头会写进正文文件顶部。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>题名 *</Label>
              <Input autoFocus placeholder="如：夏夜的信" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>时间切片名</Label>
              <Input placeholder="如：第二幕_台风夜（留空则用章号）" value={slice} onChange={(e) => setSlice(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>涉及人物（逗号分隔）</Label>
              <Input placeholder="如：林晚, 顾知远" value={cast} onChange={(e) => setCast(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>一句话梗概（可选）</Label>
              <Input placeholder="本章大概发生什么…" value={pitch} onChange={(e) => setPitch(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">取消</Button>
            </DialogClose>
            <Button onClick={createChapter} disabled={!title.trim()}>
              创建章节
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
