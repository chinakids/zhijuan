// 织卷 · 复读检测核查（repeat）接线数据层冒烟——runAudit 真读盘
// 断言：① 真实项目「织卷smoke」ok:true 且条目结构合法（type=repeat / what 含文本 / suggest 非空 / where）；
//       ② 构造项目（完全重复句×2 + 完全重复段×2 + 同形句首×2）命中 3 类（sentence/paragraph/sentence-start）；
//       ③ 构造项目（零命中文本）返回空 items；
//       ④ 与主进程同口径：本地规则不落盘（不产生 大纲/审读_复读检测核查.md）。
// 用法：cd ~/Desktop/织卷 && node scripts/repeat-audit-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-repeat'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({})
const out = '/tmp/repeat-audit-bundle.mjs'

await esbuild({
  stdin: {
    contents: `export { runAudit } from ${JSON.stringify(resolve(root, 'src/main/agent/audit.ts'))};`,
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

const { runAudit } = await import(pathToFileURL(out).href)
let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

console.log('=== ① 真实项目「织卷smoke」===')
const r1 = await runAudit('织卷smoke', 'repeat')
assert('ok:true', r1.ok === true)
if (r1.ok) {
  assert(
    'items 为数组且结构合法',
    Array.isArray(r1.result.items) &&
      r1.result.items.every((it) => it.type === 'repeat' && typeof it.what === 'string' && typeof it.suggest === 'string' && it.where)
  )
  console.log('  命中条目数:', r1.result.items.length)
  for (const it of r1.result.items.slice(0, 3)) console.log('   -', it.severity, it.what, '|', it.where)
  assert(
    '档案不落盘（本地规则不写 大纲/审读_复读检测核查.md）',
    !existsSync(join(process.env.HOME, 'Documents/织卷项目库/织卷smoke/大纲/审读_复读检测核查.md'))
  )
} else {
  throw new Error('runAudit repeat 失败: ' + r1.error)
}

console.log('=== ② 构造项目（重复句/段 + 同形句首命中）===')
const lib = join(process.env.HOME, 'Documents/织卷项目库')
const pid = 'zj-repeat-smoke'
const dir = join(lib, pid)
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, '正文'), { recursive: true })
const dupLine = '她沿着长堤往北走，风吹得裙摆猎猎作响，天边的云压得很低。'
writeFileSync(
  join(dir, '正文/第01章_长堤.md'),
  '---\n章号: 1\n题名: 长堤\n切片: 初秋\n涉及人物: 无\n---\n\n' +
    dupLine + '\n' + dupLine + '\n' +
    '雨点打在青石板上，溅起细碎的水花。\n' +
    '雨点打在屋檐上，顺着瓦楞往下淌。\n' +
    '他停下来，望着远处的海面出神。\n'
)
const r2 = await runAudit(pid, 'repeat')
assert('构造项目 ok:true', r2.ok === true)
if (r2.ok) {
  const kinds = new Set(r2.result.items.map((it) => it.what.includes('本章重复出现') ? (it.what.includes('整段') ? 'paragraph' : 'sentence') : 'sentence-start'))
  assert('完全重复句命中（同文句子原样再现 ×2）', r2.result.items.some((it) => it.what.includes('她沿着长堤往北走') && it.what.includes('重复出现 2 次') && it.what.includes('同文句子原样再现')))
  assert('完全重复段命中（整段 ×2）', r2.result.items.some((it) => /整段在本章重复出现 2 次/.test(it.what)))
  assert('同形句首命中（「雨点打在…」×2）', r2.result.items.some((it) => it.what.includes('「雨点打在青石板上」同形开头') && it.what.includes('2 句')))
  assert('三类 severity 合法', r2.result.items.every((it) => ['high', 'medium', 'low'].includes(it.severity)))
  console.log('  命中条目:', r2.result.items.length, '（sentence-start 引号内）')
  for (const it of r2.result.items) console.log('   -', it.severity, '|', it.what)
} else {
  throw new Error('构造项目 repeat 失败: ' + r2.error)
}

console.log('=== ③ 构造项目（零命中）===')
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, '正文'), { recursive: true })
writeFileSync(
  join(dir, '正文/第01章_空白.md'),
  '---\n章号: 1\n题名: 空白\n切片: 初秋\n涉及人物: 无\n---\n\n她在港口等他。夜色漫上来。远处有船鸣笛。\n'
)
const r3 = await runAudit(pid, 'repeat')
assert('零命中项目 ok:true 且 items 空', r3.ok === true && r3.result.items.length === 0)

rmSync(dir, { recursive: true, force: true })
console.log(`\n=== 结果: ${pass} 断言全过 ===`)
process.exit(0)
