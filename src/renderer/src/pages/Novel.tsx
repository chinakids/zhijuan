import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, BookOpen } from 'lucide-react'
import type { ChapterEntry } from '../../../shared/types'
import { serializeFrontMatter } from '../../../shared/fmatter'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { cn } from '../lib/utils'
import DocEditor from '../features/editor/DocEditor'
import { runSliceSync } from '../features/sync/sliceSync'
import { useProposalStore } from '../store/proposals'
import type { ProseApi } from '../features/editor/Prose'
import AgentPanel from '../features/agent/AgentPanel'
import { useFsEvents } from '../features/fs/useFsEvents'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog'

export default function Novel() {
  const { id = '' } = useParams()
  const [chapters, setChapters] = useState<ChapterEntry[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [slice, setSlice] = useState('')
  const [cast, setCast] = useState('')
  const [pitch, setPitch] = useState('')
  const events = useFsEvents(id)
  const apiRef = useRef<ProseApi | null>(null)
  const [syncMsg, setSyncMsg] = useState('')

  const handleChapterSaved = useCallback(
    async (rel: string) => {
      if (!id) return
      setSyncMsg('切片同步中…')
      const r = await runSliceSync(id, rel)
      if (r.ok) {
        setSyncMsg(r.items > 0 ? `✓ 已生成 ${r.items} 条切片提案` : '✓ 无设定变化')
        useProposalStore.getState().bump()
      } else {
        setSyncMsg('✗ 切片同步失败: ' + r.error)
      }
      window.setTimeout(() => setSyncMsg(''), 6000)
    },
    [id]
  )

  const refresh = useCallback(async () => {
    if (!id) return
    const list = await window.zhijuan.listChapters(id)
    setChapters(list)
    setSel((s) => (s && list.some((c) => c.file === s) ? s : null))
  }, [id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 文件变化：刷新列表
  useEffect(() => {
    const ev = events[events.length - 1]
    if (ev && ev.path.startsWith('正文/')) void refresh()
  }, [events, refresh])

  const extVersion = useMemo(() => (sel ? events.filter((e) => e.path === sel).length : 0), [events, sel])

  async function createChapter() {
    if (!id || !title.trim()) return
    const num = chapters.reduce((max, c) => Math.max(max, c.fm?.['章号'] ?? 0), 0) + 1
    const fm = serializeFrontMatter({
      章号: num,
      题名: title.trim(),
      切片: slice.trim() || String(num),
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
    setSel(`正文/${name}`)
  }

  const cur = chapters.find((c) => c.file === sel)

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col border-r border-hair bg-surface-2">
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <span className="text-xs font-medium text-ink-3">章节（按时间切片）</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="新建章节" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {chapters.length === 0 && <p className="px-2 py-6 text-center text-xs text-ink-3">还没有章节，点右上角「+」开始第一章。</p>}
          {chapters.map((c) => (
            <button
              key={c.file}
              onClick={() => setSel(c.file)}
              className={cn(
                'mb-0.5 flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors',
                sel === c.file ? 'bg-accent-soft' : 'hover:bg-surface'
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

      <main className="flex min-w-0 flex-1 flex-col">
        {sel ? (
          <>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hair px-4">
              <span className="truncate text-sm font-medium text-ink">{cur?.name}</span>
              {syncMsg && (
                <span
                  className={cn(
                    'rounded-full px-2.5 py-0.5 text-[11px]',
                    syncMsg.startsWith('✓') ? 'bg-[#e6f0ee] text-success' : syncMsg.startsWith('✗') ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
                  )}
                >
                  {syncMsg}
                </span>
              )}
              <span className="flex-1" />
              <span className="text-[11px] text-ink-3">选中段落后可用 agent 的「引用选中」· ⌘S 保存</span>
            </div>
            <div className="min-h-0 flex-1">
              <DocEditor projectId={id} rel={sel} withFm extVersion={extVersion} editorApiRef={apiRef} onSave={() => { void refresh(); void handleChapterSaved(sel) }} />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-3">选择左侧一个章节开始（编辑器已就绪）</div>
        )}
      </main>

      <AgentPanel projectId={id} chapterRel={sel} chapterTitle={cur?.name ?? ''} editorApi={() => apiRef.current} />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建章节</DialogTitle>
            <DialogDescription>一章 = 一个时间切片。约定头会写进正文文件顶部，保存正文时按它做切片同步。</DialogDescription>
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
              <Label>本章梗概（可选）</Label>
              <Input placeholder="一句话梗概，会作为引用写进文首" value={pitch} onChange={(e) => setPitch(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>取消</Button>
            <Button onClick={() => void createChapter()} disabled={!title.trim()}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
