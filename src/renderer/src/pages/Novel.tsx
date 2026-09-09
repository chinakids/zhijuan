import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Plus, BookOpen } from 'lucide-react'
import type { ChapterEntry, UnlistedHit } from '../../../shared/types'
import { serializeFrontMatter, addFrontMatterListItem } from '../../../shared/fmatter'
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
  // 保存时的「名单外出场」前置提示（本地规则·零模型）：命中且未忽略才显示；忽略记本会话内不再提示本章
  const [unlistedCard, setUnlistedCard] = useState<{ rel: string; items: UnlistedHit[] } | null>(null)
  const dismissedUnlisted = useRef(new Set<string>())
  const [searchParams, setSearchParams] = useSearchParams()
  // 命令面板「打开章节」：?ch=<章节裸名>（相对 正文/）进入后自动选中
  const chParam = searchParams.get('ch')
  useEffect(() => {
    if (!chParam) return
    if (!chapters.some((c) => c.file === chParam)) return
    setSel(chParam)
    setSearchParams({}, { replace: true })
  }, [chParam, chapters, setSearchParams])

  const handleChapterSaved = useCallback(
    async (rel: string) => {
      if (!id) return
      setSyncMsg('切片同步中…')
      // 前置快检：正文出现档案人物本名/登记别名但约定头「涉及人物」未列 → 提示补列（零模型；与同步并行）
      void window.zhijuan.checkChapterUnlisted(id, rel).then((u) => {
        if (u.ok && u.items.length && !dismissedUnlisted.current.has(rel)) {
          setUnlistedCard({ rel, items: u.items })
        }
      })
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

  // 切换章节：收起「名单外出场」提示卡（忽略记录保留，本会话内不重复打扰该章）
  useEffect(() => {
    setUnlistedCard(null)
  }, [sel])

  // 「补入涉及人物」：把命中人物写进本章约定头（只改那一行，其他约定头原样；正文不动）
  async function addUnlisted() {
    if (!id || !unlistedCard) return
    const rel = unlistedCard.rel
    let raw = (await window.zhijuan.readDoc(id, rel)) ?? ''
    for (const h of unlistedCard.items) raw = addFrontMatterListItem(raw, '涉及人物', h.name)
    await window.zhijuan.writeDoc(id, rel, raw)
    setUnlistedCard(null)
    await refresh()
  }

  function dismissUnlisted() {
    if (!unlistedCard) return
    dismissedUnlisted.current.add(unlistedCard.rel)
    setUnlistedCard(null)
  }

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
    setSel(name)
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
        {/* 保存前置提示：本章正文出现未列入「涉及人物」的档案人物（本地规则·零模型） */}
        {unlistedCard && unlistedCard.rel === chapterRel && (
          <div className="absolute right-24 top-24 z-10 w-72 rounded-lg border border-warn/50 bg-surface p-3 shadow-lg">
            <p className="text-[11px] font-medium text-ink-2">本章出现了未列入「涉及人物」的角色</p>
            <ul className="mt-1.5 space-y-1 text-[11px] text-ink">
              {unlistedCard.items.map((h) => (
                <li key={h.name} className="break-all">
                  {h.alias ? `「${h.alias}」＝${h.name} 的登记别名，出现在正文` : `「${h.name}」的署名出现在正文`}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] text-ink-3">真的出场请补入；只是回忆 / 提及一笔可忽略。</p>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px]" onClick={() => void addUnlisted()}>补入涉及人物</Button>
              <Button size="sm" variant="outline" className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px]" onClick={dismissUnlisted}>忽略</Button>
            </div>
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
