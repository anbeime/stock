import React, { useMemo } from 'react';
import { ExternalLink, TrendingUp } from 'lucide-react';

/**
 * TOPGO 量化工作台 — 同端口 /workbench 看板(autoloop 调度/擒龙主信号/TOPGO 决策/爬取数据/KEY 配置)。
 * 原 8101 独立服务已挂载进 TOPGO 后端 /workbench 前缀，不再需要单独端口。
 * iframe 目标动态取当前访问主机名, 局域网内他人访问本页同样可达。
 */
const WorkbenchPage: React.FC = () => {
  const boardUrl = useMemo(() => `${window.location.origin}/workbench/board`, []);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-[hsl(var(--primary))]" />
          <div>
            <h1 className="text-lg font-semibold leading-tight text-foreground">量化工作台</h1>
            <p className="text-xs text-secondary-text">
              autoloop 调度 · 擒龙主信号 · TOPGO 决策 · 爬取数据直查 · KEY 配置
            </p>
          </div>
        </div>
        <a
          href={boardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-xl border border-transparent px-3 py-2 text-sm text-secondary-text transition-all hover:bg-[var(--nav-hover-bg)] hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
          新窗口打开
        </a>
      </div>
      <iframe
        src={boardUrl}
        title="TOPGO 量化工作台"
        className="w-full flex-1 rounded-2xl border border-[var(--nav-hover-bg)] bg-background"
        style={{ minHeight: 'calc(100vh - 11rem)' }}
      />
    </div>
  );
};

export default WorkbenchPage;
