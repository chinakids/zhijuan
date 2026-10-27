import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { ChevronLeft, FileText, Folder, FolderPlus, History, Library as LibraryIcon, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/EmptyState'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { FieldError, fieldInvalidClass } from '../../components/ui/field-error'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { cn } from '../../lib/utils'
import { isImeComposing } from '../../lib/ime'
import { buildLibraryTree, type LibraryFileItem } from '../../../../shared/libraryTree'
import { extractFrontMatter } from '../../../../shared/fmatter'
import { isMaterialCard, materialPreview, materialTags } from '../../../../shared/materialCard'
import type { LibraryCategory, SearchHit } from '../../../../shared/types'
import { ColHideButton, ColShowBar } from '../common/colFold'
import { useColFold } from '../common/useColFold'
import DocEditor from '../editor/DocEditor'
import HistoryDrawer from '../editor/HistoryDrawer'
import { useUnsavedGuard } from '../editor/useUnsavedGuard'
import { useFsChanged, useFsEvents } from '../fs/useFsEvents'
import { toast } from '../../store/toasts'

interface CardMeta {
  preview: string
  tags: string[]
}

/** 单素材模板（与模块设计 §9「素材文档模板」一致：用途 / 可复用点 / 来源版权） */
function materialTemplate(name: string): string {
  return `# ${name}\n\n## 用途\n\n## 正文可复用的点\n\n## 来源与版权注意\n`
}

interface LibraryBrowserProps {
  /** 外部请求打开某个素材（相对项目根路径，如 素材库/人物/x.md；来自 ⌘K 面板搜索跳转） */
  openDoc?: string | null
  /** 搜索行工具条右侧附加动作（如页面层构造的「升格助手」按钮）——避免素材库页顶部因单入口再占一整行（F-20260917-07 不单独占行） */
  searchActions?: ReactNode
}

export default function LibraryBrowser({ openDoc, searchActions }: LibraryBrowserProps = {}) {
  const { id = '' } = useParams()
  const [categories, setCategories] = useState<LibraryCategory[]>([])
  const [files, setFiles] = useState<LibraryFileItem[]>([])
  const [selCat, setSelCat] = useState<string | null>(null)
  const [editorRel, setEditorRel] = useState<string | null>(null)
  const [cards, setCards] = useState<Map<string, CardMeta>>(new Map())
  const [searchQ, setSearchQ] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [newCatOpen, setNewCatOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatErr, setNewCatErr] = useState('')
  const [newMatOpen, setNewMatOpen] = useState(false)
  const [newMatName, setNewMatName] = useState('')
  const [newMatErr, setNewMatErr] = useState('')
  const [creating, setCreating] = useState(false)
  // 素材卡行操作（⋯ 菜单 / 编辑器顶栏共用）：file 相对「素材库」（如 人物/借书卡.md）
  const [deleting, setDeleting] = useState<{ file: string; name: string } | null>(null)
  const [renaming, setRenaming] = useState<{ file: string; name: string } | null>(null)
  const [renameVal, setRenameVal] = useState('')
  // 宽窗手动折叠（HIG Sidebars show/hide；与 Novel 5376f30 同机制；折叠态持久化=AppSettings 跨重启记住侧栏）
  const [colHidden, setColHidden] = useColFold('library')
  const events = useFsEvents(id)
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 版本历史抽屉（2026-10-27 未保存守卫轮）：素材库已纳入 versionedRel 快照白名单，
  // 整理/覆盖失误可回退（复用正文 HistoryDrawer；恢复时会再留一档，天然可反悔）
  const [historyRel, setHistoryRel] = useState<string | null>(null)
  // 未保存守卫（2026-10-27 体验层 P1）：此前「返回」/切类别/切素材都是直接 setEditorRel——
  // 素材卡写着写着点返回即静默丢稿。与 Novel 切章守卫同语义（三选确认 / 保存被拦则留在原处），
  // 路由离开与关窗由 hook 一并覆盖（素材库页卸载=未保存内容丢失）。
  const saveRef = useRef<(() => Promise<boolean>) | null>(null)
  const guard = useUnsavedGuard({
    subject: '这张素材卡',
    doSave: () => (saveRef.current ? saveRef.current() : false)
  })

  const refresh = useCallback(async () => {
    if (!id) return
    try {
      const [cats, list] = await Promise.all([
        window.zhijuan.listLibraryCategories(id),
        window.zhijuan.listDocs(id, '素材库')
      ])
      setCategories(cats)
      setFiles(list)
      setSelCat((s) => (s && cats.some((c) => c.name === s) ? s : (cats[0]?.name ?? null)))
      setLoadErr('')
    } catch (e) {
      setLoadErr(String((e as Error).message ?? e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    // 挂载/切项目先回 loading 并清旧项目数据（Timeline 样板，2026-09-22 体验层 stale 核查）：
    // 搜索命中/选中编辑文档/类别树都是项目数据面，不允许在新项目加载窗口残留；fs 刷新不受影响。
    setLoading(true)
    setCategories([])
    setFiles([])
    setSelCat(null)
    setEditorRel(null)
    setCards(new Map())
    setHits(null)
    setSearchQ('')
    setSearching(false)
    setLoadErr('')
    void refresh()
  }, [refresh])

  // 外部跳转直达（⌘K 面板素材搜索）：打开编辑器并退出搜索态（面板路径消费后外层已清参，openDoc 变 null 不重复触发）
  // 2026-10-27 未保存守卫：外部直跳也是「切素材」，编辑器有未保存改动时同样先确认（取消则留在原素材）。
  useEffect(() => {
    if (!openDoc) return
    void (async () => {
      if (openDoc !== editorRel && !(await guard.confirmLeave('switch'))) return
      guard.setDirty(false)
      setEditorRel(openDoc)
      setSearchQ('')
      setHits(null)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDoc])

  // 素材卡元信息（预览/标签）——当前选中类别变化时（重）读；全部文件量小，逐条读前 2KB 不阻塞
  useEffect(() => {
    let cancel = false
    const matFiles = selCat ? files.filter((f) => isMaterialCard(f.file) && f.file.split('/')[0] === selCat) : []
    if (!matFiles.length) {
      setCards(new Map())
      return
    }
    void (async () => {
      const map = new Map<string, CardMeta>()
      for (const f of matFiles) {
        try {
          const text = (await window.zhijuan.readDoc(id, '素材库/' + f.file)) ?? ''
          map.set(f.file, { preview: materialPreview(text), tags: materialTags(text) })
        } catch {
          // 单张素材读取失败不阻断列表（其余卡片照常显示；列表本身有错误卡兜底）
        }
      }
      if (!cancel) setCards(map)
    })()
    return () => {
      cancel = true
    }
  }, [id, files, selCat])

  useFsChanged(id, '素材库/', () => void refresh())

  const extVersion = useMemo(
    () => (editorRel ? events.filter((e) => e.path === editorRel).length : 0),
    [events, editorRel]
  )

  // 树：类别（含 count） + 素材文件（排除采集池/索引）
  const tree = useMemo(
    () => buildLibraryTree(categories, files.filter((f) => isMaterialCard(f.file))),
    [categories, files]
  )

  // 搜索：文件名+全文，空格分词 AND；350ms 防抖
  const runSearch = useCallback(
    (q: string) => {
      setSearching(true)
      window.zhijuan
        .searchDocs(id, '素材库', q, { excludePrefix: ['素材库/采集池/'] })
        .then((r) => setHits(r))
        .catch(() => setHits([]))
        .finally(() => setSearching(false))
    },
    [id]
  )
  const onSearchChange = (v: string) => {
    setSearchQ(v)
    if (qTimer.current) clearTimeout(qTimer.current)
    const q = v.trim()
    if (!q) {
      setHits(null)
      return
    }
    qTimer.current = setTimeout(() => runSearch(q), 350)
  }

  async function createCat() {
    if (!id || !newCatName.trim()) return
    setCreating(true)
    setNewCatErr('')
    let r: Awaited<ReturnType<typeof window.zhijuan.createLibraryCategory>>
    try {
      r = await window.zhijuan.createLibraryCategory(id, newCatName.trim())
    } catch (e) {
      setCreating(false)
      setNewCatErr('新建类别失败：' + String((e as Error).message ?? e))
      return
    }
    setCreating(false)
    if (!r.ok) {
      setNewCatErr(r.error ?? '新建类别失败')
      return
    }
    setNewCatOpen(false)
    setNewCatName('')
    await refresh()
    setSelCat(newCatName.trim())
  }

  async function createMat() {
    if (!id || !selCat || !newMatName.trim()) return
    const typed = newMatName.trim()
    setNewMatErr('')
    // 查重（写盘前）：类别内已有同名 → 不覆盖，自动改名「名字 2 / 名字 3」并提示
    let name = typed
    try {
      name = await window.zhijuan.uniqueDocName(id, `素材库/${selCat}`, typed)
    } catch {
      // 查重失败不阻断新建（按原名写；主进程名字已 sanitize）
    }
    const rel = `素材库/${selCat}/${name}.md`
    try {
      await window.zhijuan.writeDoc(id, rel, materialTemplate(name))
    } catch (e) {
      setNewMatErr('新建素材失败：' + String((e as Error).message ?? e))
      return
    }
    if (name !== typed) {
      toast.add({ kind: 'info', title: `已存为「${name}」`, description: `「${selCat}」里已有同名素材（或名字含特殊字符），原素材卡未被覆盖` })
    }
    setNewMatOpen(false)
    setNewMatName('')
    await refresh()
    // 新建后跳到新素材：当前素材若有未保存改动，同样先确认（与切素材同一守卫）
    await openMaterial(rel)
  }

  function startRename(file: string) {
    const name = file.split('/').pop()!.replace(/\.md$/, '')
    setRenameVal(name)
    setRenaming({ file, name })
  }

  /** 素材卡重命名：走 doc:rename（只改文件名；H1/版本历史目录由主进程随动） */
  async function doRename() {
    if (!id || !renaming || !renameVal.trim()) return
    const rel = '素材库/' + renaming.file
    try {
      const r = await window.zhijuan.docRename(id, rel, renameVal.trim())
      if (!r.ok) {
        toast.add({ kind: 'error', title: '重命名失败', description: r.error })
        return
      }
      const newName = renameVal.trim()
      toast.add({ kind: 'success', title: '已重命名', description: newName })
      setRenaming(null)
      setRenameVal('')
      await refresh()
      if (editorRel === rel && r.newRel) setEditorRel(r.newRel)
    } catch (e) {
      toast.add({ kind: 'error', title: '重命名失败', description: String((e as Error).message ?? e) })
    }
  }

  /** 素材卡删除：走 doc:delete（系统废纸篓可恢复）；确认弹窗在下方 Dialog */
  async function doDelete() {
    if (!id || !deleting) return
    const rel = '素材库/' + deleting.file
    try {
      const r = await window.zhijuan.deleteDoc(id, rel)
      if (!r.ok) {
        toast.add({ kind: 'error', title: '删除失败', description: r.error })
        setDeleting(null)
        return
      }
      toast.add({ kind: 'success', title: '已移入废纸篓（可恢复）', description: deleting.name })
      if (editorRel === rel) setEditorRel(null)
      setDeleting(null)
      await refresh()
    } catch (e) {
      toast.add({ kind: 'error', title: '删除失败', description: String((e as Error).message ?? e) })
      setDeleting(null)
    }
  }

  const matInCat = useMemo(
    () =>
      files
        .filter((f) => isMaterialCard(f.file) && (!selCat || f.file.split('/')[0] === selCat))
        .sort((a, b) => b.mtime - a.mtime),
    [files, selCat]
  )
  const listView = !editorRel

  /**
   * 打开/关闭素材（守卫版，2026-10-27）：编辑器里有未保存改动时先三选确认；
   * 取消或「保存」被空写防线/IO 拦下都留在原素材（不静默丢整理成果）。
   * rel=null 表示回列表（「返回」语义）。
   */
  async function openMaterial(rel: string | null, o: { clearSearch?: boolean } = {}) {
    if (rel === editorRel) return
    if (!(await guard.confirmLeave(rel === null ? 'leave' : 'switch'))) return
    guard.setDirty(false)
    if (o.clearSearch) {
      setSearchQ('')
      setHits(null)
    }
    setEditorRel(rel)
  }

  /** 切类别（回列表态并选中该类别）：同一守卫，类别里写着素材时切类别也不丢稿 */
  async function selectCat(name: string) {
    if (name === selCat && !editorRel) return
    if (!(await guard.confirmLeave('switch'))) return
    guard.setDirty(false)
    setSearchQ('')
    setHits(null)
    setEditorRel(null)
    setSelCat(name)
  }

  return (
    <div className="flex h-full min-h-0">
      {/* 左列：类别树 */}
      {!colHidden && (
      <aside data-zj-libtree data-testid="lib-col" className="flex w-56 shrink-0 flex-col border-r border-hair bg-surface-2">
        <div className="flex items-center gap-1.5 px-3 pb-2 pt-3">
          <LibraryIcon className="h-3.5 w-3.5 text-ink-3" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">素材库</span>
          <span className="flex-1" />
          <ColHideButton label="素材库" onClick={() => setColHidden(true)} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {/* 固定项：索引说明（模块设计 §2.2 素材库/索引.md） */}
          <button
            onClick={() => void openMaterial('素材库/索引.md', { clearSearch: true })}
            className={cn(
              'mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors',
              editorRel === '素材库/索引.md' ? 'bg-accent-soft' : 'hover:bg-surface'
            )}
            title="素材库索引（类别目录 + 采集入口说明）"
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-ink-3" />
            <span className="truncate text-sm text-ink">索引</span>
          </button>
          {tree.map((node) => (
            <button
              key={node.name}
              onClick={() => void selectCat(node.name)}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors',
                selCat === node.name && !editorRel ? 'bg-accent-soft' : 'hover:bg-surface'
              )}
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-ink-3" />
              <span className={cn('min-w-0 flex-1 truncate text-sm', selCat === node.name && !editorRel ? 'font-medium text-accent' : 'text-ink')} title={node.name}>
                {node.name}
              </span>
              <span className="shrink-0 text-[10px] text-ink-3">{node.count}</span>
            </button>
          ))}
          {loading && !loadErr && (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-ink-3">
              <LoadingIndicator size={16} />
              <span>正在读取素材库…</span>
            </div>
          )}
          {!loading && loadErr && <p className="px-3 py-4 text-center text-xs text-danger">读取失败</p>}
          {!loading && !loadErr && tree.length === 0 && (
            <EmptyState compact hint="还没有类别，点下方「＋ 新类别」创建。" dataTestId="empty-materials" />
          )}
        </div>
        <div className="border-t border-hair p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-1.5 text-[11px] text-ink-2 [&_svg]:size-3"
            onClick={() => {
              setNewCatErr('')
              setNewCatName('')
              setNewCatOpen(true)
            }}
          >
            <FolderPlus /> 新类别
          </Button>
        </div>
      </aside>
      )}

      {/* 右列：列表 / 搜索 / 编辑 */}
      <main className="flex min-w-0 flex-1 flex-col">
        {colHidden && (
          <ColShowBar label="素材库" onShow={() => setColHidden(false)} dataTestId="lib-col-show" />
        )}
        {listView ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-hair px-4 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-3" />
              <input
                ref={searchRef}
                data-testid="lib-search"
                className="h-7 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
                placeholder="搜索素材名与全文…（空格分词 AND）"
                value={searchQ}
                onChange={(e) => onSearchChange(e.target.value)}
                onKeyDown={(e) => {
                  // HIG Search fields：Clear button + macOS 搜索框惯例（Esc 清空查询、焦点留在框内，与首页同口径）
                  if (e.key === 'Escape' && searchQ) {
                    e.preventDefault()
                    e.stopPropagation()
                    onSearchChange('')
                  }
                }}
              />
              {searchQ && (
                <button
                  type="button"
                  data-testid="lib-search-clear"
                  aria-label="清空搜索"
                  title="清空搜索"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 transition-colors hover:text-ink active:text-ink-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  onClick={() => {
                    onSearchChange('')
                    searchRef.current?.focus()
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 whitespace-nowrap [&_svg]:size-3.5"
                disabled={!selCat}
                title={selCat ? '在当前类别新建素材卡' : '先在左侧选择一个类别'}
                onClick={() => {
                  setNewMatName('')
                  setNewMatErr('')
                  setNewMatOpen(true)
                }}
              >
                <Plus /> 新建素材
              </Button>
              {searchActions}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {!loading && loadErr ? (
                <div className="py-10 text-center">
                  <p className="text-sm font-medium text-danger">读取素材库失败</p>
                  <p className="mt-1 break-all text-xs text-ink-3">{loadErr}</p>
                  <button
                    className="mt-3 text-xs text-accent underline-offset-2 hover:underline"
                    onClick={() => {
                      setLoading(true)
                      setLoadErr('')
                      void refresh()
                    }}
                  >
                    重试
                  </button>
                </div>
              ) : hits !== null ? (
                // 搜索结果
                searching && hits.length === 0 ? (
                  <p className="py-8 text-center text-xs text-ink-3">搜索中…</p>
                ) : hits.length === 0 ? (
                  <p className="py-8 text-center text-xs text-ink-3">没有找到与「{searchQ.trim()}」相关的素材（文件名与正文都查了）。</p>
                ) : (
                  <>
                    <p className="mb-2 text-[11px] text-ink-3">搜索结果（{hits.length} 条，含文件名与正文）</p>
                    {hits.map((h) => (
                      <button
                        key={h.file}
                        onClick={() => void openMaterial(h.file)}
                        className="mb-2 block w-full rounded-lg border border-hair bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/60"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                          <span className="truncate text-sm font-medium text-ink" title={h.name}>{h.name}</span>
                          <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">
                            {h.field === 'name' ? '文件名' : '正文'}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-all text-[11px] text-ink-3" title={h.snippet}>{h.snippet}</p>
                      </button>
                    ))}
                  </>
                )
              ) : loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-xs text-ink-3">
                  <LoadingIndicator size={16} />
                  <span>正在读取素材库…</span>
                </div>
              ) : !selCat ? (
                <p className="py-8 text-center text-xs text-ink-3">先在左侧选择一个类别；顶部可以按需求发起采集，管道回填后自动出现在对应类别。</p>
              ) : matInCat.length === 0 ? (
                <p className="py-8 text-center text-xs text-ink-3">「{selCat}」还是空的。点右上「新建素材」，或发起采集让管道回填到这里。</p>
              ) : (
                matInCat.map((f) => {
                  const meta = cards.get(f.file)
                  const sub = f.file.split('/').slice(1, -1).join('/')
                  return (
                    <div key={f.file} className="group relative mb-2">
                      <button
                        onClick={() => void openMaterial('素材库/' + f.file)}
                        className="block w-full rounded-lg border border-hair bg-surface px-3 py-2.5 pr-10 text-left transition-colors hover:border-accent/60"
                        title={sub ? `位于子目录 ${sub}/` : undefined}
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                          <span className="truncate text-sm font-medium text-ink" title={f.name.replace(/\.md$/, '')}>{f.name.replace(/\.md$/, '')}</span>
                          {sub && <span className="shrink-0 text-[10px] text-ink-3">{sub}/</span>}
                          <span className="ml-auto shrink-0 text-[11px] text-ink-3">
                            {new Date(f.mtime).toLocaleDateString('zh-CN')}
                          </span>
                        </div>
                        {meta && meta.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {meta.tags.map((t) => (
                              <span key={t} className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        {meta && meta.preview && <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-all text-[11px] text-ink-3" title={meta.preview}>{meta.preview}</p>}
                      </button>
                      {/* 素材卡行操作（重命名/删除）：破坏性项置末 + danger 红字（HIG Context menus，先例=DocSection） */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="素材操作"
                            aria-label="素材操作"
                            data-testid="material-menu"
                            className="absolute right-1.5 top-2 h-6 w-6 text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:bg-well data-[state=open]:text-ink data-[state=open]:opacity-100"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => startRename(f.file)}>
                            <Pencil className="h-4 w-4" /> 重命名…
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-danger focus:bg-danger/10 focus:text-danger"
                            onSelect={() => setDeleting({ file: f.file, name: f.name.replace(/\.md$/, '') })}
                          >
                            <Trash2 className="h-4 w-4" /> 删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )
                })
              )}
            </div>
          </>
        ) : (
          /* 编辑视图 */
          <>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-hair px-4">
              <button
                className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[11px] text-ink-3 transition-colors hover:text-ink"
                onClick={() => void openMaterial(null)}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> 返回
              </button>
              <span className="truncate text-sm font-medium text-ink" title={editorRel.replace(/^素材库\//, '').replace(/\.md$/, '')}>
                {editorRel.replace(/^素材库\//, '').replace(/\.md$/, '')}
              </span>
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 [&_svg]:size-3.5"
                title="版本历史（整理失误可回退；恢复前会自动留档）"
                data-testid="material-history"
                onClick={() => setHistoryRel(editorRel)}
              >
                <History /> 历史
              </Button>
              {isMaterialCard(editorRel.replace(/^素材库\//, '')) && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 [&_svg]:size-3.5"
                    title="重命名这张素材卡"
                    data-testid="material-rename"
                    onClick={() => startRename(editorRel.replace(/^素材库\//, ''))}
                  >
                    <Pencil /> 重命名
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-danger [&_svg]:size-3.5"
                    title="这张素材卡移入系统废纸篓（可恢复）"
                    data-testid="material-delete"
                    onClick={() => {
                      const file = editorRel.replace(/^素材库\//, '')
                      setDeleting({ file, name: file.split('/').pop()!.replace(/\.md$/, '') })
                    }}
                  >
                    <Trash2 /> 删除
                  </Button>
                </>
              )}
              <span className="shrink-0 text-[11px] text-ink-3">素材为整理后草稿 · ⌘S 保存</span>
            </div>
            <div className="min-h-0 flex-1">
              <DocEditor
                projectId={id}
                rel={editorRel}
                extVersion={extVersion}
                saveHandleRef={saveRef}
                onDirtyChange={guard.reportDirty}
                onSave={() => void refresh()}
                anno={false}
              />
            </div>
          </>
        )}
      </main>

      {/* 新建类别 */}
      <Dialog open={newCatOpen} onOpenChange={setNewCatOpen}>
        <DialogContent className="sm:max-w-sm" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>新建类别</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="newcat-name">类别名 *</Label>
            <Input
              id="newcat-name"
              autoFocus
              placeholder="如：人物、场景、器物、设定出处…"
              value={newCatName}
              aria-invalid={!!newCatErr}
              className={fieldInvalidClass}
              onChange={(e) => {
                setNewCatName(e.target.value)
                if (newCatErr) setNewCatErr('')
              }}
              onKeyDown={(e) => {
                // IME 组合期 Enter 只确认候选，不建类别（F-IME-03）
                if (isImeComposing(e)) return
                if (e.key === 'Enter') void createCat()
              }}
            />
            {newCatErr && <FieldError data-testid="cat-field-error">{newCatErr}</FieldError>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCatOpen(false)}>取消</Button>
            <Button onClick={() => void createCat()} disabled={!newCatName.trim() || creating}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 新建素材 */}
      <Dialog open={newMatOpen} onOpenChange={setNewMatOpen}>
        <DialogContent className="sm:max-w-sm" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>新建素材卡{selCat ? `（类别：${selCat}）` : ''}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="newmat-name">名字 *</Label>
            <Input
              id="newmat-name"
              autoFocus
              placeholder="如：旧图书馆的借书卡"
              value={newMatName}
              aria-invalid={!!newMatErr}
              className={fieldInvalidClass}
              onChange={(e) => {
                setNewMatName(e.target.value)
                if (newMatErr) setNewMatErr('')
              }}
              onKeyDown={(e) => {
                // IME 组合期 Enter 只确认候选，不建素材（F-IME-03）
                if (isImeComposing(e)) return
                if (e.key === 'Enter') void createMat()
              }}
            />
            {newMatErr && <FieldError data-testid="mat-field-error">{newMatErr}</FieldError>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewMatOpen(false)}>取消</Button>
            <Button onClick={() => void createMat()} disabled={!newMatName.trim()}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 素材卡重命名：只改文件名（首个「# 旧名」标题与版本历史目录由主进程随动） */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm" outsideDismiss={false}>
          <DialogHeader>
            <DialogTitle>重命名素材卡</DialogTitle>
            <DialogDescription>只改文件名，内容保持不动；同名已存在时会提示，不会覆盖。</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="mat-rename">新名字 *</Label>
            <Input
              id="mat-rename"
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => {
                // IME 组合期 Enter 只确认候选，不改名（F-IME-03）
                if (isImeComposing(e)) return
                if (e.key === 'Enter' && renameVal.trim()) void doRename()
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>取消</Button>
            <Button onClick={() => void doRename()} disabled={!renameVal.trim() || renameVal.trim() === renaming?.name}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 素材卡删除确认：移入系统废纸篓（可恢复）——与文档删除同先例 */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>删除素材卡</DialogTitle>
            <DialogDescription>{deleting?.name ?? ''}将移入系统废纸篓（可恢复）。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>取消</Button>
            <Button className="text-danger" onClick={() => void doDelete()}>移入废纸篓</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 版本历史抽屉（素材库已入版本化白名单：整理/覆盖失误可回退） */}
      <HistoryDrawer projectId={id} rel={historyRel ?? ''} open={historyRel !== null} onClose={() => setHistoryRel(null)} />
      {/* 未保存三选确认（切素材 / 切类别 / 返回 / 路由离开 / 关窗共用同一弹窗） */}
      {guard.dialog}
    </div>
  )
}
