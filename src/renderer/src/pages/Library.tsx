import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ArrowRightLeft } from 'lucide-react'
import { Button } from '../components/ui/button'
import CollectionBar from '../features/collection/CollectionBar'
import LibraryBrowser from '../features/library/LibraryBrowser'
import TriageDrawer from '../features/triage/TriageDrawer'

export default function Library() {
  const { id = '' } = useParams()
  const [triageOpen, setTriageOpen] = useState(false)
  // ?doc=<相对项目根路径>：⌘K 面板素材搜索结果跳转直达（消费后清参；与 novel?ch= 同策略，刷新不残留）
  const [sp, setSp] = useSearchParams()
  const openDoc = sp.get('doc')
  // ?collect=1：侧栏「发起采集」快捷入口——跳转后自动打开采集表单（tick 递增传给 CollectionBar，消费后清参）
  const [collectReq, setCollectReq] = useState(0)
  const collect = sp.get('collect')
  useEffect(() => {
    if (openDoc) setSp({}, { replace: true })
  }, [openDoc, setSp])
  useEffect(() => {
    if (collect) {
      setCollectReq((n) => n + 1)
      setSp({}, { replace: true })
    }
  }, [collect, setSp])
  return (
    <div className="flex h-full min-h-0 flex-col">
      <CollectionBar requestOpen={collectReq} />
      <div className="min-h-0 flex-1">
        <LibraryBrowser
          openDoc={openDoc}
          searchActions={
            <Button
              variant="outline"
              size="sm"
              data-testid="lib-triage-open"
              className="shrink-0 whitespace-nowrap [&_svg]:size-3.5"
              title="素材 → 设定升格：正式类别下的素材可让写作引擎按语境归类，并逐条判断是否值得升格进设定档案（可转提案走确认制写入）"
              onClick={() => setTriageOpen(true)}
            >
              <ArrowRightLeft /> 升格助手
            </Button>
          }
        />
      </div>
      <TriageDrawer projectId={id} open={triageOpen} onClose={() => setTriageOpen(false)} />
    </div>
  )
}
