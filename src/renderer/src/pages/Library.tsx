import CollectionBar from '../features/collection/CollectionBar'
import DocSection from '../features/docs/DocSection'

export default function Library() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <CollectionBar />
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
    </div>
  )
}