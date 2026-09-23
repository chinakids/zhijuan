// 织卷 · 大验收路径演练·第二阶段——「先文沉淀→下一章上下文」数据层全链冒烟（无 GUI / 无模型）
// 场景：建角色档案（含基础档案）→ 写第1章 → 切片同步（模拟模型产物：旧格式坏提案）→ 归一化 → 提案落库 → 接受写入
//       → 写第2章 → buildWritingContext 实读：断言第1章沉淀的切片状态真的进入第2章上下文（人物/世界观双向）。
// 用法：cd ~/Desktop/织卷 && node scripts/context-loop-smoke.mjs
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-loop-'))
process.env.ZJ_USERDATA = join(tmp, 'userdata')
process.env.ZJ_APP_PATH = root

// 设置：库根指向临时目录（settings 在模块加载时读取，故写在前）
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeFileSync(join(process.env.ZJ_USERDATA, 'zhijuan-settings.json'), JSON.stringify({ libraryRoot: join(tmp, 'lib') }), 'utf-8')

const entry = join(tmp, 'entry.mts')
writeFileSync(
  entry,
  [
    `import { normalizeSyncItems, ensureWorldSliceFile } from '${root}/src/main/agent/syncAnchor'`,
    `import { createProposals, applyProposal } from '${root}/src/main/proposals'`,
    `import { buildWritingContext } from '${root}/src/main/agent/context'`,
    `import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'`,
    `import { join } from 'node:path'`,
    ``,
    `const lib = '${join(tmp, 'lib')}'`,
    `const pid = '闭环smoke'`,
    `const P = (rel) => join(lib, pid, rel)`,
    `mkdirSync(P('人物'), { recursive: true })`,
    `mkdirSync(P('世界观'), { recursive: true })`,
    `mkdirSync(P('正文'), { recursive: true })`,
    ``,
    `// ① 角色档案（含手写基础档案）+ 总纲 + 第1/2章约定头`,
    `writeFileSync(P('人物/林晓.md'), '# 林晓\\n\\n> 定位：女高中生\\n\\n## 基础档案\\n\\n- 年龄：17\\n- 外貌：长发\\n- 背景：转学生\\n')`,
    `writeFileSync(P('世界观/总纲.md'), '# 世界观总纲\\n\\n## 时代背景\\n\\n近未来滨海小城\\n')`,
    `writeFileSync(P('正文/第01章_初见.md'), '---\\n章号: 1\\n题名: 初见\\n切片: 第一幕_初见夜\\n涉及人物: [林晓]\\n---\\n\\n林晓深夜独自站在雾港栈桥，裹着大衣踏水走向刚下班的陈默。\\n')`,
    `writeFileSync(P('正文/第02章_夜谈.md'), '---\\n章号: 2\\n题名: 夜谈\\n切片: 第二幕_夜谈\\n涉及人物: [林晓]\\n---\\n\\n夜谈从一杯热茶开始。\\n')`,
    ``,
    `let fails = 0`,
    `const check = (name, cond) => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name); if (!cond) fails++ }`,
    ``,
    `// ② 模拟第1章保存时的切片同步：模型产物为「旧格式坏提案」（anchor=基础档案 / 世界指向总纲）`,
    `const slice1 = '第一幕_初见夜'`,
    `ensureWorldSliceFile(lib + '/' + pid, slice1)`,
    `let items = [`,
    `  { target: '人物/林晓.md', anchor: '基础档案', kind: 'upsert-section', before: '原档案无本章行动', after: '- 本幕动向：主动靠近陈默；踏水走向对方\\n- 状态下限：穿大衣、赤足踩水', reason: '本章行动' },`,
    `  { target: '世界观/总纲.md', anchor: '', kind: 'upsert-section', before: '', after: '- 事件：凌晨两点栈桥大雾，能见度极低\\n- 环境：栈桥尽头铁栏杆边，港务局守灯辖区', reason: '本章环境' }`,
    `]`,
    `items = normalizeSyncItems(items, slice1)`,
    `check('归一化：人物 anchor → 切片小节', items[0].anchor === '切片：第一幕_初见夜')`,
    `check('归一化：世界 target → 切片_文件', items[1].target === '世界观/切片_第一幕_初见夜.md')`,
    `const ps = createProposals(lib, pid, 'slice-sync', '第01章_初见.md', slice1, items)`,
    `check('提案落库且带 slice 字段', ps.every((p) => p.slice === slice1))`,
    `const acc = applyProposal(lib, pid, ps[0].id)`,
    `check('接受①人物提案成功', acc.ok && acc.applied.includes('人物/林晓.md'))`,
    `const acc2 = applyProposal(lib, pid, ps[1].id)`,
    `check('接受②世界提案成功', acc2.ok && acc2.applied.includes('世界观/切片_第一幕_初见夜.md'))`,
    ``,
    `// ③ 写第2章：装配上下文（正文为源、设定为流——读回来验证）`,
    `const ctx = await buildWritingContext(pid, '正文/第02章_夜谈.md')`,
    `const all = ctx.blocks.join('\\n')`,
    `const src = ctx.sources`,
    `check('上下文含当前章正文', all.includes('夜谈从一杯热茶开始'))`,
    `check('上下文含上一章尾部（承接前情）', all.includes('踏水走向刚下班的陈默'))`,
    `check('人物存档切片状态进入上下文', all.includes('主动靠近陈默') && all.includes('本幕动向'))`,
    `check('基础档案未被覆盖（年龄/背景仍在）', all.includes('年龄：17') && all.includes('转学生'))`,
    `const hasWorld = all.includes('栈桥大雾') && all.includes('守灯辖区')`,
    `check('第1章世界切片状态进入第2章上下文（目标：补缺后应达）', hasWorld)`,
    `check('来源清单含世界切片文件', src.includes('世界观/切片_第一幕_初见夜.md'))`,
    ``,
    `// ④ 旧数据兼容：无前缀旧名文件（早期约定遗留形态），上一章回退应能读到`,
    `const lib2 = lib`,
    `mkdirSync(join(lib2, '旧名项目', '世界观'), { recursive: true })`,
    `mkdirSync(join(lib2, '旧名项目', '正文'), { recursive: true })`,
    `writeFileSync(join(lib2, '旧名项目', '世界观/第一幕_旧名.md'), '# 切片：第一幕_旧名\\n\\n- 旧约定世界状态\\n')`,
    `writeFileSync(join(lib2, '旧名项目', '正文/第01章_旧.md'), '---\\n章号: 1\\n题名: 旧\\n切片: 第一幕_旧名\\n涉及人物: []\\n---\\n\\n正文\\n')`,
    `writeFileSync(join(lib2, '旧名项目', '正文/第02章_续.md'), '---\\n章号: 2\\n题名: 续\\n切片: 第二幕_续\\n涉及人物: []\\n---\\n\\n正文2\\n')`,
    `const ctx2 = await buildWritingContext('旧名项目', '正文/第02章_续.md')`,
    `check('旧名兼容：上一章无前缀世界文件进入上下文', ctx2.blocks.join('\\n').includes('旧约定世界状态'))`,
    `// ⑤ 完全无世界文件时回退总纲（首章场景）`,
    `mkdirSync(join(lib2, '无纲项目', '世界观'), { recursive: true })`,
    `mkdirSync(join(lib2, '无纲项目', '正文'), { recursive: true })`,
    `writeFileSync(join(lib2, '无纲项目', '世界观/总纲.md'), '# 总纲\\n\\n- 长期设定：近未来滨海小城\\n')`,
    `writeFileSync(join(lib2, '无纲项目', '正文/第01章_始.md'), '---\\n章号: 1\\n题名: 始\\n切片: 第一幕_夜\\n涉及人物: []\\n---\\n\\n开头\\n')`,
    `const ctx3 = await buildWritingContext('无纲项目', '正文/第01章_始.md')`,
    `check('无切片文件回退总纲', ctx3.blocks.join('\\n').includes('长期设定：近未来滨海小城'))`,
    ``,
    `console.log(fails === 0 ? 'SMOKE OK' : 'SMOKE FAILED: ' + fails)`,
    `process.exit(fails === 0 ? 0 : 1)`
  ].join('\n')
)

const out = join(tmp, 'bundle.mjs')
await esbuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, alias: { electron: resolve(root, 'scripts/electron-stub.mjs') }, logLevel: 'silent' })
const { spawnSync } = await import('node:child_process')
const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
rmSync(tmp, { recursive: true, force: true })
process.exit(r.status ?? 1)
