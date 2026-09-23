// 作品编译 · 数据层冒烟（真读盘：临时项目 3 章 → buildCompiledBody 输出成品）
// 验证：整书合并（章序/剥 front matter/剥 HTML 注释/一级标题/多线注记/空章跳过）
// 用法：cd ~/Desktop/织卷 && node scripts/compile-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-compile-'))
process.env.ZJ_APP_PATH = root
process.env.ZJ_USERDATA = join(tmp, 'userdata')
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const lib = join(tmp, 'lib')
const pid = '编译冒烟'
const P = (rel) => join(lib, pid, rel)
mkdirSync(P('正文'), { recursive: true })
mkdirSync(P('大纲'), { recursive: true })

writeFileSync(
  P('正文/第01章_雾港栈桥.md'),
  '---\n章号: 1\n题名: 雾港栈桥\n切片: [开局]\n时间线: [主线]\n涉及人物: [沈藏]\n---\n雾很大，栈桥隐没在灰白里。\n<!-- 分幕草稿缺第 2 段：此处情节未写成，待补齐 -->\n他点燃了灯。\n',
  'utf-8'
)
writeFileSync(
  P('正文/第02章_旧历.md'),
  '---\n章号: 2\n题名: 旧历\n时间线: 过去线\n---\n二十年前，也是一样的雾。\n',
  'utf-8'
)
writeFileSync(P('正文/第03章_灯下.md'), '---\n章号: 3\n题名: 灯下\n---\n灯下的她翻过一页。\n', 'utf-8')
writeFileSync(P('正文/第04章_空章.md'), '---\n章号: 4\n题名: 空白\n---\n', 'utf-8')
// 干扰件：非正文目录不应参与（素材库/大纲副产物）
writeFileSync(P('大纲/第01章_雾港栈桥.md'), '# 章卡', 'utf-8')

const out = '/tmp/zj-compile-bundle.mjs'
await esbuild({
  stdin: {
    contents: `export { buildCompiledBody } from ${JSON.stringify(resolve(root, 'src/main/compile.ts'))};`,
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

const { buildCompiledBody } = await import(pathToFileURL(out).href)

let pass = 0
const assert = (name, cond) => {
  if (!cond) throw new Error('断言失败: ' + name)
  pass++
  console.log('  ✓ ' + name)
}

console.log('=== 作品编译（真读盘）===')
const r = buildCompiledBody(pid)
assert('编译成功', r.ok)
const body = r.body
assert('含 3 章（空章 04 跳过；章卡不混入）', r.chapters === 3)
assert('章节按章号序拼接（第1章在前）', body.startsWith('# 第1章 雾港栈桥'))
assert('标题含章号+题名', body.includes('# 第2章 旧历（线：过去线）') && body.includes('# 第3章 灯下'))
assert('非主线章带线注记（过去线）', body.includes('（线：过去线）'))
assert('主食 front matter 已剥（无「章号:」）', !body.includes('章号:'))
assert('HTML 注释已剥（无「分幕草稿缺」）', !body.includes('分幕草稿缺'))
assert('正文内容按序保留', body.includes('雾很大，栈桥隐没在灰白里。') && body.includes('灯下的她翻过一页。'))
assert('空章不占位（无「空白」标题）', !body.includes('# 第4章'))
assert('成品以单换行收尾', body.endsWith('\n'))

// 空项目（无正文目录）→ ok + 空串（调用方提示「没有可导出的正文」）
const emptyId = '编译空项目'
mkdirSync(join(lib, emptyId), { recursive: true })
const e = buildCompiledBody(emptyId)
assert('无正文项目：ok + body 空串', e.ok && e.body === '' && e.chapters === 0)

console.log(`\n全部通过（${pass} 断言）`)
rmSync(tmp, { recursive: true, force: true })
