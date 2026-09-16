import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { listSlices, writeSliceRegistry, listLines, writeLinesRegistry } from '../../src/main/slices'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'zj-slices-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const chap = (no: number, name: string, slice?: string, time?: string) =>
  ['---', `章号: ${no}`, `题名: ${name}`, ...(slice ? [`切片: ${slice}`] : []), ...(time ? [`时间: ${time}`] : []), '---', '', `# ${name}`, '', '正文内容'].join('\n')

describe('listSlices（从章头枚举时间切片）', () => {
  it('只认带 切片 约定头的正文；时间字段可选带出', () => {
    mkdirSync(join(root, '正文'), { recursive: true })
    writeFileSync(join(root, '正文/第1章_雾港.md'), chap(1, '雾港', '第一幕_夏夜', '夏季'))
    writeFileSync(join(root, '正文/第2章_灯塔.md'), chap(2, '灯塔', '第二幕_灯塔'))
    writeFileSync(join(root, '正文/无约定头.md'), '# 没有约定头')
    const slices = listSlices(root)
    expect(slices).toHaveLength(2)
    expect(slices[0]).toMatchObject({ name: '第一幕_夏夜', chapter: '第1章_雾港', time: '夏季' })
    expect(slices[1]).toMatchObject({ name: '第二幕_灯塔', chapter: '第2章_灯塔', time: undefined })
  })

  it('正文目录缺失 → 空列表', () => {
    expect(listSlices(root)).toEqual([])
  })

  it('按章节名自然排序（第2章 在 第10章 前）', () => {
    mkdirSync(join(root, '正文'), { recursive: true })
    writeFileSync(join(root, '正文/第2章_乙.md'), chap(2, '乙', 's2'))
    writeFileSync(join(root, '正文/第10章_甲.md'), chap(10, '甲', 's10'))
    writeFileSync(join(root, '正文/第1章_丙.md'), chap(1, '丙', 's1'))
    expect(listSlices(root).map((s) => s.chapter)).toEqual(['第1章_丙', '第2章_乙', '第10章_甲'])
  })
})

describe('writeSliceRegistry（登记切片清单到 .zhijuan/slices.json）', () => {
  it('写入并返回路径；内容可被读回', () => {
    const f = writeSliceRegistry(root, [{ name: '第一幕', chapter: '第1章_a', line: '主线', updatedAt: 1 }])
    expect(f).toContain('.zhijuan')
    const data = JSON.parse(readFileSync(f, 'utf-8'))
    expect(data.slices).toHaveLength(1)
    expect(data.slices[0].name).toBe('第一幕')
  })
})

const chapLine = (no: number, name: string, slice: string, line?: string) =>
  ['---', `章号: ${no}`, `题名: ${name}`, `切片: ${slice}`, ...(line ? [`时间线: ${line}`] : []), '---', '', `# ${name}`, '', '正文内容'].join('\n')

describe('listLines / writeLinesRegistry（多时间线枚举，F-20260916-02）', () => {
  it('listLines：按章的「时间线」字段枚举线与章数；缺省=主线（老项目零迁移）', () => {
    mkdirSync(join(root, '正文'), { recursive: true })
    writeFileSync(join(root, '正文/第1章_现状.md'), chapLine(1, '现状', '幕A', '主线'))
    writeFileSync(join(root, '正文/第2章_旧忆.md'), chapLine(2, '旧忆', '幕0B', '过去线'))
    writeFileSync(join(root, '正文/第3章_回线.md'), chapLine(3, '回线', '幕B', '主线'))
    writeFileSync(join(root, '正文/第4章_未声明.md'), chapLine(4, '未声明', '幕C'))
    writeFileSync(join(root, '正文/无切片.md'), '# 没有约定头')
    expect(listLines(root)).toEqual([
      { name: '主线', chapters: 3 },
      { name: '过去线', chapters: 1 }
    ])
  })

  it('writeLinesRegistry：落 .zhijuan/lines.json 且可读回（与 slices.json 同构）', () => {
    const f = writeLinesRegistry(root, [
      { name: '主线', chapters: 2 },
      { name: '过去线', chapters: 1 }
    ])
    expect(f).toContain('.zhijuan')
    const data = JSON.parse(readFileSync(f, 'utf-8'))
    expect(data.lines).toHaveLength(2)
    expect(data.lines[1]).toEqual({ name: '过去线', chapters: 1 })
  })
})
