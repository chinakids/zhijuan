import { describe, it, expect } from 'vitest'
import { posixRel, toPosix } from '../../src/shared/relpath'
import { win32 } from 'path'

describe('posixRel（跨平台相对路径拼接）', () => {
  it('prefix 为空 → 直接返回 name', () => {
    expect(posixRel('', 'a.md')).toBe('a.md')
  })
  it('一级目录 → 正斜杠拼接', () => {
    expect(posixRel('正文', '第01章_雾港.md')).toBe('正文/第01章_雾港.md')
  })
  it('多级目录 → 逐级正斜杠', () => {
    expect(posixRel('素材库/采集池', '任务_1.md')).toBe('素材库/采集池/任务_1.md')
  })
  it('恒为正斜杠：与 path.win32.join 的 win 语义对照（win join 产反斜杠，本函数恒 /）', () => {
    // 对照证明：若用原生 win path.join 拼相对路径会出反斜杠（渲染层 IPC 契约全为 '/'）
    expect(win32.join('素材库', '环境', '灯塔.md')).toBe('素材库\\环境\\灯塔.md')
    expect(posixRel('素材库/环境', '灯塔.md')).toBe('素材库/环境/灯塔.md')
  })
})

describe('toPosix（平台分隔符归一）', () => {
  it('反斜杠 → 正斜杠', () => {
    expect(toPosix('素材库\\环境\\灯塔.md')).toBe('素材库/环境/灯塔.md')
  })
  it('已是正斜杠不变', () => {
    expect(toPosix('正文/第01章_雾港.md')).toBe('正文/第01章_雾港.md')
  })
  it('混合分隔符全部归一', () => {
    expect(toPosix('素材库\\环境/灯塔.md')).toBe('素材库/环境/灯塔.md')
  })
})
