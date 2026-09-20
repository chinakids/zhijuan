// 织卷 · 用词重复核查（overuse）接线数据层冒烟——runOveruse 真读盘
// 断言：① 真实项目「织卷smoke」ok:true 且条目结构合法（type=overuse / what 含频次 / suggest 非空）；
//       ② 构造项目（含「一下」×25 的章节）命中 1 条 + 自定义词表（settings.overuseDict）命中「生死之交」；
//       ③ 构造项目（零命中文本）返回空 items；
//       ④ 与主进程同口径：本地规则不落盘（不产生 大纲/审读_用词重复核查.md）。
// 用法：cd ~/Desktop/织卷 && node scripts/wordfreq-audit-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-wordfreq'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
// 2026-09-21：自定义词表数据链——settings.overuseDict 与内置合并（readSettings 在模块加载时读取，须先写盘）
writeFileSync(
  join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'),
  JSON.stringify({ overuseDict: ['生死之交', '  ', '生死之交'] }),
  'utf-8'
)
const out = '/tmp/wordfreq-audit-bundle.mjs'

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
const r1 = await runAudit('织卷smoke', 'overuse')
assert('ok:true', r1.ok === true)
if (r1.ok) {
  assert('items 为数组且结构合法', Array.isArray(r1.result.items) && r1.result.items.every((it) => it.type === 'overuse' && typeof it.what === 'string' && typeof it.suggest === 'string' && it.where))
  console.log('  命中条目数:', r1.result.items.length)
  for (const it of r1.result.items.slice(0, 3)) console.log('   -', it.severity, it.what, '|', it.where)
  assert('档案不落盘（本地规则不写 大纲/审读_用词重复核查.md）', !existsSync(join(process.env.HOME, 'Documents/织卷项目库/织卷smoke/大纲/审读_用词重复核查.md')))
} else {
  throw new Error('runAudit overuse 失败: ' + r1.error)
}

console.log('=== ② 构造项目（口头禅命中 + 自定义词表命中）===')
const lib = join(process.env.HOME, 'Documents/织卷项目库')
const pid = 'zj-wordfreq-smoke'
const dir = join(lib, pid)
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, '正文'), { recursive: true })
const body20 = '她笑了一下，又笑了一下，最后小声呢喃了一句，转身慢慢走开。'.repeat(2) // 含「一下」×4
writeFileSync(
  join(dir, '正文/第01章_试写.md'),
  '---\n章号: 1\n题名: 试写\n切片: 初秋\n涉及人物: 无\n---\n\n' + body20 + '她轻轻「一下」也没用，' + '他愣了一下。'.repeat(20) + '生死之交，生死之交，生死之交，生死之交，生死之交。\n'
)
const r2 = await runAudit(pid, 'overuse')
assert('构造项目 ok:true', r2.ok === true)
if (r2.ok) {
  const hit = r2.result.items.find((it) => it.what.includes('「一下」'))
  assert('命中「一下」条目且含频次', !!hit && /全卷出现 \d+ 次/.test(hit.what))
  assert('命中条目 severity 合法', hit && ['high', 'medium', 'low'].includes(hit.severity))
  console.log('  what=' + hit.what)
  const custom = r2.result.items.find((it) => it.what.includes('「生死之交」'))
  assert('自定义词表（settings.overuseDict）命中「生死之交」×5', !!custom && custom.what.includes('5 次'))
  console.log('  what=' + custom.what)
  assert('自定义词表空串/空白条目不出现（normalizeOveruseDict 已清洗）', !r2.result.items.some((it) => it.what.includes('「 」')))
} else {
  throw new Error('构造项目 overuse 失败: ' + r2.error)
}

console.log('=== ③ 构造项目（零命中）===')
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, '正文'), { recursive: true })
writeFileSync(
  join(dir, '正文/第01章_空白.md'),
  '---\n章号: 1\n题名: 空白\n切片: 初秋\n涉及人物: 无\n---\n\n她在港口等他。夜色漫上来。\n'
)
const r3 = await runAudit(pid, 'overuse')
assert('零命中项目 ok:true 且 items 空', r3.ok === true && r3.result.items.length === 0)

rmSync(dir, { recursive: true, force: true })
console.log(`\n=== 结果: ${pass} 断言全过 ===`)
process.exit(0)
