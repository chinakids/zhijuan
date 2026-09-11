import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams, useOutletContext } from 'react-router-dom'
import { Plus, BookOpen } from 'lucide-react'
import type { ChapterEntry, ChapterCheckKind, UnlistedHit, MissingHit } from '../../../shared/types'
import { serializeFrontMatter, addFrontMatterListItem, removeFrontMatterListItem } from '../../../shared/fmatter'
import { Button } from '../components/ui/button'
import { EmptyState } from '../components/EmptyState'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import { cn } from '../lib/utils'
import DocEditor from '../features/editor/DocEditor'
import { runSliceSync } from '../features/sync/sliceSync'
import { useProposalStore } from '../store/proposals'
import { useDocTitleStore } from '../store/docTitle'
import type { ProseApi } from '../features/editor/Prose'
import AgentPanel from '../features/agent/AgentPanel'
import ChapterCheckDrawer from '../features/check/ChapterCheckDrawer'
import { useFsEvents } from '../features/fs/useFsEvents'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog'
import { toast } from '../store/toasts'

export default function Novel() {
  const { id = '' } = useParams()
  const [chapters, setChapters] = useState<ChapterEntry[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
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
  // 本章小环 tab（短巡查/分层修订）：AgentPanel 命令行 /巡查 [修订] 可切换后打开
  const [checkTab, setCheckTab] = useState<ChapterCheckKind>('chapter')
  // 章节列表右键菜单（§6.2：重命名/导出单章 md/删除）
  const [menu, setMenu] = useState<{ c: ChapterEntry; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<ChapterEntry | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [deleting, setDeleting] = useState<ChapterEntry | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  // 菜单收起：点击菜单外任意处 / Esc；菜单项操作后各自关闭
  useEffect(() => {
    if (!menu) return
    const onDown = (ev: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) setMenu(null)
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])
  // 项目引导「现在新建第一章」：Workspace 经 Outlet context 发信号（递增计数），打开建章对话框
  const outletCtx = useOutletContext<{ newChapterReq?: number }>()
  const newChapterReq = outletCtx?.newChapterReq ?? 0
  // 保存时的「涉及人物清单与正文不一致」前置提示（本地规则·零模型）：出场未列入(unlisted) / 列入未出场(missing)
  // 命中且未忽略才显示；忽略记本会话内不再提示本章
  const [castCard, setCastCard] = useState<{ rel: string; unlisted: UnlistedHit[]; missing: MissingHit[] } | null>(null)
  const dismissedCast = useRef(new Set<string>())
  const [searchParams, setSearchParams] = useSearchParams()
  // 命令面板「打开章节」：?ch=<章节裸名>（相对 正文/）进入后自动选中
  const chParam = searchParams.get('ch')
  useEffect(() => {
    if (!chParam) return
    if (!chapters.some((c) => c.file === chParam)) return
    setSel(chParam)
    setSearchParams({}, { replace: true })
  }, [chParam, chapters, setSearchParams])

  // 「上一章」＝约定头章号最大的章（连续写作流：新章切片名/涉及人物默认沿用，可改）
  // 选法按 fm 章号而非列表尾部：导入/手改过的文件名与约定头章号可能不一致，fm 才是权威
  const prevChapter = useMemo(() => {
    let best: ChapterEntry | null = null
    for (const c of chapters) {
      const n = c.fm?.['章号']
      if (typeof n !== 'number') continue
      if (!best || n > (best.fm?.['章号'] as number)) best = c
    }
    return best
  }, [chapters])

  // 打开建章对话框：有上一章时预填切片名与涉及人物（都在同一输入框里可改）
  const openCreate = useCallback(() => {
    const pf = prevChapter?.fm
    setSlice(typeof pf?.['切片'] === 'string' ? pf['切片'] : '')
    setCast(Array.isArray(pf?.['涉及人物']) ? pf['涉及人物'].join(', ') : '')
    setCreating(true)
  }, [prevChapter])

  // 项目引导「现在新建第一章」：经 Outlet context 发信号（递增计数），打开建章对话框（无上一章则空开）
  useEffect(() => {
    if (newChapterReq > 0) openCreate()
  }, [newChapterReq, openCreate])

  const handleChapterSaved = useCallback(
    async (rel: string) => {
      if (!id) return
      setSyncMsg('切片同步中…')
      // 前置快检（零模型；与同步并行）：正文出现档案人物本名/登记别名但约定头未列（unlisted）、
      // 约定头列了但正文（达到最小字数阈值后）未出现本名/别名（missing）→ 汇总为一张提示卡
      void Promise.all([
        window.zhijuan.checkChapterUnlisted(id, rel),
        window.zhijuan.checkChapterMissing(id, rel)
      ]).then(([u, m]) => {
        const unlisted = u.ok ? u.items : []
        const missing = m.ok ? m.items : []
        if ((unlisted.length || missing.length) && !dismissedCast.current.has(rel)) {
          setCastCard({ rel, unlisted, missing })
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
    try {
      const list = await window.zhijuan.listChapters(id)
      setChapters(list)
      setLoadErr('')
      setSel((s) => (s && list.some((c) => c.file === s) ? s : null))
    } catch (e) {
      setLoadErr(String((e as Error).message ?? e))
    } finally {
      setLoading(false)
    }
  }, [id])

  // 切换章节：收起「清单不一致」提示卡（忽略记录保留，本会话内不重复打扰该章）
  useEffect(() => {
    setCastCard(null)
  }, [sel])

  // 「补入涉及人物」：把命中人物写进本章约定头（只改那一行，其他约定头原样；正文不动）
  async function addUnlisted() {
    if (!id || !castCard) return
    const rel = castCard.rel
    let raw = (await window.zhijuan.readDoc(id, rel)) ?? ''
    for (const h of castCard.unlisted) raw = addFrontMatterListItem(raw, '涉及人物', h.name)
    await window.zhijuan.writeDoc(id, rel, raw)
    setCastCard(null)
    await refresh()
  }

  // 「移出涉及人物」：把未出场命中人物从本章约定头移除（移空则删该行；正文不动）
  async function removeMissing() {
    if (!id || !castCard) return
    const rel = castCard.rel
    let raw = (await window.zhijuan.readDoc(id, rel)) ?? ''
    for (const h of castCard.missing) raw = removeFrontMatterListItem(raw, '涉及人物', h.name)
    await window.zhijuan.writeDoc(id, rel, raw)
    setCastCard(null)
    await refresh()
  }

  function dismissCast() {
    if (!castCard) return
    dismissedCast.current.add(castCard.rel)
    setCastCard(null)
  }

  useEffect(() => {
    void refresh()
  }, [refresh])

  // 文件变化：刷新列表
  useEffect(() => {
    const ev = events[events.length - 1]
    if (ev && ev.path.startsWith('正文/')) void refresh()
  }, [events, refresh])

  // 注意：events.path 是项目根相对路径（如 正文/第01章_雾港.md），sel 是 listChapters 返回的相对 正文/ 裸名，
  // 匹配必须用带前缀的 chapterRel 拼出来（真机 watcher 同此口径；曾直接用 sel 匹配导致 extVersion 恒 0、外部改动不静默重载）
  const extVersion = useMemo(() => (sel ? events.filter((e) => e.path === '正文/' + sel).length : 0), [events, sel])

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
    try {
      await window.zhijuan.writeDoc(id, `正文/${name}`, fm + body)
    } catch (e) {
      toast.add({ kind: 'error', title: '创建章节失败', description: String((e as Error).message ?? e) })
      return
    }
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

  // ---- 章节右键菜单操作（§6.2）----
  async function doRename() {
    if (!id || !renaming) return
    const r = await window.zhijuan.renameChapter(id, '正文/' + renaming.file, renameVal)
    if (!r.ok) {
      toast.add({ kind: 'error', title: '重命名失败', description: r.error })
      return
    }
    await refresh()
    // 重命名的是当前选中章 → 选中跟随新文件名；否则保持原选中
    if (sel === renaming.file && r.newRel) setSel(r.newRel.split('/').pop()!)
    setRenaming(null)
    toast.add({ kind: 'success', title: '已重命名', description: r.newRel })
  }
  async function doDelete() {
    if (!id || !deleting) return
    const r = await window.zhijuan.deleteChapter(id, '正文/' + deleting.file)
    if (!r.ok) {
      toast.add({ kind: 'error', title: '删除失败', description: r.error })
      return
    }
    toast.add({
      kind: 'success',
      title: '已移入废纸篓（可恢复）',
      description: `${deleting.name}${r.cleaned ? `（含 ${r.cleaned} 篇大纲副产物）` : ''}`
    })
    setDeleting(null)
    await refresh()
    if (sel === deleting.file) setSel(null)
  }
  async function doExport(c: ChapterEntry) {
    if (!id) return
    const r = await window.zhijuan.exportChapter(id, '正文/' + c.file)
    if (r.cancelled) return
    if (!r.ok) toast.add({ kind: 'error', title: '导出失败', description: r.error })
    else toast.add({ kind: 'success', title: '已导出单章', description: r.path })
  }

  const cur = chapters.find((c) => c.file === sel)
  // 章卡的 file 是相对 正文/ 的裸名；凡要当项目根相对路径传给主进程处，统一在此拼前缀（见本技能 listDocs 坑）
  const chapterRel = sel ? '正文/' + sel : ''

  // 标题栏文档题名（V3）：正文页把「第N章 · 题名」上报到全局 store；组件卸载/无选中时清空
  const setDocTitle = useDocTitleStore((s) => s.setTitle)
  useEffect(() => {
    setDocTitle(cur ? `第${cur.fm?.['章号'] ?? '?'}章 · ${cur.fm?.['题名'] ?? ''}` : '')
    return () => setDocTitle('')
  }, [cur, setDocTitle])

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-60 shrink-0 flex-col border-r border-hair bg-surface-2">
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">章节</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" title="新建章节" onClick={openCreate}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {loading && <p className="px-2 py-6 text-center text-xs text-ink-3">正在读取章节…</p>}
          {!loading && loadErr && (
            <div className="px-2 py-5 text-center">
              <p className="text-xs text-danger">读取章节失败</p>
              <p className="mt-0.5 break-all text-[11px] text-ink-3">{loadErr}</p>
              <button
                className="mt-1.5 text-xs text-accent underline-offset-2 hover:underline"
                onClick={() => {
                  setLoading(true)
                  setLoadErr('')
                  void refresh()
                }}
              >
                重试
              </button>
            </div>
          )}
          {!loading && !loadErr && chapters.length === 0 && (
            <EmptyState
              compact
              hint="还没有章节，点右上角「+」开始第一章。"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 whitespace-nowrap text-[11px]"
                  onClick={openCreate}
                >
                  <Plus className="h-3 w-3" /> 新建第一章
                </Button>
              }
              dataTestId="empty-chapters"
            />
          )}
          {chapters.map((c) => (
            <button
              key={c.file}
              onClick={() => setSel(c.file)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ c, x: e.clientX, y: e.clientY })
              }}
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

      {/* 章节右键菜单（§6.2）：重命名 / 导出单章 md / 删除（进废纸篓可恢复） */}
      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 w-44 overflow-hidden rounded-lg border border-hair bg-surface py-1 shadow-[var(--shadow)]"
          style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 190)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 150)) }}
        >
          <button
            className="block w-full shrink-0 whitespace-nowrap px-3 py-1.5 text-left text-xs text-ink hover:bg-surface-2"
            onClick={() => {
              setRenaming(menu.c)
              setRenameVal(String(menu.c.fm?.['题名'] ?? ''))
              setMenu(null)
            }}
          >
            重命名
          </button>
          <button
            className="block w-full shrink-0 whitespace-nowrap px-3 py-1.5 text-left text-xs text-ink hover:bg-surface-2"
            onClick={() => {
              void doExport(menu.c)
              setMenu(null)
            }}
          >
            导出 md
          </button>
          <button
            className="block w-full shrink-0 whitespace-nowrap px-3 py-1.5 text-left text-xs text-danger hover:bg-danger/10"
            onClick={() => {
              setDeleting(menu.c)
              setMenu(null)
            }}
          >
            删除
          </button>
        </div>
      )}

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
        {/* 保存前置提示：本章「涉及人物」清单与正文不一致（本地规则·零模型）——出场未列入 / 列入未出场 */}
        {castCard && castCard.rel === chapterRel && (
          <div className="absolute right-24 top-24 z-10 w-80 rounded-lg border border-warn/50 bg-surface p-3 shadow-[var(--shadow)]">
            <p className="text-[11px] font-medium text-ink-2">本章「涉及人物」清单与正文不一致</p>
            {castCard.unlisted.length > 0 && (
              <>
                <p className="mt-1.5 text-[10px] font-medium text-ink-3">出场了却未列入</p>
                <ul className="mt-1 space-y-1 text-[11px] text-ink">
                  {castCard.unlisted.map((h) => (
                    <li key={h.name} className="break-all">
                      {h.alias ? `「${h.alias}」＝${h.name} 的登记别名，出现在正文` : `「${h.name}」的署名出现在正文`}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] text-ink-3">真的出场请补入；只是回忆 / 提及一笔可忽略。</p>
              </>
            )}
            {castCard.missing.length > 0 && (
              <>
                <p className="mt-2 text-[10px] font-medium text-ink-3">列入了却未出场</p>
                <ul className="mt-1 space-y-1 text-[11px] text-ink">
                  {castCard.missing.map((h) => (
                    <li key={h.name} className="break-all">
                      「{h.name}」在约定头里，本章正文未出现 TA 的署名或登记的别名
                      {h.aliases?.length ? `（${h.aliases.join('、')}）` : ''}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[10px] text-ink-3">可能已删戏，或用了未登记的别称；不需要出场就移出清单。</p>
              </>
            )}
            <div className="mt-2 flex items-center gap-2">
              {castCard.unlisted.length > 0 && (
                <Button size="sm" className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px]" onClick={() => void addUnlisted()}>补入涉及人物</Button>
              )}
              {castCard.missing.length > 0 && (
                <Button size="sm" className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px]" onClick={() => void removeMissing()}>移出涉及人物</Button>
              )}
              <Button size="sm" variant="outline" className="h-7 shrink-0 whitespace-nowrap px-2 text-[11px]" onClick={dismissCast}>忽略</Button>
            </div>
          </div>
        )}
      </main>

      <AgentPanel
        projectId={id}
        chapterRel={chapterRel || null}
        chapterTitle={cur?.name ?? ''}
        editorApi={() => apiRef.current}
        onChapterCheck={(tab) => {
          if (tab) setCheckTab(tab)
          setCheckOpen(true)
        }}
      />

      <ChapterCheckDrawer
        projectId={id}
        chapter={chapterRel || null}
        chapterTitle={cur?.name ?? ''}
        open={checkOpen}
        initialTab={checkTab}
        onClose={() => setCheckOpen(false)}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建章节</DialogTitle>
            <DialogDescription>一章 = 一个时间切片。约定头会写进正文文件顶部，保存正文时按它做切片同步。</DialogDescription>
            {prevChapter && (
              <p className="text-[11px] text-ink-3">
                已沿用上一章《{prevChapter.fm?.['题名'] ?? prevChapter.name}》的切片名与涉及人物，可直接修改。
              </p>
            )}
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

      {/* 章节重命名（§6.2）：改约定头题名 + 文件名；大纲副产物与版本历史随同改名 */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>重命名章节</DialogTitle>
            <DialogDescription>只改这一章的题名与文件名；大纲章卡/导演板等副产物和版本历史会随同改名。</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>新题名 *</Label>
            <Input
              autoFocus
              value={renameVal}
              placeholder="新题名"
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameVal.trim()) void doRename()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>取消</Button>
            <Button onClick={() => void doRename()} disabled={!renameVal.trim()}>重命名</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 章节删除确认：正文 + 同名大纲副产物移入系统废纸篓（可找回） */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除章节</DialogTitle>
            <DialogDescription>
              第{deleting?.fm?.['章号'] ?? '?'}章《{deleting?.fm?.['题名'] ?? deleting?.name ?? ''}》将连同所属大纲副产物一起移入系统废纸篓（可恢复）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>取消</Button>
            <Button className="text-danger" onClick={() => void doDelete()}>移入废纸篓</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
