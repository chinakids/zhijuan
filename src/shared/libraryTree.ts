// ===== 织卷 V2 · 素材库类别树组装（shared 纯约定，无 fs） =====
// main 侧给「一级类别清单」+「素材文件清单（相对素材库的路径）」，
// 这里纯函数组装成树节点并按「类别名 → 文件名」排序；渲染层直接消费，逻辑可单测。

export interface LibraryFileItem {
  /** 相对素材库的路径（如 `环境/校园.md`） */
  file: string
  name: string
  mtime: number
}

export interface LibraryTreeNode {
  /** 一级类别名（目录名） */
  name: string
  /** 该类别下素材数 */
  count: number
  /** 素材文件（含子目录路径；按 mtime 新→旧排序） */
  files: LibraryFileItem[]
}

/**
 * 组装类别树。
 * - categories：main 扫盘得出的一级类别（目录=类别），含 count（可为 0：空类别也展示）；
 * - files：listDocs 对 `素材库` 的递归结果（file 相对素材库；调用方需已排除采集池/索引等非素材项）。
 * - 若 files 里出现 categories 未覆盖的目录（第三方手动建的），自动补类别节点。
 */
export function buildLibraryTree(categories: { name: string; count: number }[], files: LibraryFileItem[]): LibraryTreeNode[] {
  const byName = new Map<string, LibraryFileItem[]>()
  for (const f of files) {
    const seg = f.file.split('/')
    const top = seg[0]
    if (!top || top.startsWith('.')) continue
    const arr = byName.get(top) ?? []
    arr.push(f)
    byName.set(top, arr)
  }
  const names = new Set<string>([...categories.map((c) => c.name), ...byName.keys()])
  const nodes: LibraryTreeNode[] = []
  for (const name of names) {
    if (!name || name.startsWith('.')) continue
    const list = (byName.get(name) ?? []).slice()
    list.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file, 'zh'))
    const known = categories.find((c) => c.name === name)
    nodes.push({ name, count: Math.max(known?.count ?? 0, list.length), files: list })
  }
  nodes.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return nodes
}
