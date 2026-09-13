import { describe, it, expect, beforeEach } from 'vitest'
import { EditSyncGate, isChapterTarget, EDIT_SYNC_WINDOW_MS } from '../../src/shared/editSyncGate'

describe('EditSyncGate（正文写入后切片同步 · 60s 同文件节流）', () => {
  let gate: EditSyncGate
  beforeEach(() => {
    gate = new EditSyncGate()
  })

  it('首次放行并记时；同 key 窗口期内节流', () => {
    expect(gate.tryRun('p1|正文/第01章_雾港.md', 1000)).toBe(true)
    expect(gate.tryRun('p1|正文/第01章_雾港.md', 1000 + EDIT_SYNC_WINDOW_MS - 1)).toBe(false)
  })

  it('窗口过期后重新放行', () => {
    gate.tryRun('p1|正文/第01章_雾港.md', 1000)
    expect(gate.tryRun('p1|正文/第01章_雾港.md', 1000 + EDIT_SYNC_WINDOW_MS)).toBe(true)
  })

  it('不同 key（项目/文件）互不影响', () => {
    gate.tryRun('p1|正文/第01章_雾港.md', 1000)
    expect(gate.tryRun('p2|正文/第01章_雾港.md', 1000)).toBe(true)
    expect(gate.tryRun('p1|正文/第02章_旧城.md', 1000)).toBe(true)
  })

  it('失败后 clear 允许立即重试（不节流口径）', () => {
    const key = 'p1|正文/第01章_雾港.md'
    gate.tryRun(key, 1000)
    gate.clear(key)
    expect(gate.tryRun(key, 1001)).toBe(true)
  })

  it('reset 清空全部记录', () => {
    gate.tryRun('p1|正文/第01章_雾港.md', 1000)
    gate.reset()
    expect(gate.tryRun('p1|正文/第01章_雾港.md', 1001)).toBe(true)
  })
})

describe('isChapterTarget（仅正文/ 前缀触发正文同步）', () => {
  it('正文文档为 true', () => {
    expect(isChapterTarget('正文/第01章_雾港.md')).toBe(true)
  })

  it('人物/世界观/大纲审读/空值均为 false（不误触发）', () => {
    expect(isChapterTarget('人物/沈藏.md')).toBe(false)
    expect(isChapterTarget('世界观/灯塔.json')).toBe(false)
    expect(isChapterTarget('大纲/审读_全卷.md')).toBe(false)
    expect(isChapterTarget('')).toBe(false)
    expect(isChapterTarget(undefined)).toBe(false)
    expect(isChapterTarget(null)).toBe(false)
  })
})
