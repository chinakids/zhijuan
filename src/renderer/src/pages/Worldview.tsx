import DocSection from '../features/docs/DocSection'

export default function Worldview() {
  return (
    <DocSection
      relDir="世界观"
      overviewFile="世界观/总纲.md"
      addLabel="新设定"
      addHint="新建设定文档（S2 接入）"
      emptyHint="还没有世界观文档。总纲在项目创建时已生成。"
    />
  )
}
