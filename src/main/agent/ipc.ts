// ===== 织卷 · agent IPC 路由（主进程） =====
import { ipcMain, BrowserWindow, dialog } from 'electron'
import { runChat, runSync, abortRequest, type AgentOutEvent } from './engine'
import { listSyncLog } from './syncLog'
import { runAudit, runChapterCheck, type AuditKind } from './audit'
import { runOutlineRebuild } from './outline'
import { runMaterialTriage } from './triage'
import { runDirector, cancelDirector } from './director'
import { runDirectorCheck } from './director-check'
import { runStructureCheck } from './structure-check'
import { runActs, type ActsRunOpts } from './acts'
import { ensureHarness, closeHarness, answerDir } from './runtime'
import { listCapabilities } from './subtask'
import { listSkills, createSkill, updateSkill, deleteSkill, setSkillDisabled, importSkill, exportSkill } from '../skills'
import { runWritingInsights, readInsightsState, listDrafts, promoteDraft, deleteDraft } from '../writingInsights'
import type { SkillDraft } from '../../shared/skills'
import type { InsightRunResult, InsightsState, DraftEntry } from '../../shared/writingInsights'
import { activeProvider, providerById } from '../../shared/providers'
import { getSettings, setSettings, libraryRoot } from '../settings'
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { writeFileAtomic } from '../fsutil'
import type { AskAnswer } from '../../shared/types'

export interface AgentSendInput {
  requestId: string
  projectId: string
  chapterRel: string | null
  chapterTitle: string
  prompt: string
  quote?: string | null
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** 焦点改稿任务：主进程 runChat 放宽预算（12min），见 engine.ts */
  focus?: boolean
}

function broadcast(e: AgentOutEvent) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('agent:event', e)
  }
}

