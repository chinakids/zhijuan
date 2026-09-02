import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FolderTree, Inbox, CloudDownload, FileText } from 'lucide-react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { cn } from '../lib/utils'

interface Cat {
  file: string
  name: string
  count: number
}

interface MaterialDoc {
  file: string
  name: string
  mtime: number
}

export default function Library() {
  const { id } = useParams<{ id: string }>()
  const [cats, setCats] = useState<Cat[]>([])
  const [current, setCurrent] = useState<string>('')
  const [docs, setDocs] = useState<MaterialDoc[]>([])
  const [sel, setSel] = useState<string>('')
  const [content, setContent] = useState<string>('')

  const refresh = useCallback(async () => {
    if (!id) return
    const libs = await window.zhijuan.listDocs(id, '素材库')
    const catsMap = new Map<string, MaterialDoc[]>()
    for (const d of libs) {
      const cat = d.file.includes('/') ? d.file.split('/')[0] : '__root__'
      if (!catsMap.has(cat)) catsMap.set(cat, [])
      catsMap.get(cat)!.push(d)
    }
    const arr: Cat[] = [...catsMap.entries()]
      .map(([file, ds]) => ({ file, name: file === '__root__' ? '未分类' : file, count: ds.length }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    setCats(arr)
    if (!arr.some((c) => c.file === current)) setCurrent(arr[0]?.file ?? '')
  }, [id, current])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!id) return
    const dir = current === '__root__' ? '素材库' : current === '__pool__' ? '' : `素材库/${current}`
    if (!dir) {
      setDocs([])
      setSel('')
      return
    }
    void window.zhijuan.listDocs(id, dir).then((ds) => {
      setDocs(ds)
      if (!ds.some((d) => d.file === sel)) setSel(ds[0]?.file ?? '')
    })
  }, [id, current, sel])

  useEffect(() => {
    if (!id || !sel) return
    void window.zhijuan.readDoc(id, sel).then((t) => setContent(t ?? ''))
  }, [id, sel])

  return (
    <div className="flex h-full">
      {/* 类别树 */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-hair bg-surface-2">
        <div className="flex items-center gap-1.5 px-3 pb-2 pt-3 text-xs font-medium text-ink-3">
          <FolderTree className="h-3.5 w-3.5" />
          类别
        </div>
        <div className="flex-1 overflow-auto px-2">
          {cats.map((c) => (
            <button
              key={c.file}
              onClick={() => setCurrent(c.file)}
              className={cn(
                'mb-0.5 flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
                current === c.file ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-well'
              )}
            >
              <span className="truncate">{c.name}</span>
              <span className="text-[10px] text-ink-3">{c.count}</span>
            </button>
          ))}
          <button
            onClick={() => setCurrent('__pool__')}
            className={cn(
              'mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
              current === '__pool__' ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-well'
            )}
          >
            <Inbox className="h-3.5 w-3.5" />
            采集池
          </button>
        </div>
      </aside>

      {/* 素材列表 + 内容 */}
      <div className="flex min-w-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-hair">
          <div className="flex items-center gap-2 px-3 pb-2 pt-3">
            <span className="text-xs font-medium text-ink-3">{current === '__pool__' ? '采集任务' : '素材'}</span>
            <div className="flex-1" />
            {current !== '__pool__' && current !== '' && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" title="发起联网采集（S5 接入）">
                <CloudDownload className="h-3.5 w-3.5" /> 发起采集
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-auto px-2">
            {current === '__pool__' ? (
              <div className="px-2 py-4 text-xs text-ink-3">
                采集任务将落在这里（S5 接入）。
                <br />
                流程：任务卡 → 本机采集管道 → 回填为素材草稿。
              </div>
            ) : docs.length === 0 ? (
              <div className="px-2 py-4 text-xs text-ink-3">这个类别还没有素材。</div>
            ) : (
              docs.map((d) => (
                <button
                  key={d.file}
                  onClick={() => setSel(d.file)}
                  className={cn(
                    'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                    sel === d.file ? 'bg-accent-soft' : 'hover:bg-well'
                  )}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                  <span className={cn('truncate text-sm', sel === d.file ? 'font-medium text-accent' : 'text-ink')}>
                    {d.name}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto bg-paper">
          {!sel ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-ink-3">
              <Badge variant="secondary">每素材一个 md，带 front matter（tags / 来源）</Badge>
            </div>
          ) : (
            <div className="paper-canvas whitespace-pre-wrap">{content}</div>
          )}
        </main>
      </div>
    </div>
  )
}
