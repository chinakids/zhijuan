// 称谓发现核查 · 数据层冒烟（bundle 主进程 audit.ts 真机实现 + 临时项目库，不依赖模型）
// 验证：runNameForms 读真盘 → nameFormCheck——未登记称谓命中（姓+后缀 / 老小阿大+姓）/
// 已登记别名不报 / 别名冲突不报 / 同姓双雄归属重叠不报 / 每（人物×变体）只报一次 / 正常项目零命中。
// 用法：cd ~/Desktop/织卷 && node scripts/nameform-data-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-nameform-userdata'
const LIB = '/tmp/zj-smoke-nameform-lib'
const UD = process.env.ZJ_USERDATA
rmSync(UD, { recursive: true, force: true })
rmSync(LIB, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })
mkdirSync(UD, { recursive: true })
writeProbeSettings({ libraryRoot: LIB }, UD)

const out = '/tmp/nameform-bundle.mjs'
await esbuild({
  stdin: {
    contents: `export { runNameForms } from ${JSON.stringify(resolve(root, 'src/main/agent/audit.ts'))};\nexport { createProject, writeDoc } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};`,
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

const { runNameForms, createProject, writeDoc } = await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

const FM = (no, title) => `---\n章号: ${no}\n题名: ${title}\n切片: 第${no}幕\n涉及人物: [陈默, 沈藏, 林西]\n---\n`
const PERSON = (name, alias) => `---\n姓名: ${name}\n身份: 本地冒烟人物\n${alias ? `别名: [${alias.join(', ')}]\n` : ''}---\n\n# ${name}\n\n- 外貌：无\n- 性格：无\n`

try {
  console.log('=== 称谓发现核查（主进程真实现 + 临时库） ===')
  const p = createProject('nameform冒烟', '数据层冒烟用（结束后清理）')
  if (!p) throw new Error('createProject 失败')

  writeDoc(p.id, '人物/陈默.md', PERSON('陈默'))
  writeDoc(p.id, '人物/沈藏.md', PERSON('沈藏', ['沈爷']))
  writeDoc(p.id, '人物/林西.md', PERSON('林西'))

  // ① 基础命中：陈师傅（姓+后缀）与林老师（另一人物）——第1章两条
  writeDoc(p.id, '正文/第01章_雾港.md', FM(1, '雾港') + '陈师傅从门里探出半个头。沈爷远远站着，帽檐压得很低。林老师在码头上撑伞。\n')
  // ② 前缀命中：老陈（同一人物另一变体）；「沈师傅」已登记？——沈藏别名只有沈爷，正文无沈师傅
  writeDoc(p.id, '正文/第02章_灯下.md', FM(2, '灯下') + '老陈又来了。\n')

  const r1 = runNameForms(p.id)
  assert('runNameForms ok', r1.ok === true)
  const res = r1.ok ? r1.result : null
  assert('共 3 条（陈师傅/林老师/老陈）', res && res.items.length === 3)

  const byWhat = (s) => (res?.items.filter((i) => i.what.includes(s)) ?? [])
  const itChen = byWhat('「陈师傅」')[0]
  assert('陈师傅条目（low/character/target=陈默档）', itChen && itChen.severity === 'low' && itChen.type === 'character' && itChen.target === '人物/陈默.md')
  assert('陈师傅条目 where 定位到第01章', itChen && itChen.where.includes('正文/第01章_雾港.md'))
  assert('陈师傅条目 what 带首次出现上下文', itChen && itChen.what.includes('首次出现处') && itChen.what.includes('探出半个头'))
  assert('陈师傅 suggest 给出登记别名路径', itChen && itChen.suggest.includes('别名:') && itChen.suggest.includes('人物/陈默.md'))

  const itLin = byWhat('「林老师」')[0]
  assert('林老师条目 target=林西档', itLin && itLin.target === '人物/林西.md')

  const itLao = byWhat('「老陈」')[0]
  assert('老陈条目（前缀模式）where 定位到第02章', itLao && itLao.where.includes('正文/第02章_灯下.md'))

  // ③ 已登记别名「沈爷」不报（正文有沈爷、沈藏登记过）
  const itShen = byWhat('「沈爷」')[0]
  assert('已登记别名不报（沈爷 无条目）', itShen === undefined)
  assert('summary 报 3 个疑似称谓', res && res.summary.includes('3 个'))

  // ④ 同姓双雄（陈默+陈航 都未登记「陈师傅」）→ 归属重叠不报
  writeDoc(p.id, '人物/陈航.md', PERSON('陈航'))
  const r2 = runNameForms(p.id)
  assert('同姓双雄后归属重叠去除（不再报陈师傅）', r2.ok === true && (r2.ok ? r2.result.items.filter((i) => i.what.includes('「陈师傅」')) : []).length === 0)
  assert('老陈 因陈航同姓也归属重叠 → 不报', r2.ok === true && (r2.ok ? r2.result.items.filter((i) => i.what.includes('「老陈」')) : []).length === 0)
  // 林老师仍唯一归属 → 仍报
  assert('林老师 仍报（唯一归属）', r2.ok === true && (r2.ok ? r2.result.items.filter((i) => i.what.includes('「林老师」')) : []).length === 1)

  // ⑤ 别名冲突：陈默/陈航 都登记「陈师傅」→ 冲突也不报（与 presence 同规则）
  writeDoc(p.id, '人物/陈默.md', PERSON('陈默', ['陈师傅']))
  writeDoc(p.id, '人物/陈航.md', PERSON('陈航', ['陈师傅']))
  const r3 = runNameForms(p.id)
  assert('别名冲突不报（陈师傅 两条都登记冲突）', r3.ok === true && (r3.ok ? r3.result.items.filter((i) => i.what.includes('陈师傅')) : []).length === 0)

  // ⑥ 正常项目零命中：人物别名补全 / 正文无称谓模式
  const fs = await import('node:fs')
  for (const f of ['人物/陈默.md', '人物/陈航.md']) fs.rmSync(resolve(LIB, p.id, f), { force: true })
  writeDoc(p.id, '人物/陈默.md', PERSON('陈默', ['陈师傅', '老陈']))
  writeDoc(p.id, '人物/林西.md', PERSON('林西', ['林老师']))
  const r4 = runNameForms(p.id)
  assert('补全登记后零命中', r4.ok === true && r4.result.items.length === 0)
  assert('零命中 summary 未发现口径', r4.ok && r4.result.summary.includes('未发现'))

  console.log(`\n全部通过：${pass} 断言`)
} finally {
  rmSync(UD, { recursive: true, force: true })
  rmSync(LIB, { recursive: true, force: true })
}
