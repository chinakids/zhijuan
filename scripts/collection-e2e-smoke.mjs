// 织卷 · 采集管道端到端复验（数据层）：项目→发起采集(pending)→模拟管道回填(done+素材)→检索/类别树闭环。
// 纯织卷侧验证，不依赖 cron/管道是否恢复：App 侧动作=writeDoc 任务卡；管道动作=writeDoc 素材 + 改写任务卡(结果/完成)。
// 真文件系统 + 真 store/library/taskCard 代码（esbuild bundle + electron-stub），无 GUI / 无模型。
// 用法：cd ~/Desktop/织卷 && node scripts/collection-e2e-smoke.mjs
import { writeProbeSettings } from './lib/probe-settings.mjs'
import { build as esbuild } from 'esbuild'
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'zj-colle2e-'))
process.env.ZJ_USERDATA = join(tmp, 'userdata')
process.env.ZJ_APP_PATH = root
mkdirSync(process.env.ZJ_USERDATA, { recursive: true })
writeProbeSettings({ libraryRoot: join(tmp, 'lib') })

const entry = join(tmp, 'entry.mts')
writeFileSync(
  entry,
  [
    `import { createProject, writeDoc, readDoc, listDocs, projectDir } from '${root}/src/main/store'`,
    `import { searchDocs, listLibraryCategories, recentLibraryDocs } from '${root}/src/main/library'`,
    `import { parseTaskCard, isLibraryResultPath, isTaskStale } from '${root}/src/shared/taskCard'`,
    `import { existsSync } from 'node:fs'`,
    `import { join } from 'node:path'`,
    ``,
    `let fails = 0`,
    `const check = (name, cond, extra = '') => { console.log((cond ? '[PASS] ' : '[FAIL] ') + name + (cond ? '' : ' | ' + extra)); if (!cond) fails++ }`,
    ``,
    `// ---- 步骤 1：建项目（App 侧）→ 骨架含采集池 ----`,
    `const pid = '采集e2e'`,
    `const p = createProject(pid, 'e2e 采集闭环')`,
    `check('建项目成功', !!p)`,
    `check('骨架含 素材库/采集池', existsSync(join(projectDir(pid), '素材库', '采集池')))`,
    ``,
    `// ---- 步骤 2：App 发起采集（与 CollectionBar.submit 同口径的 front matter） ----`,
    `const now = Date.now()`,
    `const name = '任务_' + new Date(now).toISOString().replace(/[-:TZ]/g, '').slice(0, 14)`,
    `const demand = '校园老图书馆的感官细节：借书卡、木质书架、午后光线，要写实贴国内校园'`,
    `const baseFm = [`,
    `  '---', 'status: pending', '类别: 环境', '关键词: [旧图书馆, 借书卡, 阅览室]', '需求: ' + demand, '来源: ', '创建: ' + '2026-09-12 07:30',`,
    `  '---', '', '# 采集任务：校园图书馆场景细节', '', '**需求详情**：' + demand, '', '（由管道的后台代理按关键词抓取并回填，App 侧只负责登记。）', ''`,
    `].join('\\n')`,
    `writeDoc(pid, '素材库/采集池/' + name + '.md', baseFm)`,
    `const cards = listDocs(pid, '素材库/采集池')`,
    `check('采集池列表出现新任务卡', cards.some((c) => c.file === name + '.md'), JSON.stringify(cards.map((c) => c.file)))`,
    `const v0 = parseTaskCard(readDoc(pid, '素材库/采集池/' + name + '.md') ?? '')`,
    `check('初始 status=pending', v0.status === 'pending')`,
    `check('需求完整未截断', v0.demand === demand)`,
    `check('关键词/类别解析', v0.category === '环境' && v0.keywords.includes('借书卡'))`,
    `check('pending 未回填时不带结果与完成', v0.result === '' && v0.finishedAt === '')`,
    ``,
    `// ---- 步骤 3：模拟管道回填（写素材草稿 + 改写任务卡 done：结果/完成） ----`,
    `const matRel = '素材库/环境/采集_' + name.slice('任务_'.length) + '.md'`,
    `const matText = [`,
    `  '---', '标签: [图书馆, 校园, 环境]', '来源: 测试回填（e2e）',`,
    `  '---', '', '# 校园老图书馆（采集草稿）', '', '> 采集自公开网络，**草稿**，逐条过目后再决定是否升格。', '', '## 可复用的感官细节', '', '- **借书卡**：手写墨迹会洇开，卡片边缘被翻得发毛。', '- **木质书架**：老樟木味混着纸页的霉味。', '', '## 来源与版权注意', '', '- 仅作写实参考，不直接引用原文。', ''`,
    `].join('\\n')`,
    `writeDoc(pid, matRel, matText)`,
    `const doneFm = [`,
    `  '---', 'status: done', '类别: 环境', '关键词: [旧图书馆, 借书卡, 阅览室]', '需求: ' + demand, '来源: ', '创建: ' + '2026-09-12 07:30',`,
    `  '结果: ' + matRel, '完成: 2026-09-12 07:45',`,
    `  '---', '', '# 采集任务：校园图书馆场景细节', '', '**需求详情**：' + demand, ''`,
    `].join('\\n')`,
    `writeDoc(pid, '素材库/采集池/' + name + '.md', doneFm)`,
    `const v1 = parseTaskCard(readDoc(pid, '素材库/采集池/' + name + '.md') ?? '')`,
    `check('回填后 status=done', v1.status === 'done')`,
    `check('结果路径=素材草稿且安全可预览', v1.result === matRel && isLibraryResultPath(v1.result))`,
    `check('完成时间已回填', v1.finishedAt === '2026-09-12 07:45')`,
    `check('素材草稿可读（标题/细节在）', (readDoc(pid, matRel) ?? '').includes('校园老图书馆') && (readDoc(pid, matRel) ?? '').includes('借书卡'))`,
    ``,
    `// ---- 步骤 4：素材库侧闭环（类别树/全文搜索/最近素材均排除采集池） ----`,
    `const cats = listLibraryCategories(pid)`,
    `check('类别树出现 环境(count=1)', cats.some((c) => c.name === '环境' && c.count === 1), JSON.stringify(cats))`,
    `const hits = searchDocs(pid, '素材库', '借书卡', { excludePrefix: ['素材库/采集池/'] })`,
    `check('全文搜索命中回填素材', hits.some((h) => h.file === matRel), JSON.stringify(hits.map((h) => h.file)))`,
    `const recents = recentLibraryDocs(pid, 5)`,
    `check('最近素材含回填卡片', recents.some((r) => r.file === matRel), JSON.stringify(recents.map((r) => r.file)))`,
    ``,
    `// ---- 步骤 5：失败回填与路径防线 ----`,
    `const failFm = ['---', 'status: failed', '类别: 环境', '需求: 示例失败', '来源: ', '创建: 2026-09-12 07:30', '---', '', '# 采集任务：示例失败', ''].join('\\n')`,
    `writeDoc(pid, '素材库/采集池/任务_失败样例.md', failFm)`,
    `const vf = parseTaskCard(readDoc(pid, '素材库/采集池/任务_失败样例.md') ?? '')`,
    `check('失败卡 status=failed 且不算停滞', vf.status === 'failed' && !isTaskStale(vf.status, Date.now() - 1000, Date.now()))`,
    `check('坏结果路径被拦（穿越/非 md）', !isLibraryResultPath('../../etc/passwd.md') && !isLibraryResultPath('素材库/环境/a.txt') && !isLibraryResultPath('正文/第01章.md'))`,
    ``,
    `console.log(fails === 0 ? 'SMOKE OK' : 'SMOKE FAILED: ' + fails)`,
    `process.exit(fails === 0 ? 0 : 1)`
  ].join('\n')
)

const out = join(tmp, 'bundle.mjs')
await esbuild({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', outfile: out, alias: { electron: resolve(root, 'scripts/electron-stub.mjs') }, logLevel: 'silent' })
const { spawnSync } = await import('node:child_process')
const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
if (!process.env.ZJ_KEEP) rmSync(tmp, { recursive: true, force: true })
process.exit(r.status ?? 1)
