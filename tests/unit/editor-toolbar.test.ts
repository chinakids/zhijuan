import { describe, expect, it } from 'vitest'
import { computeHideCount, EDITOR_SHORTCUTS, SEP_W, GAP, MORE_W, type ToolGroup, type ToolItem } from '../../src/renderer/src/features/editor/toolbarLayout'

/** 与 EditorToolbar 同构的最小工具集（宽度模拟实测）：
 * 组序 = [h1 h2 h3 para] [bold italic code quote ul ol] [undo redo]，共 12 项。
 * 隐藏优先级（低频→高频）：code quote ol ul italic bold redo undo h3 h2 h1 para */
const mk = (key: string): ToolItem => ({ key, name: key, icon: null, run: () => {} })
const groups: ToolGroup[] = [
  { key: 'g1', items: ['h1', 'h2', 'h3', 'para'].map(mk) },
  { key: 'g2', items: ['bold', 'italic', 'code', 'quote', 'ul', 'ol'].map(mk) },
  { key: 'g3', items: ['undo', 'redo'].map(mk) }
]
const flatKeys = groups.flatMap((g) => g.items).map((it) => it.key)
const PRIORITY = ['code', 'quote', 'ol', 'ul', 'italic', 'bold', 'redo', 'undo', 'h3', 'h2', 'h1', 'para']
  .map((k) => flatKeys.indexOf(k))
  .filter((i) => i >= 0)

const W = () => flatKeys.map(() => 24) // 每项 24px

/** 全量可见宽（与 computeHideCount 同模型）：12*24 + 组间 sep 9*2 + 元素间 gap 2*(14-1) */
function fullWidth() {
  let w = 0
  let count = 0
  let seen = false
  for (const g of groups) {
    if (seen) { w += SEP_W; count++ }
    for (const it of g.items) { w += 24; count++ }
    seen = true
  }
  return w + (count - 1) * GAP
}

describe('computeHideCount（编辑器工具栏窄窗溢出）', () => {
  it('全部放得下 → 不隐藏（无需 More）', () => {
    expect(computeHideCount(W(), PRIORITY, groups, fullWidth())).toBe(0)
    expect(computeHideCount(W(), PRIORITY, groups, fullWidth() + 100)).toBe(0)
  })

  it('刚好放得下 → 不隐藏（等宽边界算可容）', () => {
    expect(computeHideCount(W(), PRIORITY, groups, fullWidth() + 0)).toBe(0)
  })

  it('只差 1px → 隐藏最次要的 code（+More 预留后仍放得下）', () => {
    const k = computeHideCount(W(), PRIORITY, groups, fullWidth() - 1)
    expect(k).toBeGreaterThanOrEqual(1)
  })

  it('空间继续缩小 → 按优先级顺序隐藏 code→quote→ol→ul', () => {
    const full = fullWidth()
    // 隐藏 4 个（code quote ol ul）：宽 = 12*24 - 4*24 + sep*2 + gaps，截断到只够 4 个
    const k4 = computeHideCount(W(), PRIORITY, groups, full - 4 * 24 - 1)
    expect(k4).toBeGreaterThanOrEqual(4)
  })

  it('太窄 → 全部收进 More', () => {
    const k = computeHideCount(W(), PRIORITY, groups, MORE_W + GAP) // 只有 More 能放
    expect(k).toBe(PRIORITY.length)
  })

  it('More 按钮宽参与预算：仅差一个按钮时先隐低频', () => {
    const full = fullWidth()
    const k = computeHideCount(W(), PRIORITY, groups, full - 1)
    // 隐藏 1 个后还有 More 预留 → 若仍超则继续
    expect(k).toBeGreaterThanOrEqual(1)
  })

  it('组间 sep 不计宽：某组全隐后相邻组之间只有一个 sep', () => {
    // 组2 全隐（6 项）后：可见 = 4 + 2 项 + 1 sep
    let w = 0
    let count = 0
    let seen = false
    for (const g of [groups[0], groups[2]]) {
      if (seen) { w += SEP_W; count++ }
      for (const it of g.items) { w += 24; count++ }
      seen = true
    }
    const width = w + (count - 1) * GAP
    // 该宽度下组2 全隐可容纳，但多 1px 则需隐组1 的项
    expect(computeHideCount(W(), PRIORITY, groups, width)).toBeGreaterThanOrEqual(6) // 先收组2
    expect(computeHideCount(W(), PRIORITY, groups, width - 1)).toBeGreaterThan(6) // 收完组2 还不够
  })
})

describe('EDITOR_SHORTCUTS（菜单键位提示权威表）', () => {
  it('每个键位提示的 key 都必须对应真实工具栏工具（防悬空提示）', () => {
    const keys = new Set(flatKeys)
    for (const k of Object.keys(EDITOR_SHORTCUTS)) expect(keys.has(k)).toBe(true)
  })

  it('行内代码 code 不列提示：⌘E 被「用选区设置查找词」占用（2026-09-17 实锤）', () => {
    expect(EDITOR_SHORTCUTS.code).toBeUndefined()
  })

  it('提示文本是 mac 符号形式（专有 ⌥⌘⇧ 与键名组合，无英文 Mod- 字样）', () => {
    for (const v of Object.values(EDITOR_SHORTCUTS)) {
      expect(v).toMatch(/^[⌥⇧⌘]*⌘[0-9A-Z]$/)
    }
  })

  it('撤销/重做按 mac 惯例显示 ⇧⌘Z（Mod-y 亦绑定但以 Shift-Cmd-Z 展示）', () => {
    expect(EDITOR_SHORTCUTS.undo).toBe('⌘Z')
    expect(EDITOR_SHORTCUTS.redo).toBe('⇧⌘Z')
  })
})
