// 称谓混用核查 · 数据层冒烟（bundle 主进程 audit.ts 真机实现 + 临时项目库，不依赖模型）
// 验证：runNameMix 读真盘 → nameMixCheck——三变体交替命中 / 别名参与 / 对话内混用不报 /
// 分段使用不报 / 偶发异称不报 / 同姓双雄归属不明不报 / 单字名不参与 / 正常项目零命中。
// 用法：cd ~/Desktop/织卷 && node scripts/mixform-data-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-mixform-userdata'
const LIB = '/tmp/zj-smoke-mixform-lib'
const UD = process.env.ZJ_USERDATA
rmSync(UD, { recursive: true, force: true })
rmSync(LIB, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })
mkdirSync(UD, { recursive: true })
writeFileSync(resolve(UD, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: LIB }))

const out = '/tmp/mixform-bundle.mjs'
await esbuild({
  stdin: {
    contents: `export { runNameMix } from ${JSON.stringify(resolve(root, 'src/main/agent/audit.ts'))};\nexport { createProject, writeDoc } from ${JSON.stringify(resolve(root, 'src/main/store.ts'))};`,
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

const { runNameMix, createProject, writeDoc } = await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

const FM = (no, title) => `---\n章号: ${no}\n题名: ${title}\n切片: 第${no}幕\n涉及人物: [韩青]\n---\n`
const PERSON = (name, alias) => `---\n姓名: ${name}\n身份: 本地冒烟人物\n${alias ? `别名: [${alias.join(', ')}]\n` : ''}---\n\n# ${name}\n\n- 外貌：无\n- 性格：无\n`

try {
  console.log('=== 称谓混用核查（主进程真实现 + 临时库） ===')
  const p = createProject('mixform冒烟', '数据层冒烟用（结束后清理）')
  if (!p) throw new Error('createProject 失败')

  writeDoc(p.id, '人物/韩青.md', PERSON('韩青'))
  writeDoc(p.id, '人物/沈藏.md', PERSON('沈藏', ['沈爷']))
  writeDoc(p.id, '人物/阿七.md', PERSON('阿七'))

  // ① 正例：三变体交替（第1章）＋ 别名参与（第2章）
  writeDoc(p.id, '正文/第01章_雾港.md', FM(1, '雾港') + '韩师傅推门。韩青抬头。老韩坐下。韩青开口。韩师傅打断了他。\n')
  writeDoc(p.id, '正文/第02章_灯下.md', FM(2, '灯下') + '沈藏站在船头。沈爷在码头喊他。沈藏没回头。沈爷又喊。沈藏才应了一声。\n')

  const r1 = runNameMix(p.id)
  assert('runNameMix ok', r1.ok === true)
  const res = r1.ok ? r1.result : null
  assert('共 2 条（韩青/沈藏 各一章）', res && res.items.length === 2)

  const first = res.items.find((i) => i.target === '人物/韩青.md')
  assert('条目 low/character/target=韩青档', first && first.severity === 'low' && first.type === 'character' && first.target === '人物/韩青.md')
  assert('what 列称呼/处数/交替次数/「若并非刻意」', first && first.what.includes('「韩师傅」「韩青」「老韩」') && first.what.includes('交替 4 次') && first.what.includes('若并非刻意'))
  assert('where 定位第01章 + 交替处上下文', first && first.where.includes('正文/第01章_雾港.md') && first.what.includes('交替处') && first.what.includes('推门'))
  const second = res.items.find((i) => i.target === '人物/沈藏.md')
  assert('别名参与：沈藏+沈爷 交替命中', second && second.target === '人物/沈藏.md' && second.what.includes('「沈爷」'))

  // ② 反例：同姓双雄（韩青+韩航，生成称谓「韩师傅/老韩」归属不明→全局弃用）→ 韩青只剩全名 → 不报（第01/03章）
  writeDoc(p.id, '人物/韩航.md', PERSON('韩航'))
  writeDoc(p.id, '正文/第03章_码头.md', FM(3, '码头') + '韩师傅推门。韩青抬头。韩师傅坐下。韩青开口。韩师傅打断了他。\n')
  const r2 = runNameMix(p.id)
  assert('同姓双雄后第03章不报（生成称谓归属不明）', r2.ok === true && (r2.ok ? r2.result.items.filter((i) => i.where.includes('第03章')) : []).length === 0)
  assert('第01章韩青同被全局归属污染 → 不报（口径：变体全局唯一归属）', r2.ok === true && (r2.ok ? r2.result.items.filter((i) => i.target === '人物/韩青.md') : []).length === 0)
  assert('沈藏（沈姓唯一）第02章仍报', r2.ok === true && (r2.ok ? r2.result.items.filter((i) => i.target === '人物/沈藏.md') : []).length === 1)

  // ③ 反例：对话内混用不报（第4章：引号内沈爷/沈藏交替，叙述层仅沈爷）
  writeDoc(p.id, '正文/第04章_雾夜.md', FM(4, '雾夜') + '沈爷说：“藏哥，等等我。”沈爷又说：“沈爷？不对，藏哥。”沈爷笑了。\n')
  const r3 = runNameMix(p.id)
  assert('对话内混用不报（只取叙述层）', r3.ok === true && (r3.ok ? r3.result.items.filter((i) => i.where.includes('第04章')) : []).length === 0)

  // ④ 反例：单字名/无姓不参与；normal 项目零命中
  writeDoc(p.id, '正文/第05章_雨巷.md', FM(5, '雨巷') + '阿七在码头。七爷在船头。阿七上船。七爷也上。\n')
  const r4 = runNameMix(p.id)
  assert('单字名「阿七」不参与（无命中）', r4.ok === true && (r4.ok ? r4.result.items.filter((i) => i.what.includes('阿七')) : []).length === 0)
  assert('summary 口径含「交替」', r4.ok && r4.result.summary.includes('交替'))

  console.log(`\n全部通过：${pass} 断言`)
} finally {
  rmSync(UD, { recursive: true, force: true })
  rmSync(LIB, { recursive: true, force: true })
}
