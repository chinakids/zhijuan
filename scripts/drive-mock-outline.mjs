// 数据层冒烟驱动 mock（供 scripts/multiline-outline-director-smoke.mjs 替换 ./runtime）：
// 按 sid 前缀返回可被 extract 的 JSON（outline-回建 / director-导演板），不连模型。
export async function driveSession(sid, _prompt, _opts) {
  if (sid.startsWith('outline-')) {
    return JSON.stringify({
      oneLine: '（冒烟）这一章在全书里把线推进一步。',
      beats: ['事件A', '事件B'],
      charProgress: '人物前进。',
      hooks: ['钩子']
    })
  }
  if (sid.startsWith('director-')) {
    return JSON.stringify({
      premise: '（冒烟）本章戏剧任务。',
      arcs: [{ task: '推进', goal: '推进目标' }],
      climax: { at: 1, idea: '波峰' },
      axes: [],
      redlines: ['红线'],
      hooks: ['钩']
    })
  }
  return '{}'
}
