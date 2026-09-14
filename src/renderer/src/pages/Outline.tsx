import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BookMarked, CheckCheck, CheckCircle2, CircleDashed, Clapperboard, FileText, Hammer, History, ListTree, PenLine, RefreshCw, ScrollText, ShieldCheck, Wrench } from 'lucide-react'
import LoadingIndicator from '../components/LoadingIndicator'
import type { ChapterEntry } from '../../../shared/types'
import { cn } from '../lib/utils'
import { EmptyState } from '../components/EmptyState'
import DocEditor from '../features/editor/DocEditor'
import HistoryDrawer from '../features/editor/HistoryDrawer'
import DirectorCheckDrawer from '../features/check/DirectorCheckDrawer'
import { useFsChanged, useFsEvents } from '../features/fs/useFsEvents'
import { isBoardStale } from '../../../shared/boardAge'
import { parseActsWarn } from '../../../shared/actsSeg'
import { runSliceSync, type SliceSyncResult } from '../features/sync/sliceSync'
import { toast } from '../components/ui/toast'

/** 大纲区：agent 把已有正文回建成章卡，画布随进度活起来。 */
export default function Outline() {
  const { id = '' } = useParams()
  const [chapters, setChapters] = useState<ChapterEntry[]>([])
  const [outlineFiles, setOutlineFiles] = useState<string[]>([])
  const [outlineMtimes, setOutlineMtimes] = useState<Record<string, number>>({})
  const [sel, setSel] = useState<string | null>('大纲/索引.md')
  const [building, setBuilding] = useState(false)
  const [directing, setDirecting] = useState(false)
  const [acting, setActing] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [adopting, setAdopting] = useState(false)
  const [confirmAdopt, setConfirmAdopt] = useState(false)
  const [checkOpen, setCheckOpen] = useState(false)
  // 审读存档条目旁的「历史」抽屉（复用正文 HistoryDrawer，rel=审读报告路径）
  const [historyRel, setHistoryRel] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  // 当前选中章节的分幕草稿里「未写成」的段号（>0 时显示「补写缺段」按钮）
  const [draftMissing, setDraftMissing] = useState<number[]>([])
  const events = useFsEvents(id)

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const [chs, docs] = await Promise.all([window.zhijuan.listChapters(id), window.zhijuan.listDocs(id, '大纲')])
      setChapters(chs)
      const files = docs.map((d) => '大纲/' + d.file)
      setOutlineFiles(files)
      setOutlineMtimes(Object.fromEntries(docs.map((d) => ['大纲/' + d.file, d.mtime])))
      setSel((s) => (s && files.includes(s) ? s : files.includes('大纲/索引.md') ? '大纲/索引.md' : null))
      setLoadErr('')
    } catch (e) {
      setLoadErr(String((e as Error).message ?? e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useFsChanged(id, '大纲/', () => void refresh())

  // 切换所选文档时，把「再点一次确认」的两击状态复位
  useEffect(() => {
    setConfirmAdopt(false)
  }, [sel])

  const cardRel = (c: ChapterEntry) => '大纲/' + c.name + '.md'
  const boardRel = (c: ChapterEntry) => '大纲/' + c.name + '_导演.md'
  const actsRel = (c: ChapterEntry) => '大纲/' + c.name + '_分幕.md'
  const hasCard = (c: ChapterEntry) => outlineFiles.includes(cardRel(c))
  const hasBoard = (c: ChapterEntry) => outlineFiles.includes(boardRel(c))
  const hasActs = (c: ChapterEntry) => outlineFiles.includes(actsRel(c))
  // 导演板比正文更旧（正文在导完之后又被改过）的章：兑现检查会对照旧承诺，需轻提示建议重导
  const staleBoards = new Set<string>()
  for (const c of chapters) {
    const bm = outlineMtimes[boardRel(c)]
    if (bm != null && isBoardStale(bm, c.mtime)) staleBoards.add(c.name)
  }
  const missing = chapters.filter((c) => !hasCard(c))
  // 大纲区里的审读存档（全卷检查自动落盘，可点击回看）
  const auditReports = useMemo(
    () => outlineFiles.filter((f) => f.startsWith('大纲/审读_') && f.endsWith('.md')),
    [outlineFiles]
  )
  // 当前选中对应的章节（章卡或导演板都可映射回），供「导演本章」定位
  const selName = sel?.replace(/^大纲\//, '').replace(/\.md$/, '').replace(/_(导演|分幕)$/, '') ?? ''
  const selChapter = chapters.find((c) => c.name === selName) ?? null

  // 选中章的分幕草稿若有缺段警示（> ⚠️ 第 X 段未按导演板写成…），显示「补写缺段」入口
  useEffect(() => {
    let alive = true
    if (!id || !selChapter || !outlineFiles.includes(actsRel(selChapter))) {
      setDraftMissing([])
      return
    }
    void window.zhijuan.readDoc(id, actsRel(selChapter)).then((draft) => {
      if (alive) setDraftMissing(draft ? parseActsWarn(draft) : [])
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, selChapter, outlineFiles])

  const build = async (only?: string[]) => {
    if (!id || building) return
    setBuilding(true)
    setMsg('')
    try {
      const r = await window.zhijuan.agentOutlineRebuild(id, only)
      if (r.ok) {
        setMsg(`✓ 已回建 ${r.written.length} 张章卡（写作引擎逐章读正文，结果已落到 大纲/ 目录）`)
        toast.add({ kind: 'success', title: '章卡回建完成', description: `已回建 ${r.written.length} 张，落 大纲/ 目录` })
      } else {
        setMsg('✗ ' + r.error)
        toast.add({ kind: 'error', title: '章卡回建失败', description: r.error })
      }
      await refresh()
    } catch (e: any) {
      setMsg('✗ ' + String(e?.message ?? e))
      toast.add({ kind: 'error', title: '章卡回建失败', description: String(e?.message ?? e) })
    } finally {
      setBuilding(false)
    }
  }

  const direct = async () => {
    if (!id || directing) return
    if (!selChapter) {
      setMsg('先在左侧选中一章（章卡或导演板），再点「导演本章」')
      return
    }
    setDirecting(true)
    setMsg('')
    try {
      const r = await window.zhijuan.agentDirector(id, '正文/' + selChapter.file)
      if (r.ok) {
        setMsg(`✓ 已为「${selChapter.name}」生成本章导演板（${r.written}），可重导覆盖`)
        toast.add({ kind: 'success', title: '导演板已生成', description: `「${selChapter.name}」落 ${r.written}，可重导覆盖` })
      } else {
        setMsg('✗ ' + r.error)
        toast.add({ kind: 'error', title: '导演板生成失败', description: r.error })
      }
      await refresh()
    } catch (e: any) {
      setMsg('✗ ' + String(e?.message ?? e))
      toast.add({ kind: 'error', title: '导演板生成失败', description: String(e?.message ?? e) })
    } finally {
      setDirecting(false)
    }
  }

  const act = async () => {
    if (!id || acting) return
    if (!selChapter) {
      setMsg('先在左侧选中一章（章卡或导演板），再点「分幕生成」')
      return
    }
    if (!hasBoard(selChapter)) {
      setMsg('本章还没有导演板，先点「导演本章」生成一张，再来分幕。')
      return
    }
    setActing(true)
    setMsg('')
    try {
      const r = await window.zhijuan.agentActs(id, '正文/' + selChapter.file)
      if (r.ok) {
        if (r.failed?.length) {
          setMsg(
            `⚠ 「${selChapter.name}」第 ${r.failed.join('、')} 段没写成，草稿只有 ${r.acts} 段（缺段处会断戏）：右上角会出现「补写缺段」，只重写失败段；落 ${r.written}`
          )
          toast.add({ kind: 'warning', title: '分幕草稿有缺段', description: `「${selChapter.name}」第 ${r.failed.join('、')} 段没写成，可点「补写缺段」；落 ${r.written}` })
        } else {
          setMsg(`✓ 已按导演板分 ${r.acts} 段起草「${selChapter.name}」，草稿约 ${r.words} 字，落 ${r.written}`)
          toast.add({ kind: 'success', title: '分幕草稿已生成', description: `「${selChapter.name}」共 ${r.acts} 段约 ${r.words} 字，落 ${r.written}` })
        }
      } else {
        setMsg('✗ ' + r.error)
        toast.add({ kind: 'error', title: '分幕生成失败', description: r.error })
      }
      await refresh()
    } catch (e: any) {
      setMsg('✗ ' + String(e?.message ?? e))
      toast.add({ kind: 'error', title: '分幕生成失败', description: String(e?.message ?? e) })
    } finally {
      setActing(false)
    }
  }

  // 补写缺段：只重写草稿里未写成的段（已写成的段原样保留），不重跑全章
  const repair = async () => {
    if (!id || repairing || !selChapter) return
    setRepairing(true)
    setMsg('')
    try {
      const r = await window.zhijuan.agentActs(id, '正文/' + selChapter.file, { onlyFailed: true })
      if (r.ok) {
        if (r.failed?.length) {
          setMsg(
            `⚠ 「${selChapter.name}」第 ${r.failed.join('、')} 段重写后仍没写成（草稿现 ${r.acts} 段）：可再点「补写缺段」重试，或手动补；落 ${r.written}`
          )
          toast.add({ kind: 'warning', title: '补写后仍有缺段', description: `「${selChapter.name}」第 ${r.failed.join('、')} 段仍没写成，可再点「补写缺段」重试；落 ${r.written}` })
        } else {
          setMsg(
            `✓ 已补写「${selChapter.name}」缺段，草稿现为完整 ${r.acts} 段（约 ${r.words} 字），可「采纳为正文」；落 ${r.written}`
          )
          toast.add({ kind: 'success', title: '缺段已补写', description: `「${selChapter.name}」草稿现为完整 ${r.acts} 段（约 ${r.words} 字，落 ${r.written}），可「采纳为正文」` })
        }
        setDraftMissing(r.failed ?? [])
      } else {
        setMsg('✗ ' + r.error)
        toast.add({ kind: 'error', title: '补写缺段失败', description: r.error })
      }
      await refresh()
    } catch (e: any) {
      setMsg('✗ ' + String(e?.message ?? e))
      toast.add({ kind: 'error', title: '补写缺段失败', description: String(e?.message ?? e) })
    } finally {
      setRepairing(false)
    }
  }

  // 兑现检查「没兑现/部分兑现」→ 重写对应分幕段：只重写该段号（草稿其余段原样保留），
  // 与「补写缺段」同一条 only 通道；段号=导演板情绪弧顺序，与检查报告 arcs 顺序一一对应
  const rewriteSeg = async (seg: number) => {
    if (!id || rewriting || !selChapter) return
    setRewriting(true)
    setMsg('')
    try {
      const r = await window.zhijuan.agentActs(id, '正文/' + selChapter.file, { only: [seg] })
      if (r.ok) {
        if (r.failed?.length) {
          setMsg(
            `⚠ 「${selChapter.name}」第 ${seg} 段重写后仍没写够（草稿其余段保留）：可再点「重写」重试，或手动补；落 ${r.written}`
          )
          toast.add({ kind: 'warning', title: '分段重写后仍未写好', description: `「${selChapter.name}」第 ${seg} 段仍没写够，可再点「重写」重试；落 ${r.written}` })
        } else {
          setMsg(
            `✓ 已重写「${selChapter.name}」第 ${seg} 段（其余段保留）。可再点「兑现检查」重查，或「采纳为正文」；落 ${r.written}`
          )
          toast.add({ kind: 'success', title: '分段已重写', description: `「${selChapter.name}」第 ${seg} 段已重写（其余段保留，落 ${r.written}）` })
        }
        setDraftMissing(r.failed ?? [])
      } else {
        setMsg('✗ ' + r.error)
        toast.add({ kind: 'error', title: '分段重写失败', description: r.error })
      }
      await refresh()
    } catch (e: any) {
      setMsg('✗ ' + String(e?.message ?? e))
      toast.add({ kind: 'error', title: '分段重写失败', description: String(e?.message ?? e) })
    } finally {
      setRewriting(false)
    }
  }

  const extVersion = useMemo(() => (sel ? events.filter((e) => e.path === sel).length : 0), [events, sel])

  const adopt = async () => {
    if (!id || adopting || !selChapter || !hasActs(selChapter)) return
    if (!confirmAdopt) {
      setConfirmAdopt(true)
      // 缺段草稿采纳＝整章替换且缺段情节会无声消失：先明示缺段，主人仍可硬采（草稿文件保留可回滚）
      if (draftMissing.length > 0) {
        setMsg(`⚠️ 当前分幕草稿缺第 ${draftMissing.join('、')} 段（未按导演板写成）：直接采纳后这些情节不会进正文。建议先点「补写缺段」；仍要采纳请再点一次确认。`)
      }
      return
    }
    setConfirmAdopt(false)
    setAdopting(true)
    setMsg('')
    try {
      const r = await window.zhijuan.adoptActs(id, '正文/' + selChapter.file, actsRel(selChapter))
      if (r.ok) {
        setMsg(
          draftMissing.length > 0
            ? `✓ 已把「${selChapter.name}」的正文换成当前分幕草稿（${r.words} 字；注意草稿缺第 ${draftMissing.join('、')} 段，缺段处情节未进正文，需自行补齐）。切片同步中…`
            : `✓ 已把「${selChapter.name}」的正文换成当前分幕草稿（${r.words} 字）；草稿仍保留在 大纲/，可再改再采纳。切片同步中…`
        )
        // 采纳=整章正文被替换（正文为源、设定为流）：与「保存正文」同口径，完成后触发切片同步出新提案
        const tid = toast.add({ kind: 'success', title: '已采纳为正文', description: `「${selChapter.name}」正文已替换（${r.words} 字），切片同步中…`, duration: 0 })
        // 结果呈现统一入口（首跑与「重试同步」共用）：成功→提示/toast 更新；失败→toast 挂 action 按钮可就地重试
        let retrySync: (() => void) | null = null
        const applySyncOutcome = (s: SliceSyncResult) => {
          const guardNote =
            s.issues && s.issues.length > 0
              ? `（拦截 ${s.issues.length} 条：${s.issues[0].reason.slice(0, 24)}…）`
              : ''
          if (s.ok) {
            if (s.items > 0) {
              setMsg(`✓ 已替换正文并生成 ${s.items} 条切片提案${guardNote}（待确认）`)
              toast.update(tid, { kind: 'info', title: '切片提案待确认', description: `正文替换完成，生成 ${s.items} 条切片提案` })
            } else {
              setMsg(`✓ 已替换正文；切片同步：无设定变化${guardNote}`)
              toast.update(tid, { kind: 'success', title: '切片同步完成', description: '正文替换完成，无设定变化' })
            }
          } else {
            setMsg(`✗ 正文已替换，但切片同步失败：${s.error ?? '未知原因'}`)
            toast.update(tid, {
              kind: 'error',
              title: '切片同步失败',
              description: s.error ?? '未知原因',
              action: { label: '重试同步', onClick: () => retrySync?.() }
            })
          }
        }
        retrySync = () => {
          setMsg('切片同步重试中…')
          toast.update(tid, { kind: 'loading', title: '切片同步重试中…', description: undefined, action: null })
          void runSliceSync(id, '正文/' + selChapter.file).then(applySyncOutcome)
        }
        void runSliceSync(id, '正文/' + selChapter.file).then(applySyncOutcome)
      } else {
        setMsg('✗ ' + r.error)
        toast.add({ kind: 'error', title: '采纳为正文失败', description: r.error })
      }
      await refresh()
    } catch (e: any) {
      setMsg('✗ ' + String(e?.message ?? e))
      toast.add({ kind: 'error', title: '采纳为正文失败', description: String(e?.message ?? e) })
    } finally {
      setAdopting(false)
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-64 shrink-0 flex-col border-r border-hair bg-surface-2">
        <div className="flex items-center gap-2 border-b border-hair px-3 py-2.5">
          <BookMarked className="h-4 w-4 text-accent" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">章卡</span>
          <span className="flex-1" />
          <span className="text-[10px] text-ink-3">{chapters.length} 章 · {outlineFiles.filter((f) => !f.endsWith('索引.md') && !f.endsWith('_导演.md') && !f.endsWith('_分幕.md') && !f.startsWith('大纲/审读_')).length} 已回建</span>
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
          {loading && !loadErr && (
            <div className="flex items-center justify-center gap-2 px-2 py-6 text-xs text-ink-3">
              <LoadingIndicator size={16} />
              <span>正在读取章卡…</span>
            </div>
          )}
          {!loading && loadErr && (
            <div className="px-2 py-5 text-center">
              <p className="text-xs text-danger">读取章卡失败</p>
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
            <EmptyState compact hint="还没有章节。去「正文创作」写第一章，再来回建章卡。" dataTestId="empty-outline-side" />
          )}
          {chapters.map((c) => {
            const done = hasCard(c)
            return (
              <div key={c.file} className="mb-0.5">
                <div className="flex items-center">
                  <button
                    onClick={() => setSel(cardRel(c))}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors',
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
                  {done && (
                    <button
                      onClick={() => setHistoryRel(cardRel(c))}
                      className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface hover:text-accent"
                      title="版本历史（章卡被重跑覆盖时旧版自动留档，可回看/恢复）"
                      aria-label="版本历史"
                      data-testid="card-history"
                    >
                      <History className="h-3 w-3" />
                    </button>
                  )}
                </div>
                {hasBoard(c) && (
                  <div className="ml-5 flex items-center">
                    <button
                      onClick={() => setSel(boardRel(c))}
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors',
                        sel === boardRel(c) ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface'
                      )}
                    >
                      <Clapperboard className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">导演板</span>
                      {staleBoards.has(c.name) && (
                        <span className="shrink-0 rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] text-warn">偏旧</span>
                      )}
                    </button>
                    <button
                      onClick={() => setHistoryRel(boardRel(c))}
                      className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface hover:text-accent"
                      title="版本历史（导演板被重导覆盖时旧版自动留档，可对照旧承诺后重导）"
                      aria-label="版本历史"
                      data-testid="board-history"
                    >
                      <History className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {hasActs(c) && (
                  <div className="ml-5 flex items-center">
                    <button
                      onClick={() => setSel(actsRel(c))}
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors',
                        sel === actsRel(c) ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface'
                      )}
                    >
                      <PenLine className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">分幕草稿</span>
                    </button>
                    <button
                      onClick={() => setHistoryRel(actsRel(c))}
                      className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface hover:text-accent"
                      title="版本历史（分幕草稿被重写/补写覆盖时旧版自动留档，可回看/恢复）"
                      aria-label="版本历史"
                      data-testid="acts-history"
                    >
                      <History className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
          {auditReports.length > 0 && (
            <div className="mt-2 border-t border-hair pt-2">
              <div className="px-3 pb-1 text-[10px] text-ink-3">审读存档</div>
              {auditReports.map((f) => (
                <div key={f} className="flex items-center">
                  <button
                    onClick={() => setSel(f)}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors',
                      sel === f ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:bg-surface'
                    )}
                    title="全卷检查自动存档，可点击回看；重跑会覆盖本文件（旧版点右侧「历史」按钮可回看/恢复）"
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{f.replace('大纲/审读_', '').replace(/\.md$/, '')}</span>
                  </button>
                  <button
                    onClick={() => setHistoryRel(f)}
                    className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface hover:text-accent"
                    title="版本历史（重跑检查时旧结论自动留档，可回看差异/恢复）"
                    aria-label="版本历史"
                    data-testid="audit-history"
                  >
                    <History className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hair px-4">
          <ListTree className="h-3.5 w-3.5 text-ink-3" />
          <span className="truncate text-sm font-medium text-ink">
            {sel === '大纲/索引.md' ? '章卡索引' : sel?.replace('大纲/', '').replace(/\.md$/, '').replace(/_(导演|分幕)$/, '').replace(/^审读_/, '')}
          </span>
          <span className="flex-1" />
          {msg && <span className={cn('max-w-[40vw] truncate rounded-full px-2.5 py-0.5 text-[11px]', msg.startsWith('✓') ? 'bg-success-soft text-success' : msg.startsWith('✗') ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent')}>{msg}</span>}
          {building && (
            <span className="flex items-center gap-1 text-[11px] text-accent">
              <LoadingIndicator size={12} /> 写作引擎逐章回建中…（每章约一两分钟）
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
          {directing && (
            <span className="flex items-center gap-1 text-[11px] text-accent">
              <LoadingIndicator size={12} /> 写作引擎导演中…（约一两分钟）
            </span>
          )}
          <button
            onClick={() => void direct()}
            disabled={directing || !selChapter}
            className="flex items-center gap-1 rounded-md border border-hair px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            title={selChapter ? `给「${selChapter.name}」导出一张导演板（动笔前用，可重导覆盖）` : '先在左侧选中一章'}
          >
            <Clapperboard className="h-3 w-3" /> 导演本章
          </button>
          <button
            onClick={() => setCheckOpen(true)}
            disabled={!selChapter || !hasBoard(selChapter)}
            className="flex items-center gap-1 rounded-md border border-hair px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            title={selChapter && hasBoard(selChapter) ? `对照「${selChapter.name}」的导演板核对本章（动笔后用，只读不改稿）` : selChapter ? '本章还没有导演板，先点「导演本章」' : '先在左侧选中一章'}
          >
            <ShieldCheck className="h-3 w-3" /> 兑现检查
          </button>
          {(acting || repairing) && (
            <span className="flex items-center gap-1 text-[11px] text-accent">
              <LoadingIndicator size={12} />
              {repairing ? '写作引擎补写缺段中…（每段约一两分钟）' : '写作引擎分幕起草中…（每段约一两分钟）'}
            </span>
          )}
          <button
            onClick={() => void act()}
            disabled={acting || repairing || !selChapter || !hasBoard(selChapter)}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-hair px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
            title={selChapter && hasBoard(selChapter) ? `按「${selChapter.name}」导演板的情绪弧分幕，逐段起草整章草稿（落 大纲/）` : selChapter ? '本章还没有导演板，先点「导演本章」' : '先在左侧选中一章'}
          >
            <PenLine className="h-3 w-3" /> 分幕生成
          </button>
          {draftMissing.length > 0 && (
            <button
              onClick={() => void repair()}
              disabled={repairing || acting || !selChapter}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-warn px-2 py-1 text-[11px] text-warn transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
              title={
                selChapter
                  ? `只重写「${selChapter.name}」第 ${draftMissing.join('、')} 段（已写成的段保留），不重跑全章`
                  : '先在左侧选中一章'
              }
            >
              <Wrench className="h-3 w-3" /> 补写缺段
            </button>
          )}
          {adopting && (
            <span className="flex items-center gap-1 text-[11px] text-accent">
              <LoadingIndicator size={12} /> 采纳为正文中…
            </span>
          )}
          <button
            onClick={() => void adopt()}
            disabled={adopting || !selChapter || !hasActs(selChapter)}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors disabled:opacity-40',
              confirmAdopt
                ? 'border-danger bg-danger-soft text-danger hover:border-danger'
                : 'border-hair text-ink-2 hover:border-accent hover:text-accent'
            )}
            title={
              selChapter && hasActs(selChapter)
                ? confirmAdopt
                  ? draftMissing.length > 0
                    ? `再点一次：仍采纳（注意草稿缺第 ${draftMissing.join('、')} 段，缺段情节不会进正文；草稿文件保留可回滚）`
                    : `再点一次：把「${selChapter.name}」的正文整体替换为当前分幕草稿（保留约定头，草稿文件仍保留）`
                  : `把「${selChapter.name}」的正文换成当前分幕草稿（保留约定头与题名，草稿仍保留在 大纲/）`
                : selChapter
                  ? '本章还没有分幕草稿，先点「分幕生成」'
                  : '先在左侧选中一章'
            }
          >
            <CheckCheck className="h-3 w-3" /> {confirmAdopt ? '再点一次确认采纳' : '采纳为正文'}
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
        {selChapter && staleBoards.has(selChapter.name) && (
          <div className="flex shrink-0 items-center gap-1.5 border-b border-hair bg-warn-soft px-4 py-1 text-[11px] text-warn">
            <Clapperboard className="h-3 w-3 shrink-0" />
            <span className="truncate">本章导演板早于正文：兑现检查对照的是旧承诺，正文有改动建议点「导演本章」重导。</span>
          </div>
        )}
        <div className="min-h-0 flex-1">
          {sel ? (
            <DocEditor projectId={id} rel={sel} extVersion={extVersion} onSave={() => void refresh()} />
          ) : loadErr ? null : (
            <EmptyState
              art="outline"
              title="还没有章卡"
              hint="点右上角「回建缺失」把已有正文回建成章卡。"
              className="h-full"
              dataTestId="empty-outline"
            />
          )}
        </div>
      </main>
      <DirectorCheckDrawer
        projectId={id}
        chapter={selChapter ? { name: selChapter.name, file: selChapter.file } : null}
        open={checkOpen}
        onClose={() => setCheckOpen(false)}
        actsExists={!!selChapter && hasActs(selChapter)}
        onRewriteSeg={(seg) => void rewriteSeg(seg)}
        rewriting={rewriting}
      />
      <HistoryDrawer projectId={id} rel={historyRel ?? ''} open={historyRel !== null} onClose={() => setHistoryRel(null)} />
    </div>
  )
}
