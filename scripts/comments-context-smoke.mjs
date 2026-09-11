// 织卷 · buildWritingContext 剥离 HTML 注释（元信息）—— 数据层真读盘冒烟
// 场景：临时项目库里放 模板式人物档（说明注释+事实）/ 含注释世界切片 / 含作者备忘注释的正文，
//        buildWritingContext 实读：断言注释一律不进上下文、事实完整保留、未闭合注释保守保留。
// 用法：cd ~/Desktop/织卷 && node scripts/comments-context-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-comments-'))
process.env.ZJ_USERDATA = join(tmp, 'userdata')
process.env.ZJ_APP_PATH = root
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(
  join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'),
  JSON.stringify({ libraryRoot: join(tmp, 'lib') }),
  'utf-8'
)

const entry = join(tmp, 'entry.mts')
writeFileSync(
  entry,
  [
    `import { buildWritingContext } from '${root}/src/main/agent/context'`,
    `import { writeFileSync, mkdirSync } from 'node:fs'`,
    `import { join } from 'node:path'`,
    ``,
    `const lib = join('${join(tmp, 'lib')}')`,
    `const pid = '注释smoke'`,
    `const P = (rel) => join(lib, pid, rel)`,
    `mkdirSync(P('人物'), { recursive: true })`,
    `mkdirSync(P('世界观'), { recursive: true })`,
    `mkdirSync(P('正文'), { recursive: true })`,
    ``,
    `// ① 模板式人物档：说明注释 + 真实事实（模拟 charDoc/示例模板建档后的形态）`,
    `writeFileSync(P('人物/林晓.md'), '# 林晓\\n\\n<!-- 正文保存时，切片同步会把 TA 在本章的新状态写入「## 切片：<切片名>」小节；基础档案是长期设定。 -->\\n\\n- 年龄：17\\n- 身份：转学生\\n')`,
    `// ② 世界切片：骨架注释 + 事实（模拟示例模板在建章后写入事实的形态）`,
    `writeFileSync(P('世界观/切片_第一幕_初见夜.md'), '# 切片：第一幕_初见夜\\n\\n<!-- 这是时间切片文件的骨架：正文保存后切片同步会写入新状态。 -->\\n\\n- 事件：凌晨两点栈桥大雾\\n- 环境：能见度极低\\n')`,
    `// ③ 正文：含作者备忘注释 + 未闭合注释（手误）`,
    `writeFileSync(P('正文/第01章_初见.md'), '---\\n章号: 1\\n题名: 初见\\n切片: 第一幕_初见夜\\n涉及人物: [林晓]\\n---\\n\\n林晓深夜走上栈桥。<!-- 作者备忘：第二幕要回收这盏灯 -->\\n\\n<!-- 没闭合的手误注释\\n')`,
    ``,
    `let fails = 0`,
    `const check = (name, cond) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name); if (!cond) fails++ }`,
    ``,
    `const ctx = await buildWritingContext(pid, '正文/第01章_初见.md')`,
    `const all = ctx.blocks.join('\\n')`,
    ``,
    `check('成对 HTML 注释已全部剥离（无 <!--…-->）', !/<!--[\\s\\S]*?-->/.test(all))`,
    `check('模板说明文字不进上下文', !all.includes('切片同步会把') && !all.includes('时间切片文件的骨架'))`,
    `check('作者备忘注释不进上下文', !all.includes('第二幕要回收这盏灯'))`,
    `check('事实完整保留：人物年龄/身份', all.includes('年龄：17') && all.includes('转学生'))`,
    `check('事实完整保留：世界切片事件/环境', all.includes('凌晨两点栈桥大雾') && all.includes('能见度极低'))`,
    `check('正文事实保留', all.includes('林晓深夜走上栈桥'))`,
    `check('未闭合注释保守保留（不吞正文）', all.includes('没闭合的手误注释'))`,
    `check('来源清单含人物档与世界切片', ctx.sources.includes('人物/林晓.md') && ctx.sources.includes('世界观/切片_第一幕_初见夜.md'))`,
    ``,
    `console.log(fails === 0 ? 'SMOKE OK' : 'SMOKE FAILED: ' + fails)`,
    `process.exit(fails === 0 ? 0 : 1)`
  ].join('\n')
)

const out = join(tmp, 'bundle.mjs')
await esbuild({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  alias: { electron: resolve(root, 'scripts/electron-stub.mjs') },
  logLevel: 'silent'
})
const { spawnSync } = await import('node:child_process')
const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
rmSync(tmp, { recursive: true, force: true })
process.exit(r.status ?? 1)
