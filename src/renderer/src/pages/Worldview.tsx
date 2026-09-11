import DocSection from '../features/docs/DocSection'

export default function Worldview() {
  return (
    <DocSection
      relDir="世界观"
      overviewFile="世界观/总纲.md"
      addLabel="设定文档"
      addHint="新建设定文档（如：力量体系 / 地理 / 势力）"
      listLabel="世界观设定"
      emptyHint="还没有设定文档。总纲在项目创建时已生成。"
      templateFor={(name) => `# ${name}\n\n> 按时间切片维护：每个切片的当刻事实由「切片同步」维护，这里写不变的部分。\n\n## 具体规则\n\n\n## 各切片当刻状态\n`}
      fileTitle={(n) => n.replace(/^_/, '')}
    />
  )
}
