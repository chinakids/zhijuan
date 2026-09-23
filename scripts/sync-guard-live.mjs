// 织卷 · 守卫真模型走查（候选 2e 验收）：临时项目 + 真 runSync
// 场景：正文「涉及人物: [林晓, 韩青, 沈藏]」但 人物/ 只建了 林晓/韩青 两份档案（沈藏故意未建档）
// ——真模型 runSync：正常产物命中既有档案；若模型仍写 人物/沈藏.md（或近名），
// guard 防线必须拦下（near-name 纠正 / 未建档 dropped），任何 items 都不得指向不存在的档案。
// 用法：cd ~/Desktop/织卷 && node scripts/sync-guard-live.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdirSync, rmSync, readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-guard-live-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')
mkdirSync(join(tmp, 'lib'), { recursive: true })

const pid = '守卫真链'
const mk = (p, s) => {
  const dir = join(tmp, 'lib', pid, p.split('/').slice(0, -1).join('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(tmp, 'lib', pid, p), s, 'utf-8')
}
mk(
  '人物/林晓.md',
  ['# 林晓', '', '> 定位：等船的女孩', '', '## 基础档案', '', '- 年龄：19', '- 身份：渔村遗孤', '', '## 切片：第一幕_雾港之夜', '', '- 站在栈桥，等十年未归的船'].join('\n'),
)
mk(
  '人物/韩青.md',
  ['# 韩青', '', '> 定位：缉私队新人', '', '## 基础档案', '', '- 年龄：24', '- 职业：缉私队队员', '', '## 切片：第一幕_雾港之夜', '', '- 在栈桥遇见林晓'].join('\n')
)
mk(
  '正文/第01章_雾港.md',
  ['---', '章号: 1', '题名: 雾港', '切片: 第一幕_雾港之夜', '涉及人物: [林晓, 韩青, 沈藏]', '---', '', '# 雾港', '', '雾港的夜把整条街浸在灰里。林晓停在栈桥尽头的灯柱下，韩青把外套披到她肩上。沈藏在街角的屋檐下远远看着，没敢上前。'].join('\n')
)

const out = join(tmp, 'bundle.mjs')
await esbuild({
  entryPoints: [resolve(root, 'src/main/agent/engine.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  external: ['node:*'],
  logLevel: 'warning'
})
const mod = await import(pathToFileURL(out).href)

console.log('=== 守卫真模型走查开始:', new Date().toISOString())
try {
  const r = await mod.runSync(pid, '正文/第01章_雾港.md')
  console.log('=== 结果:', JSON.stringify(r, null, 2).slice(0, 2200))
  let fails = 0
  const check = (name, cond) => {
    console.log((cond ? '[PASS] ' : '[FAIL] ') + name)
    if (!cond) fails++
  }
  check('同步成功 (ok=true)', r.ok === true)
  if (r.ok) {
    const files = readdirSync(join(tmp, 'lib', pid, '人物')).map((f) => f.replace(/\.md$/, ''))
    const valid = r.items.every((it) => !it.target.startsWith('人物/') || files.includes(it.target.slice('人物/'.length).replace(/\.md$/, '')))
    check('所有人物 target 都指向真实档案（防线生效）', valid)
    const issues = r.guard?.issues ?? []
    check('issues 均有 action 与 reason', issues.every((i) => i.action && i.reason))
    check('涉及未建档「沈藏」未被越权写成新档案', !files.includes('沈藏'))
    // 真模型可能生成 沈藏 补丁被 guard 拦截（边车提示词+代码双防线）；若模型没写沈藏也接受
    const droppedShen = issues.find((i) => i.target.includes('沈藏'))
    console.log((droppedShen ? '[INFO] 守卫拦截：' + droppedShen.reason : '[INFO] 模型未写沈藏（提示词清单生效）'))
  }
  console.log(fails === 0 ? 'SYNC-GUARD LIVE OK' : 'SYNC-GUARD LIVE FAILED: ' + fails)
  process.exit(fails === 0 ? 0 : 1)
} finally {
  await mod.shutdown().catch(() => {})
  rmSync(tmp, { recursive: true, force: true })
}
