// 正文缺段核查 · 数据层冒烟（bundle 主进程 audit.ts 真机实现 + 临时项目库，不依赖模型）
// 验证：runActGaps 读真盘 → actGapsCheck（含占位注释的章节命中 / 无占位零命中）。
// 用法：cd ~/Desktop/织卷 && node scripts/actgaps-data-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = '/tmp/zj-smoke-actgaps-userdata'
const LIB = '/tmp/zj-smoke-actgaps-lib'
const UD = process.env.ZJ_USERDATA
rmSync(UD, { recursive: true, force: true })
rmSync(LIB, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })
// 显式设置库根 → 冒烟写 临时库，不碰真实项目库（D-V2-8 决策链的真实用法）
mkdirSync(UD, { recursive: true })
writeProbeSettings({ libraryRoot: LIB }, UD)

const out = '/tmp/actgaps-bundle.mjs'
await esbuild({
  stdin: {
    contents: `export { runActGaps } from ${JSON.stringify(resolve(root, 'src/main/agent/audit.ts'))};
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

const { runActGaps, createProject, writeDoc } = await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

try {
  console.log('=== 正文缺段核查（主进程真实现 + 临时库） ===')
  const p = createProject('actgaps冒烟', '数据层冒烟用（结束后清理）')
  if (!p) throw new Error('createProject 失败')
  const PLACEHOLDER = '<!-- 分幕草稿缺第 2 段：此处情节未写成，待补齐 -->'

  writeDoc(p.id, '正文/第01章_雾港.md', `---\n章号: 1\n题名: 雾港\n切片: 第一幕_夜\n---\n她推开门。\n\n${PLACEHOLDER}\n\n雨声落在屋檐。\n`)
  writeDoc(p.id, '正文/第02章_灯下.md', `---\n章号: 2\n题名: 灯下\n切片: 第一幕_夜\n---\n完整的一章，没有占位注释。\n`)

  const r1 = runActGaps(p.id)
  assert('runActGaps ok', r1.ok === true)
  const res = r1.ok ? r1.result : null
  assert('命中 1 章：2 章中 1 章有占位', res && res.items.length === 1)
  const it = res.items[0]
  assert('条目 type=structure / severity=medium', it.type === 'structure' && it.severity === 'medium')
  assert('where 含章节文件路径', it.where.includes('正文/第01章_雾港.md'))
  assert('what 报缺第 2 段', it.what.includes('缺第 2 段'))
  assert('what 报共 1 处', it.what.includes('1 处'))
  assert('suggest 提示补写缺段', it.suggest.includes('补写缺段'))
  assert('summary 提及残留章数', res.summary.includes('1 章正文残留'))

  // 清理占位注释后重扫 → 零命中（模拟作者补齐）
  writeDoc(p.id, '正文/第01章_雾港.md', `---\n章号: 1\n题名: 雾港\n切片: 第一幕_夜\n---\n她推开门，雨声落在屋檐。\n`)
  const r2 = runActGaps(p.id)
  assert('补齐后重扫零命中', r2.ok === true && r2.result.items.length === 0)
  assert('零命中 summary 无残留', r2.ok && r2.result.summary.includes('均无分幕缺段占位注释'))

  console.log(`\n全部通过：${pass} 断言`)
} finally {
  rmSync(UD, { recursive: true, force: true })
  rmSync(LIB, { recursive: true, force: true })
}
