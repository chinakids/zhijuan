import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  HISTORY_LIMIT,
  isNovelRel,
  isVersionedRel,
  listSnapshots,
  prune,
  readSnapshot,
  snapDirFor,
  snapName,
  writeSnapshot
} from '../../src/main/history'

// 纯文件逻辑，不碰真实项目库：临时目录承载 projectRoot
function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'zj-history-test-'))
}

describe('history（正文版本历史）', () => {
  it('isNovelRel：只认 正文/ 前缀', () => {
    expect(isNovelRel('正文/第01章_雾港.md')).toBe(true)
    expect(isNovelRel('正文/第01章_雾港.md~')).toBe(true) // 前缀判定即可
    expect(isNovelRel('人物/林晚.md')).toBe(false)
    expect(isNovelRel('世界观/切片_第一幕.md')).toBe(false)
    expect(isNovelRel('大纲/索引.md')).toBe(false)
  })

  it('isVersionedRel：正文 ∪ 大纲（索引.md 例外）∪ 人物/世界观/素材库（采集池例外，2026-10-27 未保存守卫轮）', () => {
    // 正例
    expect(isVersionedRel('正文/第01章_雾港.md')).toBe(true)
    expect(isVersionedRel('大纲/审读_一致性巡查.md')).toBe(true)
    expect(isVersionedRel('大纲/审读_冷读报告.md')).toBe(true)
    expect(isVersionedRel('大纲/审读_多视角审视.md')).toBe(true)
    expect(isVersionedRel('大纲/审读_人物在场核查.md')).toBe(true)
    expect(isVersionedRel('大纲/第01章_雾港.md')).toBe(true) // 章卡
    expect(isVersionedRel('大纲/第01章_雾港_导演.md')).toBe(true) // 导演板
    expect(isVersionedRel('大纲/第01章_雾港_分幕.md')).toBe(true) // 分幕草稿
    expect(isVersionedRel('大纲/第03章_夜航_导演.md')).toBe(true) // 任意章副产物
    // 档案/设定块入史（2026-10-27）：切片同步、promote 或手误覆盖后可回退
    expect(isVersionedRel('人物/林晚.md')).toBe(true)
    expect(isVersionedRel('人物/总览.md')).toBe(true)
    expect(isVersionedRel('世界观/切片_第一幕.md')).toBe(true)
    expect(isVersionedRel('世界观/总纲.md')).toBe(true)
    expect(isVersionedRel('素材库/环境/校园.md')).toBe(true)
    // 反例：索引（路标可重建）、采集池（管道原样缓冲区，非人工撰写）
    expect(isVersionedRel('大纲/索引.md')).toBe(false)
    expect(isVersionedRel('素材库/采集池/20261001_知乎.md')).toBe(false)
    // 前缀不误命中（无同名裸目录/相似前缀）
    expect(isVersionedRel('人物志/林晚.md')).toBe(false)
    expect(isVersionedRel('素材库子目录/x.md')).toBe(false)
  })

  it('snapName 形如 yyyyMMdd-HHmmss-SSS 且可排序', () => {
    const a = snapName(Date.UTC(2026, 8, 10, 1, 2, 3, 4))
    expect(a).toMatch(/^\d{8}-\d{6}-\d{3}$/)
    // 本地时区构造，断言格式即可；排序性由大小比较验证
    const t1 = new Date(2026, 8, 10, 1, 2, 3, 4).getTime()
    const t2 = t1 + 1000
    expect(snapName(t1) < snapName(t2)).toBe(true)
  })

  it('snapDirFor 保留目录层级且去掉 .md', () => {
    expect(snapDirFor('正文/第01章_雾港.md')).toBe('.zhijuan/history/正文/第01章_雾港')
  })

  it('writeSnapshot：落盘 + 列表新→旧 + 内容读回一致', () => {
    const root = tmpRoot()
    const rel = '正文/第01章_雾港.md'
    const n1 = writeSnapshot(root, rel, 'v1 内容', new Date(2026, 8, 10, 1, 0, 0, 0).getTime())
    const n2 = writeSnapshot(root, rel, 'v2 内容', new Date(2026, 8, 10, 1, 5, 0, 0).getTime())
    expect(n1).toBeTruthy()
    expect(n2).toBeTruthy()
    expect(existsSync(join(root, snapDirFor(rel), n1!))).toBe(true)
    const list = listSnapshots(root, rel)
    expect(list.map((v) => v.name)).toEqual([n2, n1]) // 新→旧
    expect(readSnapshot(root, rel, n1!)).toBe('v1 内容')
    expect(readSnapshot(root, rel, '不存在.md')).toBe(null)
    rmSync(root, { recursive: true, force: true })
  })

  it('非版本化 rel（素材库/采集池、大纲/索引.md）：writeSnapshot 返回 null 且不落盘', () => {
    const root = tmpRoot()
    const rel = '素材库/采集池/20261001_知乎.md'
    expect(writeSnapshot(root, rel, 'x')).toBe(null)
    expect(existsSync(join(root, snapDirFor(rel)))).toBe(false)
    // 索引.md 是路标可重建，同样不入历史
    expect(writeSnapshot(root, '大纲/索引.md', 'x')).toBe(null)
    expect(existsSync(join(root, snapDirFor('大纲/索引.md')))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  it('人物/世界观/素材库 rel：writeSnapshot 落盘（档案入史，2026-10-27）', () => {
    const root = tmpRoot()
    for (const rel of ['人物/林晚.md', '世界观/总纲.md', '素材库/环境/校园.md']) {
      expect(writeSnapshot(root, rel, '旧版档案')).toBeTruthy()
      expect(listSnapshots(root, rel)).toHaveLength(1)
      expect(readSnapshot(root, rel, listSnapshots(root, rel)[0].name)).toBe('旧版档案')
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('章卡/导演板/分幕草稿 rel：writeSnapshot 落盘（写作副产物版本化，2026-09-14）', () => {
    const root = tmpRoot()
    for (const rel of ['大纲/第01章_雾港.md', '大纲/第01章_雾港_导演.md', '大纲/第01章_雾港_分幕.md']) {
      expect(writeSnapshot(root, rel, '旧版')).toBeTruthy()
      expect(listSnapshots(root, rel)).toHaveLength(1)
      expect(readSnapshot(root, rel, listSnapshots(root, rel)[0].name)).toBe('旧版')
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('审读报告 rel：writeSnapshot 落盘且同正文一样裁剪', () => {
    const root = tmpRoot()
    const rel = '大纲/审读_一致性巡查.md'
    const n1 = writeSnapshot(root, rel, 'v1 报告', new Date(2026, 8, 12, 9, 0, 0, 0).getTime())
    const n2 = writeSnapshot(root, rel, 'v2 报告', new Date(2026, 8, 12, 9, 5, 0, 0).getTime())
    expect(n1).toBeTruthy()
    expect(n2).toBeTruthy()
    // 保留层级：.zhijuan/history/大纲/审读_一致性巡查/
    expect(existsSync(join(root, '.zhijuan', 'history', '大纲', '审读_一致性巡查', n1!))).toBe(true)
    expect(listSnapshots(root, rel).map((v) => v.name)).toEqual([n2, n1])
    expect(readSnapshot(root, rel, n1!)).toBe('v1 报告')
    rmSync(root, { recursive: true, force: true })
  })

  it('同 ms 冲突：追加序号不覆盖', () => {
    const root = tmpRoot()
    const rel = '正文/第01章.md'
    const ts = new Date(2026, 8, 10, 1, 0, 0, 0).getTime()
    const a = writeSnapshot(root, rel, 'a', ts)
    const b = writeSnapshot(root, rel, 'b', ts)
    expect(a).not.toBe(b)
    expect(b!.includes('-1.md')).toBe(true)
    expect(readSnapshot(root, rel, a!)).toBe('a')
    expect(readSnapshot(root, rel, b!)).toBe('b')
    // 同 ms：序号大者视为新（列表首位）
    expect(listSnapshots(root, rel)[0].name).toBe(b)
    rmSync(root, { recursive: true, force: true })
  })

  it('prune：超过 HISTORY_LIMIT 删最旧，保留最新 N 版', () => {
    const root = tmpRoot()
    const rel = '正文/第01章.md'
    const names: string[] = []
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      names.push(writeSnapshot(root, rel, `v${i}`, new Date(2026, 8, 10, 1, 0, 0, i).getTime())!)
    }
    const list = listSnapshots(root, rel)
    expect(list.length).toBe(HISTORY_LIMIT)
    // 超限 5 版写完后：最新保留的应是最后写入那一版；最旧的 v0..v4 必须被删
    expect(list[0].name).toBe(names.at(-1))
    for (const v of names.slice(0, 5)) {
      expect(readSnapshot(root, rel, v)).toBe(null)
    }
    // prune 幂等
    prune(root, rel)
    expect(listSnapshots(root, rel).length).toBe(HISTORY_LIMIT)
    rmSync(root, { recursive: true, force: true })
  })

  it('writeSnapshot 自动裁剪（超限即删）', () => {
    const root = tmpRoot()
    const rel = '正文/第01章.md'
    for (let i = 0; i < HISTORY_LIMIT + 2; i++) {
      writeSnapshot(root, rel, `v${i}`, new Date(2026, 8, 10, 2, 0, 0, i).getTime())
    }
    expect(listSnapshots(root, rel).length).toBe(HISTORY_LIMIT)
    expect(readdirSync(join(root, snapDirFor(rel))).length).toBe(HISTORY_LIMIT)
    rmSync(root, { recursive: true, force: true })
  })

  it('空目录：listSnapshots 返回 []', () => {
    const root = tmpRoot()
    mkdirSync(join(root, snapDirFor('正文/第01章.md')), { recursive: true })
    expect(listSnapshots(root, '正文/第01章.md')).toEqual([])
    rmSync(root, { recursive: true, force: true })
  })
})
