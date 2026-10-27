// ===== 渲染层兜底：白屏时至少让人看见「出错了 + 堆栈 + 重载」 =====
// 背景（2026-10-27 可见性 P1）：此前全仓无 ErrorBoundary——任一页面渲染异常，React 卸载整棵树，
// 窗口只剩空白背景，作者与排障者都无从下手（日志里也没有痕迹）。
// 本组件挂在 main.tsx 的 <App/> 外层（Router 之外）：任何页面/Provider 的渲染错误都被接住。
// 三件事：①原地展示错误与堆栈；②把错误**同时**写进主进程日志（window.zhijuan.logRenderer，
// 打包后成品里 DevTools 未必开着）；③给出可行动作（重试渲染 / 重新加载 / 复制详情）。
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  /** React 给的组件栈（定位「哪个组件炸的」比 JS 栈更直接） */
  componentStack: string
  copied: boolean
}

/** 任意抛出物 → 可读文本（React 允许 throw 非 Error） */
function describe(err: unknown): { name: string; message: string; stack: string } {
  if (err instanceof Error) {
    return { name: err.name || 'Error', message: err.message || '(无错误信息)', stack: err.stack ?? '' }
  }
  if (typeof err === 'string') return { name: 'Error', message: err, stack: '' }
  let text = ''
  try {
    text = JSON.stringify(err)
  } catch {
    text = String(err)
  }
  return { name: 'Error', message: text || '(未知错误)', stack: '' }
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: '', copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, copied: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const componentStack = info.componentStack ?? ''
    this.setState({ componentStack })
    const { name, message, stack } = describe(error)
    const text = `渲染层异常 ${name}: ${message}\n${stack}\n--- componentStack ---${componentStack}`
    // 落主进程日志（main.log 的 [renderer] 行）：白屏现场可事后取证；上报本身失败不阻断兜底 UI
    try {
      window.zhijuan?.logRenderer?.('error', text)
    } catch {
      // preload 缺失/旧的开发垫片：忽略
    }
    try {
      console.error('[zhijuan] render error', error, info)
    } catch {
      // 控制台不可用时忽略
    }
  }

  private reload = (): void => {
    try {
      window.location.reload()
    } catch {
      // 极端环境下 reload 不可用：至少不二次抛
    }
  }

  private retry = (): void => {
    this.setState({ error: null, componentStack: '', copied: false })
  }

  private copy = (): void => {
    const { error, componentStack } = this.state
    const { name, message, stack } = describe(error)
    const text = `渲染层异常 ${name}: ${message}\n${stack}\n--- componentStack ---${componentStack}`
    try {
      void navigator.clipboard?.writeText(text)
      this.setState({ copied: true })
    } catch {
      this.setState({ copied: false })
    }
  }

  render(): ReactNode {
    const { error, componentStack, copied } = this.state
    if (!error) return this.props.children

    const { name, message, stack } = describe(error)
    const detail = `${name}: ${message}${stack || componentStack ? `\n\n${stack}` : ''}${
      componentStack ? `\n\n--- 组件栈 ---${componentStack}` : ''
    }`
    return (
      <div
        data-testid="app-error-boundary"
        role="alert"
        className="flex h-screen w-screen items-center justify-center overflow-y-auto bg-surface p-8 text-ink"
      >
        <div className="w-full max-w-2xl rounded-xl border border-danger/40 bg-surface-2 p-6">
          <h1 className="text-base font-semibold text-danger">出错了</h1>
          <p className="mt-1 text-xs leading-5 text-ink-3">
            当前页面渲染失败（不会自动恢复）。可以先「重试渲染」；仍不行就「重新加载」。错误详情已写入主进程日志，
            也可复制后反馈。
          </p>
          <p className="mt-3 break-all text-sm font-medium text-ink" data-testid="error-summary">
            {name}: {message}
          </p>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md border border-hair bg-surface p-3 text-[11px] leading-relaxed text-ink-2">
            {detail}
          </pre>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="error-reload"
              onClick={this.reload}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink transition-opacity hover:opacity-90"
            >
              重新加载
            </button>
            <button
              type="button"
              data-testid="error-retry"
              onClick={this.retry}
              className="rounded-md border border-hair px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent hover:text-accent"
            >
              重试渲染
            </button>
            <button
              type="button"
              data-testid="error-copy"
              onClick={this.copy}
              className="rounded-md border border-hair px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent hover:text-accent"
            >
              {copied ? '已复制 ✓' : '复制错误详情'}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
