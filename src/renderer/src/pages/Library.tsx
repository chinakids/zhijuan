import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowRightLeft } from 'lucide-react'
import CollectionBar from '../features/collection/CollectionBar'
import DocSection from '../features/docs/DocSection'
import TriageDrawer from '../features/triage/TriageDrawer'

export default function Library() {
  const { id = '' } = useParams()
  const [triageOpen, setTriageOpen] = useState(false)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <CollectionBar />
      <div className="flex shrink-0 items-center gap-2 border-b border-hair px-4 py-1.5">
        <span className="text-[11px] text-ink-3">正式类别下的素材可让写作引擎按语境归类，并判断是否能升格进设定档案。</span>
        <span className="flex-1" />
        <button
          onClick={() => setTriageOpen(true)}
          className="flex items-center gap-1 rounded-md border border-hair px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
          title="素材 → 设定升格：逐条判断可入档与否，可转提案走确认制写入"
        >
          <ArrowRightLeft className="h-3 w-3" /> 升格助手
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <DocSection
          relDir="素材库"
          overviewFile="素材库/索引.md"
          addLabel="素材卡"
          addHint="新建素材卡"
          emptyHint="素材库是空的。顶部可以按需求发起联网采集，管道回填后这里就能看到素材。"
          templateFor={(name) => `# ${name}\n\n## 用途\n\n## 正文可复用的点\n\n## 来源与版权注意\n`}
          fileTitle={(n) => n.replace(/^_/, '')}
        />
      </div>
      <TriageDrawer projectId={id} open={triageOpen} onClose={() => setTriageOpen(false)} />
    </div>
  )
}
