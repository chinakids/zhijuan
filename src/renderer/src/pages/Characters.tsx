import DocSection from '../features/docs/DocSection'

export default function Characters() {
  return (
    <DocSection
      relDir="人物"
      overviewFile="人物/总览.md"
      addLabel="角色档案"
      addHint="新建角色档案"
      listLabel="角色档案"
      emptyHint="还没有人物档案。保存正文触发切片同步后，出场角色的切片状态会自动出现在这里（S4）。"
      withFm
      templateFor={(name) => `---\n别名: []\n---\n\n# ${name}\n\n## 基础档案\n\n| 项 | 值 |\n|---|---|\n| 身份 |  |\n| 年龄 |  |\n| 与主角关系 |  |\n| 外表 |  |\n\n## 状态时间线\n\n> 每个时间切片的角色状态由「切片同步」在此维护（正文保存时触发）。\n> 若 TA 在正文里还有别的称呼（昵称/化名），把「别名: [小七, 七爷]」写进顶部 front matter——「在场/称谓」机械检查会按它识别。\n`}
      fileTitle={(n) => n.replace(/^_/, '')}
    />
  )
}
