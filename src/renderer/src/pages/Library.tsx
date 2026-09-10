import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ArrowRightLeft } from 'lucide-react'
import CollectionBar from '../features/collection/CollectionBar'
import LibraryBrowser from '../features/library/LibraryBrowser'
import TriageDrawer from '../features/triage/TriageDrawer'

export default function Library() {
  const { id = '' } = useParams()
  const [triageOpen, setTriageOpen] = useState(false)
  // ?doc=<相对项目根路径>：⌘K 面板素材搜索结果跳转直达（消费后清参；与 novel?ch= 同策略，刷新不残留）
  const [sp, setSp] = useSearchParams()
  const openDoc = sp.get('doc')
  useEffect(() => {
    if (openDoc) setSp({}, { replace: true })
  }, [openDoc, setSp])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <CollectionBar />
      <div className="flex shrink-0 items-center gap-2 border-b border-hair px-4 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] whitespace-nowrap text-ink-3">正式类别下的素材可让写作引擎按语境归类，并判断是否能升格进设定档案。</span>
        <button
          onClick={() => setTriageOpen(true)}
          className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-hair px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
          title="素材 → 设定升格：逐条判断可入档与否，可转提案走确认制写入"
        >
          <ArrowRightLeft className="h-3 w-3" /> 升格助手
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <LibraryBrowser openDoc={openDoc} />
      </div>
      <TriageDrawer projectId={id} open={triageOpen} onClose={() => setTriageOpen(false)} />
    </div>
  )
}
