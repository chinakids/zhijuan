import { describe, it, expect } from 'vitest'
import { Schema, type Node as PMNode } from 'prosemirror-model'
import { anchorFromPos, restoreCursorSelection, saveCursor, takeCursor, cursorMemorySnapshot, CURSOR_CTX } from '../../src/renderer/src/features/editor/cursorMemory'

// 与 finder.test.ts 同源的真实 ProseMirror doc（不 mock，保证 textBetween/pos 语义真实）
const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false }
  },
  marks: { strong: {} }
})
function makeDoc(content: unknown[]) {
  return schema.nodeFromJSON({ type: 'doc', content })
}
const p = (content: unknown[]) => ({ type: 'paragraph', content })
const t = (text: string, marks?: unknown[]) => ({ type: 'text', text, marks })

// 「第01章的雾港码头，雨一直下个不停。」×2 构成重复语境；拼接足够长文本保证前后文
const SEG = '第01章的雾港码头，雨一直下个不停，阿七数着每一道水痕。'
const LONG = SEG + SEG
const docL = makeDoc([p([t(LONG)])])
// 找 SEG 第一处位置：LONG 中第一个字符是 SEG[0]，pos=1 起步
const segStart = 1
const segEnd = segStart + SEG.length

function selOf(doc: PMNode, from: number, to = from) {
  return { from, to, empty: from === to }
}

describe('cursorMemory.anchorFromPos', () => {
  it('空文档返回 null', () => {
    const d = makeDoc([p([])])
    expect(anchorFromPos(d, 0, 0)).toBeNull()
  })

  it('中部光标：before/after 各 24 字且与 textBetween 一致', () => {
    const d = makeDoc([p([t(LONG)])])
    const pos = segEnd + 3 // 第二段 SEG 内
    const a = anchorFromPos(d, pos, pos)
    expect(a).not.toBeNull()
    expect(a!.before).toBe(d.textBetween(pos - CURSOR_CTX, pos, '\n'))
    expect(a!.after).toBe(d.textBetween(pos, pos + CURSOR_CTX, '\n'))
    expect(a!.after.length).toBeLessThanOrEqual(CURSOR_CTX)
    expect(a!.empty).toBe(true)
    expect(a!.len).toBe(0)
  })

  it('文档首：before 空、after 从 0 起', () => {
    const d = makeDoc([p([t('雾港')])])
    const a = anchorFromPos(d, 1, 1)
    expect(a!.before).toBe('')
    expect(a!.after).toBe('雾港')
  })

  it('非空选区：len/sel 正确', () => {
    const d = makeDoc([p([t('ABCDEFGHIJKLMNOPQRSTUVWXYZ')])])
    const a = anchorFromPos(d, 2, 5)!
    expect(a.empty).toBe(false)
    expect(a.len).toBe(3)
    expect(a.sel).toBe('BCD')
  })
})

describe('cursorMemory.restoreCursorSelection', () => {
  it('文本未变：精确恢复光标到 before 结束', () => {
    const d = makeDoc([p([t(LONG)])])
    // 光标放在第二段 SEG 内部
    const want = segEnd + 5
    const a = anchorFromPos(d, want, want)!
    const r = restoreCursorSelection(d, a)
    expect(r).toEqual({ from: want, to: want })
  })

  it('重复文本消歧：两处 before 相同但 after 不同 → 选 after 校验通过处', () => {
    // 「码头」出现两次（index 1 与 6），光标在第二处；第一处 after 是「甲乙…」，第二处是「WXYZ」
    const d = makeDoc([p([t('甲码头甲乙码头WXYZ乙')])])
    const a = { before: '码头', after: 'WXYZ', empty: true, len: 0 }
    const r = restoreCursorSelection(d, a)
    // 第二处「码头」字符 index 5-6 → pos 6-7，光标在其后 → pos 8
    expect(r).toEqual({ from: 8, to: 8 })
  })

  it('重复段模板：pos 提示选距离最近的候选（防回错段）', () => {
    // 三段内容除段号外全同，光标在第三段中部
    const SEG = '阿七站在灯下，海风把衣角吹起来，她数着远处闪烁的光点。'
    const d = makeDoc([p([t('第一段' + SEG)]), p([t('第二段' + SEG)]), p([t('第三段' + SEG)])])
    const want = 2 + (4 + SEG.length) + 2 + (4 + SEG.length) + 2 + 4 + 15 // 第三段前 + 段号 + 15 字
    const a = anchorFromPos(d, want, want)!
    const r = restoreCursorSelection(d, a)
    expect(r).not.toBeNull()
    expect(r!.from).toBe(want)
  })
  it('附近被改（after 失配）：降级恢复光标到 before 结束', () => {
    const d = makeDoc([p([t(LONG)])])
    const want = segEnd + 5
    const a = anchorFromPos(d, want, want)!
    // 改掉 after 起点处的字符（模拟光标后文本被编辑）
    const dMod = makeDoc([p([t(LONG.slice(0, want) + '【改】' + LONG.slice(want + 1))])])
    const r = restoreCursorSelection(dMod, a)
    expect(r).not.toBeNull()
    expect(r!.from).toBe(want) // before 结束位置不变
    expect(r!.to).toBe(want)
  })

  it('找不到 before：返回 null（不动不打扰）', () => {
    const a = { before: '完全不存在的文本xyz', after: '', empty: true, len: 0 }
    const r = restoreCursorSelection(makeDoc([p([t(LONG)])]), a)
    expect(r).toBeNull()
  })

  it('锚在文档首（before 空）：用 after 定位到其起点', () => {
    const d = makeDoc([p([t('雾港灯塔')])])
    const a = anchorFromPos(d, 1, 1)!
    const r = restoreCursorSelection(d, a)
    expect(r).toEqual({ from: 1, to: 1 })
  })

  it('非空选区：原文一致恢复选区；已变降级光标', () => {
    const d = makeDoc([p([t('ABCDEFGHIJKLMNOPQRSTUVWXYZ')])])
    const a = anchorFromPos(d, 2, 6)!
    expect(a.sel).toBe('BCDE')
    const r = restoreCursorSelection(d, a)
    expect(r).toEqual({ from: 2, to: 6 })
    // 选中文本被改 → 降级光标
    const dMod = makeDoc([p([t('ABXYZIJKLMNOPQRSTUVWXYZ')])])
    const r2 = restoreCursorSelection(dMod, a)
    expect(r2).toEqual({ from: 2, to: 2 })
  })

  it('空文档 / 全空锚：null', () => {
    const a = { before: '', after: '', empty: true, len: 0 }
    expect(restoreCursorSelection(makeDoc([p([])]), a)).toBeNull()
  })
})

describe('cursorMemory.saveCursor/takeCursor', () => {
  it('LRU：保存/消费语义与滚动记忆一致', () => {
    saveCursor('k1', { before: 'a', after: 'b', empty: true, len: 0 })
    expect(cursorMemorySnapshot().length).toBeGreaterThan(0)
    expect(takeCursor('k1')).toEqual({ before: 'a', after: 'b', empty: true, len: 0 })
    expect(takeCursor('k1')).toBeUndefined()
  })

  it('LRU 上限：插入超过 64 挤掉最旧', () => {
    for (let i = 0; i < 70; i++) saveCursor('lk' + i, { before: 'b' + i, after: '', empty: true, len: 0 })
    const snap = cursorMemorySnapshot()
    expect(snap.length).toBeLessThanOrEqual(64)
    expect(takeCursor('lk0')).toBeUndefined() // 最旧被挤
    expect(takeCursor('lk69')).not.toBeUndefined() // 最新在
  })
})
