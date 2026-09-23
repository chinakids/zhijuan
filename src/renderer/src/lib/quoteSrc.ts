/**
 * 划词引用来源显示名（体验层 2026-09-23）：由文档相对路径推出「类别·名称」可读标签。
 * 消费者① AgentPanel 输入区引用提示条（作者确认引用取自哪份文档）；② 用户消息首行
 * 「（引用自 《类别·名称》 选中段落）」文案——修旧实现用「当前正文章节」标注来源造成的
 * 跨文档/跨章节错误（探针实锤：人物档案划词回正文发送被标成正文章名）。
 * 未知目录/无前缀 → 原样返回（保底可辨）。目录词=路径约定（shared/paths DIR），
 * 术语=文案口径表（人物/世界观/素材/大纲）。
 */
export function quoteSrcOf(rel: string): string {
  const m = /^([^/]+)\/(.+)$/.exec(rel)
  if (!m) return rel
  const dir = m[1]
  const name = m[2].replace(/\.md$/, '')
  switch (dir) {
    case '正文':
      return `正文·${name}`
    case '人物':
      return `人物·${name}`
    case '世界观':
      return `世界观·${name}`
    case '素材库':
      return `素材·${name}`
    case '大纲':
      return `大纲·${name}`
    default:
      return rel
  }
}
