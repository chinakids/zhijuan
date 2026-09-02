import DocSection from '../features/docs/DocSection'

export default function Characters() {
  return (
    <DocSection
      relDir="人物"
      overviewFile="人物/总览.md"
      addLabel="新角色"
      addHint="新建角色（S2 接入）"
      emptyHint="还没有人物档案。先在正文里提到谁，再在这里建档案。"
    />
  )
}
