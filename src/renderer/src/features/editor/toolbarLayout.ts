/** 编辑器工具栏布局纯逻辑（无 React 依赖，供组件与单测共用）。 */

export interface ToolItem {
  key: string
  name: string
  /** 任意 React 组件类型（布局纯逻辑不感知具体类型） */
  icon: any
  run: (v: any, s: any) => void
}
/** 一个工具组：组内按钮相邻，组与组之间渲染分隔线（组全隐则 sep 也隐） */
export interface ToolGroup { key: string; items: ToolItem[] }

export const SEP_W = 9 // css .sep width 1px + margin 0 4px
export const GAP = 2 // flex gap
export const MORE_W = 28 // More 按钮宽（icon 按钮 24px + 余量）

/**
 * 计算需隐藏的「最次要」项数 k（hidePriority 前 k 个进入 More 菜单）。
 * @param widths  顺序与 groups 展平一致的每个 item 的实测宽（不含 sep）
 * @param hidePriority 从最次要到最关键的隐藏顺序（条目为展平索引）
 * @param groups  显示顺序的组（决定 sep 是否可见：当前组之前存在任一可见组时渲染）
 * @param avail   容器可用宽度（不含 padding）
 * 布局模型与渲染一致：item/sep 平铺在 flex 容器（gap=GAP），sep 是容器直接子元素。
 * 返回满足「可见宽 + More 预留 ≤ avail」的最小隐藏量。
 */
export function computeHideCount(
  widths: number[],
  hidePriority: number[],
  groups: ToolGroup[],
  avail: number,
  moreW = MORE_W,
  gap = GAP,
  sepW = SEP_W
): number {
  const flat: ToolItem[] = groups.flatMap((g) => g.items)
  const indexOf = (it: ToolItem): number => flat.indexOf(it)

  const visibleWidth = (k: number): number => {
    const hidden = new Set(hidePriority.slice(0, k))
    let w = 0
    let count = 0 // 已渲染元素数（item + sep）
    let seenVisGroup = false
    for (const g of groups) {
      const vis = g.items.filter((it) => !hidden.has(indexOf(it)))
      if (vis.length === 0) continue
      if (seenVisGroup) {
        w += sepW
        count++
      }
      for (const it of vis) {
        w += widths[indexOf(it)]
        count++
      }
      seenVisGroup = true
    }
    return w + (count > 0 ? (count - 1) * gap : 0)
  }

  for (let k = 0; k <= hidePriority.length; k++) {
    const w = visibleWidth(k) + (k > 0 ? moreW + gap : 0)
    if (w <= avail) return k
  }
  return hidePriority.length
}
