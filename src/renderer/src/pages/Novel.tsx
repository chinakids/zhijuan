import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, BookOpen } from 'lucide-react'
import type { ChapterEntry } from '../../../shared/types'
import { serializeFrontMatter } from '../../../shared/fmatter'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import { cn } from '../lib/utils'
import DocEditor from '../features/editor/DocEditor'
import { runSliceSync } from '../features/sync/sliceSync'
import { useProposalStore } from '../store/proposals'
import type { ProseApi } from '../features/editor/Prose'
import AgentPanel from '../features/agent/AgentPanel'
import ChapterCheckDrawer from '../features/check/ChapterCheckDrawer'
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
  const [goal, setGoal] = useState('') // 本章目标
  const [conflict, setConflict] = useState('')
  const [plot, setPlot] = useState('') // 关键事件
  const [hook, setHook] = useState('')
  const events = useFsEvents(id)
  const apiRef = useRef<ProseApi | null>(null)
  const [syncMsg, setSyncMsg] = useState('')
  const [checkOpen, setCheckOpen] = useState(false)

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
    // 故事要素：有任何一项就写入文首指引块（随正文进入切片同步与 agent 上下文）
    const eles = [
      { k: '目标', v: goal },
      { k: '核心冲突', v: conflict },
      { k: '关键事件', v: plot },
      { k: '前情呼应', v: hook }
    ].filter((x) => x.v.trim())
    const titleLine = `# ${title.trim()}\n`
    const body = eles.length
      ? '> == 本章故事要素 ==\n' +
        eles.map((x) => `> - ${x.k}：${x.v.trim()}`).join('\n') +
        '\n>\n> （本章写作指引：可随进度修改；保存后随正文进入切片同步与 agent 上下文）\n\n' +
        titleLine
      : titleLine
    await window.zhijuan.writeDoc(id, `正文/${name}`, fm + body)
    setCreating(false)
    setTitle('')
    setSlice('')
    setCast('')
    setGoal('')
    setConflict('')
    setPlot('')
    setHook('')
    await refresh()
    setSel(`正文/${name}`)
  }

  const cur = chapters.find((c) => c.file === sel)
  // 章卡的 file 是相对 正文/ 的裸名；凡要当项目根相对路径传给主进程处，统一在此拼前缀（见本技能 listDocs 坑）
  const chapterRel = sel ? '正文/' + sel : ''

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

      <main className="relative flex min-w-0 flex-1 flex-col">
        {sel ? (
          <>
            <div className="min-h-0 flex-1">
              <DocEditor projectId={id} rel={chapterRel} withFm extVersion={extVersion} editorApiRef={apiRef} onSave={() => { void refresh(); void handleChapterSaved(chapterRel) }} />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-3">选择左侧一个章节开始（编辑器已就绪）</div>
        )}
        {/* 切片同步结果：浮动提示，不占版面 */}
        {syncMsg && (
          <div className="pointer-events-none absolute right-24 top-11 z-10 rounded-full border border-hair bg-surface px-3 py-1 text-[11px] shadow-md">
            <span className={syncMsg.startsWith('✓') ? 'text-success' : syncMsg.startsWith('✗') ? 'text-danger' : 'text-accent'}>
              {syncMsg}
            </span>
          </div>
        )}
      </main>

      <AgentPanel projectId={id} chapterRel={chapterRel || null} chapterTitle={cur?.name ?? ''} editorApi={() => apiRef.current} onChapterCheck={() => setCheckOpen(true)} />

      <ChapterCheckDrawer projectId={id} chapter={chapterRel || null} chapterTitle={cur?.name ?? ''} open={checkOpen} onClose={() => setCheckOpen(false)} />

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
              <Label>本章目标</Label>
              <Textarea rows={1} placeholder="主角在这一章要达成什么（可空，写了会更稳）" value={goal} onChange={(e) => setGoal(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>核心冲突</Label>
              <Textarea rows={1} placeholder="本段主要矛盾，如：灯塔要正常值守，可守塔人想出海…" value={conflict} onChange={(e) => setConflict(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>关键事件（可多条）</Label>
              <Textarea rows={1} placeholder="每件一行：如&#10;· 有人来渡口打听旧船&#10;· 主角在行李里翻出一封信" value={plot} onChange={(e) => setPlot(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>前情呼应（可空）</Label>
              <Textarea rows={1} placeholder="要回应的伏笔 / 要用的设定：如：呼应幕一里的灯语约定" value={hook} onChange={(e) => setHook(e.target.value)} />
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
