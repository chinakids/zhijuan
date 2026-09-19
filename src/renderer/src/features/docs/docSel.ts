/**
 * DocSection 选中项与文档列表的一致性解析（2026-09-19 体验层轮，候选 1「DocSection 初始空编辑器修正」）。
 *
 * 背景：人物/世界观页初始 sel=overviewFile（人物/总览.md、世界观/总纲.md），若该文档不在
 * listDocs 结果中（devShim 未 seed / 用户删除 / 旧项目缺骨架模板），sel 仍指向不存在的文档，
 * DocEditor 会把 readDoc null 当空文档渲染「开始写作…」空编辑器——不该出现的误导态
 * （可写却无内容，用户误以为总览内容丢失/可随意覆盖）。
 *
 * 口径：不存在时**不选中**（置 null，主区显示「选择左侧一个文档开始」）；
 * 真机 ensureSkeleton（新建/导入均调用）保证 overview 必在，正常路径零影响。
 */
export function resolveDocSel(sel: string | null, files: { file: string }[], relDir: string): string | null {
  if (!sel) return null
  return files.some((f) => relDir + '/' + f.file === sel) ? sel : null
}
