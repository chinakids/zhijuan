// ===== 版本化路径规则（真机 src/main/history.ts 与 devShim 共口径，防漂移）=====
// 纳入：正文/（正文史）、大纲/审读_*（审读存档）、大纲/ 章卡与 <章>_导演.md/<章>_分幕.md（写作副产物，2026-09-14 智能层轮）、
// 人物/ 世界观/ 素材库/（档案与设定块，2026-10-27 未保存守卫轮：这三处此前无快照，
// 切片同步/promote 覆盖或手误改坏后无从回退——DocSection 与素材库已接「版本历史」抽屉）。
// 例外：① 大纲/索引.md——纯路标文件，随时可由章卡文件权威重建，不入史；
// ② 素材库/采集池/——采集管道原样落盘缓冲区（CollectionBar 直接写），非人工撰写，
//    入史只会让每次抓取/编辑都留一版噪声快照；正式素材（素材库/<类别>/x.md）照常入史。
// 注：调用点只有 store.writeDoc 写盘前与 devShim 的同口径 mock（history.writeSnapshot 亦自查一次），
// 命中即「内容有变化才留旧版」，不影响新建（文件不存在时无旧内容可存）。
export function isVersionedRel(rel: string): boolean {
  return (
    rel.startsWith('正文/') ||
    (rel.startsWith('大纲/') && rel !== '大纲/索引.md') ||
    rel.startsWith('人物/') ||
    rel.startsWith('世界观/') ||
    (rel.startsWith('素材库/') && !rel.startsWith('素材库/采集池/'))
  )
}
