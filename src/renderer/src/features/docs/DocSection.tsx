import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileText, Plus } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { cn } from '../../lib/utils'

interface Props {
  relDir: string
  overviewFile: string
  addLabel: string
  addHint: string
  emptyHint: string
}

/**
 * 设定类板块的文档浏览器（S1：只读列表 + 纸面预览；S2 换成 Milkdown 编辑器）。
 * 约定：firstAdd 可再由各页注入，这里只负责展示与选中。
 */
export default function DocSection({ relDir, overviewFile, addLabel, addHint, emptyHint }: Props) {
  const { id } = useParams<{ id: string }>()
  const [files, setFiles] = useState<{ file: string; name: string; mtime: number }[]>([])
  const [sel, setSel] = useState<string>(overviewFile)
  const [content, setContent] = useState<string>('')

  const refresh = useCallback(async () => {
    if (!id) return
    const list = await window.zhijuan.listDocs(id, relDir)
    setFiles(list)
    // 默认选中总览文件（若有）
    if (!list.some((d) => d.file === sel)) {
      const ov = list.find((d) => d.file === overviewFile)
      setSel(ov ? ov.file : list[0]?.file ?? '')
    }
  }, [id, relDir, overviewFile, sel])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!id || !sel) return
    void window.zhijuan.readDoc(id, sel).then((t) => setContent(t ?? ''))
  }, [id, sel])

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r border-hair bg-surface-2">
        <div className="flex items-center justify-between px-3 pb-2 pt-3">
          <span className="text-xs font-medium text-ink-3">文档</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" title={addHint}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-auto px-2">
          {files.length === 0 && <p className="px-2 py-4 text-xs text-ink-3">{emptyHint}</p>}
          {files.map((d) => (
            <button
              key={d.file}
              onClick={() => setSel(d.file)}
              className={cn(
                'mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                sel === d.file ? 'bg-accent-soft' : 'hover:bg-well'
              )}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-ink-3" />
              <span className={cn('truncate text-sm', sel === d.file ? 'font-medium text-accent' : 'text-ink')}>{d.name}</span>
            </button>
          ))}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto bg-paper">
        {!sel ? (
          <div className="flex h-full items-center justify-center text-sm text-ink-3">选择左侧一个文档</div>
        ) : (
          <div className="paper-canvas whitespace-pre-wrap">{content}</div>
        )}
      </main>
    </div>
  )
}
