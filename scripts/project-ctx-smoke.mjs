// 项目级上下文（buildProjectContext）· 数据层冒烟（真读盘，不依赖模型）
// 验证：未打开章节时 runChat 注入的项目概览块能真实读出 project.md / 世界观总纲 / 目录清单。
// 用法：cd ~/Desktop/织卷 && node scripts/project-ctx-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 坑（2026-09-11）：冒烟环境 userData 若有残留 zhijuan-settings.json（libraryRoot 指向已删除目录）
// 会让 libraryRoot() 定位到空路径 → readDoc 全 null。显式用干净 userData。
process.env.ZJ_USERDATA = '/tmp/zj-smoke-projectctx'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/project-ctx-bundle.mjs'

await esbuild({
  stdin: {
    contents: `export { buildProjectContext } from ${JSON.stringify(resolve(root, 'src/main/agent/context.ts'))};`,
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

const { buildProjectContext } = await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

console.log('=== 项目级上下文装配（真读盘）===')

// 真实项目（只读，不写任何文件）
const pid = '织卷smoke'
const ctx = await buildProjectContext(pid)
const text = ctx.blocks.join('\n\n')
console.log('块数:', ctx.blocks.length, '| 来源:', ctx.sources.join(', '))

assert('装配出块', ctx.blocks.length >= 2)
assert('含作品总纲块（project.md）', ctx.sources.includes('project.md') && text.includes('【作品总纲】'))
assert('project.md 内容真实注入', text.includes('织卷smoke') && text.includes('测试用'))
assert('含世界观总纲块', ctx.sources.includes('世界观/总纲.md') && text.includes('【世界观总纲】'))
assert('世界观总纲内容真实注入', text.includes('雾港') && text.includes('回南天'))
assert('含文档清单块（路标）', text.includes('【文档清单】') && text.includes('正文/：'))
assert('文档清单列了真实文件名', text.includes('林晓') && text.includes('陈默'))
assert('人物目录篇数正确（2 篇）', /人物\/：2 篇/.test(text))
assert('素材库子目录被纳入递归（有篇数行）', /素材库\/：\d+ 篇/.test(text))

// 不存在项目 → 不应抛错，只可能剩文档清单路标（全 0 篇），不阻断创作
const missing = await buildProjectContext('不存在的项目xyz')
const missingText = missing.blocks.join('\n')
assert('项目不存在不抛错、作品总纲与世界总纲缺席', !missingText.includes('【作品总纲】') && !missingText.includes('【世界观总纲】'))
assert('项目不存在时清单全 0 篇', /正文\/：0 篇/.test(missingText))

console.log(`\n=== 结果: ${pass} 断言全过 ===`)
process.exit(0)
