import DocSection from '../features/docs/DocSection'

export default function Library() {
  return (
    <DocSection
      relDir="素材库"
      overviewFile="素材库/索引.md"
      addLabel="素材卡"
      addHint="新建素材卡（联网采集在 S5 接入）"
      emptyHint="素材库空的。可以在左侧新建素材卡，或在 S5 用「按需求采集」直接从网上抓。"
      templateFor={(name) => `# ${name}\n\n## 用途\n\n## 正文可复用点\n\n## 来源与版权注意\n`}
      fileTitle={(n) => n.replace(/^_/, '')}
    />
  )
}
