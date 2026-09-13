// 档案切片核查 · 数据层冒烟（bundle 主进程 audit.ts 真机实现 + 临时项目库，不依赖模型）
// 验证：runSliceOrder 读真盘 → sliceSectionOrderCheck——倒挂小节命中 / 重复小节命中 /
// 全集不存在残留命中 / 正常项目零命中。
// 用法：cd ~/Desktop/织卷 && node scripts/sliceord-data-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-sliceord-userdata'
const LIB = '/tmp/zj-smoke-sliceord-lib'
const UD = process.env.ZJ_USERDATA
rmSync(UD, { recursive: true, force: true })
rmSync(LIB, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })
mkdirSync(UD, { recursive: true })
writeFileSync(resolve(UD, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: LIB }))

const out = '/tmp/sliceord-bundle.mjs'
await esbuild({
  stdin: {
    contents: `export { runSliceOrder } from ${JSON.stringify(resolve(root, 'src/main/agent/audit.ts'))};
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

const { runSliceOrder, createProject, writeDoc } = await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

const FM = (no, title, slice) => `---\n章号: ${no}\n题名: ${title}\n切片: ${slice}\n---\n`
const PERSON = (name, secs) =>
  `# ${name}\n\n## 基础设定（不变项）\n\n- 姓名：${name}\n\n` + secs.map((s) => `## 切片：${s}\n\n（本例的状态内容。）\n`).join('\n')

try {
  console.log('=== 档案切片核查（主进程真实现 + 临时库） ===')
  const p = createProject('sliceord冒烟', '数据层冒烟用（结束后清理）')
  if (!p) throw new Error('createProject 失败')

  // 章节： 第01章（切片 第一夜）、第02章（切片 第二夜）——正常顺序应为 第一夜 → 第二夜
  writeDoc(p.id, '正文/第01章_雾港.md', FM(1, '雾港', '第一夜') + '正文。\n')
  writeDoc(p.id, '正文/第02章_灯下.md', FM(2, '灯下', '第二夜') + '正文。\n')

  // ① 倒挂：沈确档小节顺序 第二夜 → 第一夜（章序 2 排 1 前）
  writeDoc(p.id, '人物/沈确.md', PERSON('沈确', ['第二夜', '第一夜']))
  // ② 重复：林西档「第一夜」出现两次
  writeDoc(p.id, '人物/林西.md', PERSON('林西', ['第一夜', '第一夜']))
  // ③ 残留：顾岸档「旧切片_改名」不在全集
  writeDoc(p.id, '人物/顾岸.md', PERSON('顾岸', ['旧切片_改名']))
  // ④ 正常：苏晴档 第一夜 → 第二夜（与章序一致）
  writeDoc(p.id, '人物/苏晴.md', PERSON('苏晴', ['第一夜', '第二夜']))

  const r1 = runSliceOrder(p.id)
  assert('runSliceOrder ok', r1.ok === true)
  const res = r1.ok ? r1.result : null
  assert('共 3 条需复核（倒挂/重复/残留各 1）', res && res.items.length === 3)

  const byWhat = (s) => (res?.items.filter((i) => i.what.includes(s)) ?? [])
  const itRev = byWhat('顺序与故事时间相反')[0]
  assert('倒挂条目存在（medium/timeline）', itRev && itRev.severity === 'medium' && itRev.type === 'timeline')
  assert('倒挂条目 where 指向沈确档', itRev && itRev.where.includes('人物/沈确.md'))
  assert('倒挂条目描述两节先后（第二夜 排 在第一夜 之前）', itRev && itRev.what.includes('第二夜') && itRev.what.includes('第一夜'))
  assert('倒挂 suggest 给出重排建议', itRev && itRev.suggest.includes('重排'))

  const itDup = byWhat('出现 2 次')[0]
  assert('重复条目存在（medium/structure）', itDup && itDup.severity === 'medium' && itDup.type === 'structure')
  assert('重复条目 where 指向林西档', itDup && itDup.where.includes('人物/林西.md'))

  const itRes = byWhat('已脱离故事时间线')[0]
  assert('残留条目存在（low/setting）', itRes && itRes.severity === 'low' && itRes.type === 'setting')
  assert('残留条目 where 指向顾岸档', itRes && itRes.where.includes('人物/顾岸.md'))

  assert('summary 报 3 条需复核', res && res.summary.includes('3 条需复核'))
  assert('summary 报 4 个档案均含小节', res && res.summary.includes('4 个人物档案（4 个含切片小节）'))

  // ⑤ 正常项目：删除倒挂/重复/残留档，只留苏晴档 → 零命中
  runSliceOrder(p.id)
  const fs = await import('node:fs')
  for (const f of ['人物/沈确.md', '人物/林西.md', '人物/顾岸.md']) fs.rmSync(resolve(LIB, p.id, f), { force: true })
  const r2 = runSliceOrder(p.id)
  assert('整理后零命中', r2.ok === true && r2.result.items.length === 0)
  assert('零命中 summary 无需复核', r2.ok && r2.result.summary.includes('0 条需复核'))

  console.log(`\n全部通过：${pass} 断言`)
} finally {
  rmSync(UD, { recursive: true, force: true })
  rmSync(LIB, { recursive: true, force: true })
}
