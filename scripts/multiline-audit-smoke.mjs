// 多时间线审计 · 数据层冒烟（bundle 主进程 audit.ts 真机实现 + 临时项目库，不依赖模型）
// 验证：runChapterOrder / runSliceOrder 在「两线交错」项目下线内判定——
//   ① 全局看会误报的跨线交错（切片序号 1,4,2,3）线内零命中；
//   ② 线内真倒流（主线 第五幕→第三幕）仍报；③ 跨线同名切片 → R7 提示且不算 R6；
//   ④ 人物档跨线同名小节的顺序比较被跳过（不误报）；线内倒挂仍报。
// 用法：cd ~/Desktop/织卷 && node scripts/multiline-audit-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-multiline-userdata'
const LIB = '/tmp/zj-smoke-multiline-lib'
const UD = process.env.ZJ_USERDATA
rmSync(UD, { recursive: true, force: true })
rmSync(LIB, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })
// 显式设置库根 → 冒烟写临时库，不碰真实项目库（D-V2-8 决策链的真实用法）
mkdirSync(UD, { recursive: true })
writeFileSync(resolve(UD, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: LIB }))

const out = '/tmp/multiline-bundle.mjs'
await esbuild({
  stdin: {
    contents: `export { runChapterOrder, runSliceOrder } from ${JSON.stringify(resolve(root, 'src/main/agent/audit.ts'))};
export { createProject, writeDoc } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};`,
    resolveDir: root,
    loader: 'ts'
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})

const { runChapterOrder, runSliceOrder, createProject, writeDoc } = await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

const chapterRaw = (no, title, slice, line) =>
  `---\n章号: ${no}\n题名: ${title}\n切片: ${slice}\n时间线: ${line}\n涉及人物: []\n---\n\n（第${no}章正文。）\n`

try {
  console.log('=== 多时间线审计（主进程真实现 + 临时库，两线交错） ===')
  const p = createProject('多线审计冒烟', '数据层冒烟用（结束后清理）')
  if (!p) throw new Error('createProject 失败')

  // 两线交错：章号序 1,4,2,3 全局看切片序号 1,4,2,3 会误报倒流（第02章 4 → 第03章 2）；线内各自升序
  writeDoc(p.id, '正文/第01章_主线开局.md', chapterRaw(1, '主线开局', '第一幕_夜', '主线'))
  writeDoc(p.id, '正文/第02章_主线转折.md', chapterRaw(2, '主线转折', '第四幕_灯火', '主线'))
  writeDoc(p.id, '正文/第03章_旧港往事.md', chapterRaw(3, '旧港往事', '第二幕_旧港', '过去线'))
  writeDoc(p.id, '正文/第04章_渔火.md', chapterRaw(4, '渔火', '第三幕_渔火', '过去线'))
  // 跨线同名切片：末幕_归途 主线第5章 + 过去线第6章（R7 提示；R6 各自单次不报）
  writeDoc(p.id, '正文/第05章_归途前夜.md', chapterRaw(5, '归途前夜', '末幕_归途', '主线'))
  writeDoc(p.id, '正文/第06章_旧年归途.md', chapterRaw(6, '旧年归途', '末幕_归途', '过去线'))
  // 线内真倒流：主线 第五幕(5) → 第三幕(3) → R5 命中
  writeDoc(p.id, '正文/第07章_灯塔.md', chapterRaw(7, '灯塔', '第五幕_灯塔', '主线'))
  writeDoc(p.id, '正文/第08章_雾中灯.md', chapterRaw(8, '雾中灯', '第三幕_雾', '主线'))

  const sec = (name, order) =>
    `# ${name}\n\n> 基础设定\n\n${order.map((s) => `## 切片：${s}\n\n${s} 的状态。`).join('\n\n')}\n`
  // 林西：主线内小节 8→7 降序（先写雾中灯后补灯塔？真实场景=补写后追加）→ 倒挂 1 条
  writeDoc(p.id, '人物/林西.md', sec('林西', ['第三幕_雾', '第五幕_灯塔']))
  // 阿七：末幕_归途 跨线同名 → 跳过比较；第三幕_渔火 no=4 单节 → 0 条
  writeDoc(p.id, '人物/阿七.md', sec('阿七', ['末幕_归途', '第三幕_渔火']))
  // 陈默：过去线内 4→3 降序 → 倒挂 1 条
  writeDoc(p.id, '人物/陈默.md', sec('陈默', ['第三幕_渔火', '第二幕_旧港']))

  console.log('--- runChapterOrder（切片时序核查） ---')
  const co = runChapterOrder(p.id)
  assert('runChapterOrder 返回 ok', co.ok === true)
  if (!co.ok) throw new Error(String(co.error ?? ''))
  const items = (co.result ?? []).items ?? []
  const flow = items.filter((i) => i.what && i.what.includes('倒流'))
  const cross = items.filter((i) => i.where && i.where.includes('条时间线'))
  const shared = items.filter((i) => i.where && i.where.includes('共用') && !i.where.includes('条时间线'))
  assert('跨线交错不误报：倒流仅 1 条（主线 第07→第08 真倒流）', flow.length === 1)
  if (flow.length === 1) {
    assert('倒流条目指向 灯塔→雾中灯', flow[0].where.includes('第07章_灯塔.md') && flow[0].where.includes('第08章_雾中灯.md'))
  }
  assert('跨线同名切片 → R7 刚好 1 条（末幕_归途 2 条时间线）', cross.length === 1)
  if (cross.length === 1) {
    assert('R7 列两条线', cross[0].where.includes('「主线」') && cross[0].where.includes('「过去线」') && cross[0].severity === 'low')
  }
  assert('跨线同名不算 R6：共用条目 0 条', shared.length === 0)
  const others = items.filter((i) => i.type === 'timeline').length
  assert('timeline 条目合计 = 倒流1 + 跨线1 = 2', others === 2)

  console.log('--- runSliceOrder（档案切片核查） ---')
  const so = runSliceOrder(p.id)
  assert('runSliceOrder 返回 ok', so.ok === true)
  if (!so.ok) throw new Error(String(so.error ?? ''))
  const sits = (so.result ?? []).items ?? []
  const sorder = sits.filter((i) => i.type === 'timeline')
  const sstruct = sits.filter((i) => i.type === 'structure')
  const ssetting = sits.filter((i) => i.type === 'setting')
  assert('倒挂条目 = 2（林西 主线 5→3、陈默 过去线 3→2）', sorder.length === 2)
  assert('跨线同名小节被跳过：与末幕_归途 相关的 timeline 条目 0', sorder.every((i) => !i.where.includes('阿七')))
  assert('阿七 档案零命中', !sits.some((i) => i.where === '人物/阿七.md'))
  assert('无重复/残留条目', sstruct.length === 0 && ssetting.length === 0)

  console.log(`\nPASS: ${pass} 断言全过（两线交错：线内不误报 / 真倒流命中 / 跨线 R7 / 人物档跳过跨线）`)
} catch (e) {
  console.error('FAIL:', e.message)
  if (process.env.DEBUG) {
    console.error('--- 现场输出（runChapterOrder/runSliceOrder 全量） ---')
    try {
      const p = createProject('多线审计冒烟', '数据层冒烟用（结束后清理）')
      if (p) {
        console.error(JSON.stringify(runChapterOrder(p.id), null, 1))
        console.error(JSON.stringify(runSliceOrder(p.id), null, 1))
      }
    } catch {}
  }
  process.exit(1)
}
