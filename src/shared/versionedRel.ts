// ===== 版本化路径规则（真机 src/main/history.ts 与 devShim 共口径，防漂移）=====
// 纳入：正文/（正文史）、大纲/审读_*（审读存档）、大纲/ 下章卡/<章>_导演.md/<章>_分幕.md（写作副产物，2026-09-14 智能层轮）。
// 例外：大纲/索引.md——纯路标文件，随时可由章卡文件权威重建，不入史。
export function isVersionedRel(rel: string): boolean {
  return (
    rel.startsWith('正文/') ||
    rel.startsWith('大纲/审读_') ||
    (rel.startsWith('大纲/') && rel !== '大纲/索引.md')
  )
}
