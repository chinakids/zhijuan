import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ChevronLeft, FileText, Folder, FolderPlus, Library as LibraryIcon, Plus, Search, X } from 'lucide-react'
import LoadingIndicator from '../../components/LoadingIndicator'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/EmptyState'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { FieldError, fieldInvalidClass } from '../../components/ui/field-error'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { cn } from '../../lib/utils'
import { isImeComposing } from '../../lib/ime'
import { buildLibraryTree, type LibraryFileItem } from '../../../../shared/libraryTree'
import { extractFrontMatter } from '../../../../shared/fmatter'
import { isMaterialCard, materialPreview, materialTags } from '../../../../shared/materialCard'
import type { LibraryCategory, SearchHit } from '../../../../shared/types'
import DocEditor from '../editor/DocEditor'
import { useFsChanged, useFsEvents } from '../fs/useFsEvents'

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
}

export default function LibraryBrowser({ openDoc }: LibraryBrowserProps = {}) {
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
  const events = useFsEvents(id)
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    void refresh()
  }, [refresh])

  // 外部跳转直达（⌘K 面板素材搜索）：打开编辑器并退出搜索态（面板路径消费后外层已清参，openDoc 变 null 不重复触发）
  useEffect(() => {
    if (openDoc) {
      setEditorRel(openDoc)
      setSearchQ('')
      setHits(null)
    }
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
    const name = newMatName.trim()
    const rel = `素材库/${selCat}/${name}.md`
    setNewMatErr('')
    try {
      await window.zhijuan.writeDoc(id, rel, materialTemplate(name))
    } catch (e) {
      setNewMatErr('新建素材失败：' + String((e as Error).message ?? e))
      return
    }
    setNewMatOpen(false)
    setNewMatName('')
    await refresh()
    setEditorRel(rel)
  }

  const matInCat = useMemo(
    () =>
      files
        .filter((f) => isMaterialCard(f.file) && (!selCat || f.file.split('/')[0] === selCat))
        .sort((a, b) => b.mtime - a.mtime),
    [files, selCat]
  )
  const listView = !editorRel

  return (
    <div className="flex h-full min-h-0">
      {/* 左列：类别树 */}
      <aside data-zj-libtree className="flex w-56 shrink-0 flex-col border-r border-hair bg-surface-2">
        <div className="flex items-center gap-1.5 px-3 pb-2 pt-3">
          <LibraryIcon className="h-3.5 w-3.5 text-ink-3" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-3">素材库</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {/* 固定项：索引说明（模块设计 §2.2 素材库/索引.md） */}
          <button
            onClick={() => {
              setSearchQ('')
              setHits(null)
              setEditorRel('素材库/索引.md')
            }}
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
              onClick={() => {
                setSearchQ('')
                setHits(null)
                setEditorRel(null)
                setSelCat(node.name)
              }}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors',
                selCat === node.name && !editorRel ? 'bg-accent-soft' : 'hover:bg-surface'
              )}
            >
              <Folder className="h-3.5 w-3.5 shrink-0 text-ink-3" />
              <span className={cn('min-w-0 flex-1 truncate text-sm', selCat === node.name && !editorRel ? 'font-medium text-accent' : 'text-ink')}>
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

      {/* 右列：列表 / 搜索 / 编辑 */}
      <main className="flex min-w-0 flex-1 flex-col">
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
                  data-testid="lib-search-clear"
                  className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-ink-3 hover:text-ink active:text-ink-2"
                  onClick={() => {
                    onSearchChange('')
                    searchRef.current?.focus()
                  }}
                >
                  <X className="h-3 w-3" /> 清除
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
                        onClick={() => setEditorRel(h.file)}
                        className="mb-2 block w-full rounded-lg border border-hair bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/60"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                          <span className="truncate text-sm font-medium text-ink">{h.name}</span>
                          <span className="shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2">
                            {h.field === 'name' ? '文件名' : '正文'}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-all text-[11px] text-ink-3">{h.snippet}</p>
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
                    <button
                      key={f.file}
                      onClick={() => setEditorRel('素材库/' + f.file)}
                      className="mb-2 block w-full rounded-lg border border-hair bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/60"
                      title={sub ? `位于子目录 ${sub}/` : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                        <span className="truncate text-sm font-medium text-ink">{f.name.replace(/\.md$/, '')}</span>
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
                      {meta && meta.preview && <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-all text-[11px] text-ink-3">{meta.preview}</p>}
                    </button>
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
                onClick={() => setEditorRel(null)}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> 返回
              </button>
              <span className="truncate text-sm font-medium text-ink">
                {editorRel.replace(/^素材库\//, '').replace(/\.md$/, '')}
              </span>
              <span className="flex-1" />
              <span className="shrink-0 text-[11px] text-ink-3">素材为整理后草稿，可编辑可删 · ⌘S 保存</span>
            </div>
            <div className="min-h-0 flex-1">
              <DocEditor projectId={id} rel={editorRel} extVersion={extVersion} onSave={() => void refresh()} anno={false} />
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
            <Label>类别名 *</Label>
            <Input
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
            <Label>名字 *</Label>
            <Input
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
    </div>
  )
}
