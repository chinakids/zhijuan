// 缺段占位「断链提示」· 数据层冒烟（真读盘，不依赖模型）
// 验证：buildWritingContext 对真实临时项目库——正文含缺段占位注释时识别并注入
// 断链提示行（第 2、5 段），注释本体不进上下文；无占位零提示零回归。
// 用法：cd ~/Desktop/织卷 && node scripts/act-gap-smoke.mjs
import { build as esbuild } from 'esbuild'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rmSync, mkdirSync, writeFileSync } from 'node:fs'

const root = resolve(import.meta.dirname, '..')
process.env.ZJ_APP_PATH = root
// 坑（2026-09-11）：userData 残留 zhijuan-settings.json 会让 libraryRoot() 指向空路径。
// 这里用干净 userData + 显式 settings 指向临时项目库，全程不碰真实项目库。
process.env.ZJ_USERDATA = '/tmp/zj-smoke-actgap'
rmSync(process.env.ZJ_USERDATA, { recursive: true, force: true })
const out = '/tmp/act-gap-bundle.mjs'

// 临时项目库：写 settings（libraryRoot 指过去）+ 一个带缺段占位的项目
const libRoot = '/tmp/zj-smoke-actgap-library'
rmSync(libRoot, { recursive: true, force: true })
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(resolve(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: libRoot }))

const pid = '占位冒烟'
const chDir = resolve(libRoot, pid, '正文')
mkdirSync(chDir, { recursive: true })
const FM = ['---', '章号: 1', '题名: 占位章', '切片: 第一幕', '涉及人物: [林晓]', '---', ''].join('\n') + '\n'
writeFileSync(
  resolve(chDir, '第01章_占位.md'),
  FM +
    '第一段正文，写得很顺。\n\n' +
    '<!-- 分幕草稿缺第 2 段：此处情节未写成，待补齐 -->\n\n' +
    '第三段正文，接得上。\n\n' +
    '<!-- 分幕草稿缺第 5 段：此处情节未写成，待补齐 -->\n\n' +
    '第六段正文收尾。'
)

await esbuild({
  stdin: {
    contents: `export { buildWritingContext } from ${JSON.stringify(resolve(root, 'src/main/agent/context.ts'))};`,
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

const { buildWritingContext } = await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

console.log('=== 缺段占位断链提示（真读盘）===')

const ctx = await buildWritingContext(pid, '正文/第01章_占位.md')
const text = ctx.blocks.join('\n\n')
console.log('块数:', ctx.blocks.length, '| 来源:', ctx.sources.join(', '))

const chapter = ctx.blocks.find((b) => b.includes('当前章节'))
assert('当前章节块存在', !!chapter)
assert('断链提示注入（缺第 2、5 段）', chapter.includes('分幕缺段占位') && chapter.includes('第 2、5 段未写成'))
assert('提示含「正文断链」措辞', chapter.includes('正文断链'))
assert('占位注释本体不进上下文', !text.includes('<!--'))
assert('正文内容（占位处两侧）真实注入', chapter.includes('第一段正文') && chapter.includes('第六段正文收尾'))

// 无占位项目 → 零提示零回归
const pid2 = '无占位冒烟'
const chDir2 = resolve(libRoot, pid2, '正文')
mkdirSync(chDir2, { recursive: true })
writeFileSync(resolve(chDir2, '第01章_平.md'), FM + '干净的正文，没有缺段。')
const ctx2 = await buildWritingContext(pid2, '正文/第01章_平.md')
const ch2 = ctx2.blocks.find((b) => b.includes('当前章节'))
assert('无占位：无断链提示', !!ch2 && !ch2.includes('分幕缺段') && !ch2.includes('正文断链'))
assert('无占位：正文正常注入', ch2.includes('干净的正文，没有缺段。'))

console.log(`\n=== 结果: ${pass} 断言全过 ===`)
process.exit(0)
