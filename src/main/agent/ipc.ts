// ===== 织卷 · agent IPC 路由（主进程） =====
import { ipcMain, BrowserWindow } from 'electron'
import { runChat, runSync, abortRequest, type AgentOutEvent } from './engine'
import { runAudit, runChapterCheck, type AuditKind } from './audit'
import { runOutlineRebuild } from './outline'
import { runMaterialTriage } from './triage'
import { runDirector } from './director'
import { ensureHarness, closeHarness, answerDir } from './runtime'
import { listCapabilities } from './subtask'
import { activeProvider } from '../../shared/providers'
import { getSettings, setSettings } from '../settings'
import { mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { AskAnswer } from '../../shared/types'

export interface AgentSendInput {
  requestId: string
  projectId: string
  chapterRel: string | null
  chapterTitle: string
  prompt: string
  quote?: string | null
  history?: { role: 'user' | 'assistant'; content: string }[]
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
  // 章节导演（动笔前给一章先导演板，写 大纲/<章>_导演.md）
  ipcMain.handle('agent:director', (_e, projectId: string, chapterRel: string) => runDirector(projectId, chapterRel))
  // 素材→设定升格判定
  ipcMain.handle('agent:triage', (_e, projectId: string) => runMaterialTriage(projectId))
  // 引擎状态（设置页用）
  ipcMain.handle('agent:status', async () => {
    const err = await ensureHarness()
    const s = getSettings()
    const cfg = activeProvider(s)
    return { online: !err, provider: cfg.preset.name, model: cfg.model, message: err }
  })
  // 能力注册表（模块 J / E3）：枚举 + 设置页开关
  ipcMain.handle('agent:capabilities', () => listCapabilities())
  ipcMain.handle('agent:setCapability', (_e, id: string, enabled: boolean) => {
    const s = getSettings()
    setSettings({ capabilities: { ...(s.capabilities ?? {}), [id]: enabled } })
    return true
  })
}

export function shutdownAgent() {
  void closeHarness()
}
