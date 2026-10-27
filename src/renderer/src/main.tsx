import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import { ensureDevShim } from './lib/devShim'
import ErrorBoundary from './features/common/ErrorBoundary'

ensureDevShim()

// ErrorBoundary 在 <App/>（含 RouterProvider/TooltipProvider）之外：任一页面渲染异常都兜住，
// 不再整窗白屏；详情同时上报主进程日志（2026-10-27 可见性 P1）。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