export function registerAgentIpc() {
  // 发一条创作消息（流式事件通过 agent:event 推给所有窗口，按 requestId 认领）
  ipcMain.handle('agent:send', async (_e, input: AgentSendInput) => {
    await runChat(input, broadcast)
    return { ok: true }
  })
  // 展示性停止：不再转发该请求的后续事件，模型在边上跑完以保持会话一致
  ipcMain.handle('agent:cancel', (_e, requestId: string) => {
    abortRequest(requestId)
    return true
  })
  // 切片同步（设定补丁）
  ipcMain.handle('agent:sync', (_e, projectId: string, chapterRel: string) => runSync(projectId, chapterRel))
  // 切片同步历史日志（`.zhijuan/sync-log.jsonl`；最新在前）
  ipcMain.handle('sync:log', (_e, projectId: string) => listSyncLog(projectId))
  // 用户回答某个 ask 批次（写答案文件 → 写作引擎插件轮询回灌模型循环）
  ipcMain.handle('agent:answer', (_e, batch: string, answers: AskAnswer[]) => {
    if (!batch) return { ok: false, error: 'missing batch' }
    try {
      const dir = answerDir()
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, batch + '.json'), JSON.stringify({ answers }), 'utf-8')
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) }
    }
  })
  // 全卷检查子任务（一致性巡查 / 冷读报告）
  ipcMain.handle('agent:audit', (_e, projectId: string, kind: AuditKind) => runAudit(projectId, kind))
  // 本章级小环（每章短巡查 / 分层修订）
  ipcMain.handle('agent:chapterCheck', (_e, projectId: string, chapterRel: string, kind: 'chapter' | 'revision') =>
    runChapterCheck(projectId, chapterRel, kind)
  )
  // 大纲回建（把已有正文回建成章卡，写 大纲/ 目录；only：只回建指定的正文章节）
  ipcMain.handle('agent:outlineRebuild', (_e, projectId: string, only: string[] | undefined) => runOutlineRebuild(projectId, { only }))
  // 章节导演（动笔前给一章先导演板，写 大纲/<章>_导演.md；requirement=/导演 参数，cancelToken=取消标记）
  ipcMain.handle('agent:director', (_e, projectId: string, chapterRel: string, requirement?: string, cancelToken?: string) =>
    runDirector(projectId, chapterRel, requirement, cancelToken)
  )
  // 取消进行中的导演任务（标记后不再落资产；模型已发起的请求允许跑完）
  ipcMain.handle('agent:directorCancel', (_e, token: string) => {
    cancelDirector(token)
    return true
  })
  // 导演兑现检查（动笔后对照导演板核对本章，结果回 UI 不落盘）
  ipcMain.handle('agent:directorCheck', (_e, projectId: string, chapterRel: string) => runDirectorCheck(projectId, chapterRel))
  ipcMain.handle('agent:structureCheck', (_e, projectId: string) => runStructureCheck(projectId))
  // 分幕生成（按导演板情绪弧分段逐段起草整章，拼成定稿草稿落 大纲/<章>_分幕.md；
  // opts.onlyFailed 补写缺段：只重写草稿里未写成的段，已写成段原样保留）
  ipcMain.handle('agent:acts', (_e, projectId: string, chapterRel: string, opts?: ActsRunOpts) =>
    runActs(projectId, chapterRel, undefined, undefined, opts)
  )
  // 素材→设定升格判定
  ipcMain.handle('agent:triage', (_e, projectId: string) => runMaterialTriage(projectId))
  // 引擎状态（设置页用）
  ipcMain.handle('agent:status', async () => {
    const err = await ensureHarness()
    const s = getSettings()
    const cfg = activeProvider(s)
    return { online: !err, provider: cfg.preset.name, model: cfg.model, message: err }
  })
  // 连接检测（2026-10-26 主人反馈「DeepSeek 连不上、连接报错无法查看日志」）：用当前服务商配置发最小
  // chat/completions 请求，返回断点诊断（鉴权 401/404 模型名/429 限流/超时等），供设置页逐项排查。
  ipcMain.handle('llm:check', async (_e, cfgIn: { provider: string; model?: string; baseUrl?: string; apiKey?: string }) => {
    const s = getSettings()
    const preset = providerById(cfgIn.provider) ?? providerById(s.llm?.active) ?? providerById('local')!
    const cfg = s.llm?.providers?.[preset.id] ?? {}
    const baseUrl = (cfgIn.baseUrl || cfg.baseUrl || '').trim() || preset.baseURL
    const model = (cfgIn.model || cfg.model || '').trim() || preset.models[0]?.id || ''
    const key = (cfgIn.apiKey ?? cfg.apiKey ?? '').trim()
    if (preset.needsKey && !key) return { ok: false, step: 'apiKey', status: 0, message: '未填写 API Key：请在该服务商填 Key 后再测', body: '' }
    const api = preset.api
    const url = api === 'anthropic-messages' ? baseUrl + '/v1/messages' : baseUrl + '/chat/completions'
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (api === 'anthropic-messages') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01' }
    else if (key) headers['Authorization'] = 'Bearer ' + key
    const body = JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
    const ac = new AbortController()
    const to = setTimeout(() => ac.abort(), 15000)
    try {
      const r = await fetch(url, { method: 'POST', headers, body, signal: ac.signal })
      const text = await r.text()
      clearTimeout(to)
      const msg = r.ok
        ? '连接成功'
        : r.status === 401 || r.status === 403
          ? '鉴权失败（HTTP ' + r.status + '）：检查 API Key / 余额'
          : r.status === 404
            ? '模型或地址不存在（HTTP 404）：检查模型名与接入地址（DeepSeek 官方模型=deepseek-chat / deepseek-reasoner）'
            : r.status === 429
              ? '限流或配额不足（HTTP 429）'
              : 'HTTP ' + r.status
      return { ok: r.ok, step: 'request', status: r.status, message: msg, body: text.slice(0, 400), baseUrl: url, model }
    } catch (e) {
      clearTimeout(to)
      const msg = String((e as Error)?.message ?? e)
      return { ok: false, step: 'network', status: 0, message: /abort/i.test(msg) ? '连接超时（15s）：检查接入地址可达性' : msg, body: '', baseUrl: url, model }
    }
  })
  // 能力注册表（模块 J / E3）：枚举 + 设置页开关
  ipcMain.handle('agent:capabilities', () => listCapabilities())
  ipcMain.handle('agent:setCapability', (_e, id: string, enabled: boolean) => {
    const s = getSettings()
    setSettings({ capabilities: { ...(s.capabilities ?? {}), [id]: enabled } })
    return true
  })
  // 技能包清单（2026-09-21 skill 运行层）：渲染层 / 命令菜单合并技能命令用；返回轻量元数据（不含 body）
  ipcMain.handle('skills:list', () =>
    listSkills().map((s) => ({
      name: s.name,
      description: s.description,
      whenToUse: s.whenToUse,
      triggers: s.triggers,
      arguments: s.arguments,
      disabled: s.disabled,
      dir: s.dir,
      invalid: s.invalid
    }))
  )
  // 技能包写面（2026-09-21 设置管理增量 · 智能层数据链）：只回 ok/error，操作后状态一律重新 skills:list 拉取
  ipcMain.handle('skills:create', (_e, draft: SkillDraft) => createSkill(draft))
  ipcMain.handle('skills:update', (_e, name: string, draft: SkillDraft) => updateSkill(name, draft))
  ipcMain.handle('skills:delete', (_e, name: string) => deleteSkill(name))
  ipcMain.handle('skills:setDisabled', (_e, name: string, disabled: boolean) => setSkillDisabled(name, disabled))
  ipcMain.handle('skills:import', (_e, mdText: string) => importSkill(mdText))
  ipcMain.handle('skills:export', (_e, name: string) => exportSkill(name))
  // 写作习惯学习（2026-09-22 增量 4c 数据链；UI 归体验层）：手动跑一次 / 状态 / 草稿区列表 / 转正 / 删除
  // 门控失败 reason（disabled/recent/no-signal/error）原样透传，调用方按语义提示，不得与「无信号」混同
  ipcMain.handle('insights:run', (_e, projectId: string) => runWritingInsights(projectId))
  ipcMain.handle('insights:status', (_e, projectId: string) =>
    readInsightsState(join(libraryRoot(), projectId))
  )
  // 设置页「技能包」导入 / 导出（系统文件对话框：选 SKILL.md 读入导入；另存为 .md 写出——与 settings:importOveruseTxt/exportOveruseTxt 同范式）
  ipcMain.handle('skills:importPicker', async () => {
    const r = await dialog.showOpenDialog({
      title: '导入技能包（.md 文件，含 --- 约定头）',
      buttonLabel: '导入',
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true }
    try {
      return importSkill(readFileSync(r.filePaths[0], 'utf-8'))
    } catch (e) {
      return { ok: false, error: String((e as Error).message ?? e) }
    }
  })
  ipcMain.handle('skills:exportFile', async (e, name: string) => {
    const r = exportSkill(name)
    if (!r.ok) return r
    const opts = {
      title: `导出技能包「${name}」（.md）`,
      defaultPath: `${name}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    } as Electron.SaveDialogOptions
    const win = BrowserWindow.fromWebContents(e.sender)
    const s = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (s.canceled || !s.filePath) return { ok: false, cancelled: true }
    try {
      writeFileAtomic(s.filePath, r.text)
      return { ok: true, path: s.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error).message ?? err) }
    }
  })
  // 草稿区（增量 4c）：写面只回 ok/error；操作后状态一律重新 drafts:list 拉取（与 devShim mock 同语义）
  ipcMain.handle('drafts:list', () => listDrafts())
  ipcMain.handle('drafts:promote', (_e, fileName: string) => promoteDraft(fileName))
  ipcMain.handle('drafts:delete', (_e, fileName: string) => deleteDraft(fileName))
}

export function shutdownAgent() {
  void closeHarness()
}
