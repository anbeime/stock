import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, RefreshCw, Send, CheckCircle2, Flame, LayoutGrid } from 'lucide-react';
import { AppPage, PageHeader, Card, ApiErrorAlert, InlineAlert, Collapsible } from '../common';
import { DragonBoardPanel } from './DragonBoardPanel';
import { SectorBoardPanel } from './SectorBoardPanel';
import { SectorLeaderBadge, LEADER_ROW_CLASS } from './SectorLeaderBadge';
import { useSectorLeaders, leaderInfoFor, type SectorLeaderMap } from '../../hooks/useSectorLeaders';
import { quantApi } from '../../api/quant';
import type {
  MergedSignals,
  QuantSignal,
  QuantStatus,
  DsaDecisionSignal,
} from '../../types/quant';

const DSA_ACTION_LABELS: Record<string, string> = {
  buy: '买入',
  add: '加仓',
  hold: '持有',
  reduce: '减仓',
  sell: '卖出',
  watch: '观望',
  avoid: '规避',
  alert: '提醒',
};

function dsaActionClass(action?: string | null): string {
  switch (action) {
    case 'buy':
    case 'add':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'sell':
    case 'reduce':
    case 'avoid':
      return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    case 'hold':
    case 'watch':
    default:
      return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  }
}

function StatTile({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-elevated/40 px-4 py-3">
      <p className="text-xs text-secondary-text">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent ?? 'text-foreground'}`}>{value}</p>
    </div>
  );
}

function TechnicalSignalRow({ s, leaderMap }: { s: QuantSignal; leaderMap: SectorLeaderMap }) {
  const confirmed = s.news_confirmed === 'True' || s.news_confirmed === 'true';
  const leader = leaderInfoFor(leaderMap, s.code);
  return (
    <tr className={`border-t border-border/50 hover:bg-elevated/30 ${leader ? LEADER_ROW_CLASS : ''}`}>
      <td className="px-3 py-2 font-mono text-foreground">{s.code}</td>
      <td className="px-3 py-2 text-foreground">
        {s.name}<SectorLeaderBadge info={leader} />
      </td>
      <td className="px-3 py-2 text-secondary-text">
        {s.strategy === 'core_DE-A' ? 'DE-A 核心' : s.strategy === 'satellite_MF' ? 'MF 卫星' : s.strategy}
      </td>
      <td className="px-3 py-2 text-right text-secondary-text">{s.ref_close ?? '-'}</td>
      <td className="px-3 py-2 text-right text-secondary-text">{s.strength ?? '-'}</td>
      <td className="px-3 py-2 text-center">
        {s.dragon_gate === 'Y' || s.dragon_gate === 'True' ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">通过</span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-500/30 bg-slate-500/15 px-2 py-0.5 text-xs text-slate-300">未过</span>
        )}
      </td>
      <td className="px-3 py-2 text-center">
        {confirmed ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/15 px-2 py-0.5 text-xs text-sky-400">双确认</span>
        ) : (
          <span className="text-xs text-secondary-text">纯技术</span>
        )}
      </td>
      <td className="px-3 py-2 text-right text-secondary-text">{s.stop_loss_pct ?? '-'}</td>
      <td className="px-3 py-2 text-xs text-secondary-text">{s.note ?? ''}</td>
    </tr>
  );
}

function DsaDecisionRow({ d, leaderMap }: { d: DsaDecisionSignal; leaderMap: SectorLeaderMap }) {
  const leader = leaderInfoFor(leaderMap, d.stock_code);
  return (
    <tr className={`border-t border-border/50 hover:bg-elevated/30 ${leader ? LEADER_ROW_CLASS : ''}`}>
      <td className="px-3 py-2 font-mono text-foreground">{d.stock_code}</td>
      <td className="px-3 py-2 text-foreground">
        {d.stock_name}<SectorLeaderBadge info={leader} />
      </td>
      <td className="px-3 py-2 text-center">
        <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${dsaActionClass(d.action)}`}>
          {DSA_ACTION_LABELS[d.action ?? ''] ?? d.action ?? '-'}
        </span>
      </td>
      <td className="px-3 py-2 text-right text-secondary-text">{d.score ?? '-'}</td>
      <td className="px-3 py-2 text-right text-secondary-text">{d.confidence ?? '-'}</td>
      <td className="px-3 py-2 text-xs text-secondary-text max-w-xs truncate" title={d.reason ?? ''}>{d.reason ?? ''}</td>
    </tr>
  );
}

export const QuantDashboard: React.FC = () => {
  const [data, setData] = useState<MergedSignals | null>(null);
  const [status, setStatus] = useState<QuantStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<{ ok: boolean; log: string[]; last_sign_line?: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [merged, st] = await Promise.all([quantApi.getMerged(), quantApi.getStatus()]);
      setData(merged);
      setStatus(st);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    document.title = '量化选股 · 知易 Antinet';
  }, [load]);

  const handlePush = useCallback(async (regenerate: boolean) => {
    setPushing(true);
    setPushResult(null);
    try {
      const res = await quantApi.pushQmt(regenerate);
      setPushResult({ ok: res.ok, log: res.log, last_sign_line: res.last_sign_line });
      await load();
    } catch (err) {
      setPushResult({ ok: false, log: [err instanceof Error ? err.message : '推送失败'] });
    } finally {
      setPushing(false);
    }
  }, [load]);

  const tech = data?.technical;
  const dsa = data?.dsa_decision;
  const leaderMap = useSectorLeaders();

  return (
    <AppPage>
      <div className="space-y-5">
        <PageHeader
          eyebrow="知易 Antinet · 技术选股 × TOPGO 舆情"
          title="量化选股决策仪表盘"
          description="DE-A 双能量核心 + MF 主力控盘卫星 + 龙资格闸门（技术选股），与 TOPGO 新闻/LLM 决策信号并列，一键推送 QMT 自动交易。"
          actions={(
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              刷新
            </button>
          )}
        />

        {error ? <ApiErrorAlert error={{ title: '加载失败', message: error, status: 0 } as any} /> : null}

        {/* 市场状态 + 管线概览 */}
        <Card title="市场门控与管线状态" padding="md">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="大盘多头门控 (沪深300>MA200)"
              value={status?.market_up == null ? '—' : status.market_up ? '多头 ✓' : '空头 ✗'}
              accent={status?.market_up ? 'text-emerald-400' : 'text-rose-400'}
            />
            <StatTile
              label="龙资格闸门"
              value={status?.dragon_gate_enabled == null ? '—' : status.dragon_gate_enabled ? '开启' : '关闭'}
            />
            <StatTile label="候选宇宙" value={status?.universe_size ?? '—'} />
            <StatTile
              label="本期入选"
              value={status?.selected ?? 0}
              accent="text-sky-400"
            />
          </div>
          {status?.as_of ? (
            <p className="mt-3 text-xs text-muted-text">数据基准日 (as_of)：{status.as_of}　|　运行耗时：{status.elapsed_sec ?? '—'}s</p>
          ) : null}
        </Card>

        {/* 技术选股信号 */}
        <Card
          title="技术选股信号（知易 Antinet）"
          subtitle={tech ? `as_of ${tech.as_of} · 入选 ${tech.signals.length} 只` : '加载中…'}
          padding="md"
        >
          <div className="mb-3 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2"
              onClick={() => void handlePush(false)}
              disabled={pushing}
            >
              <Send className={pushing ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
              推送 QMT（现有信号）
            </button>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2"
              onClick={() => void handlePush(true)}
              disabled={pushing}
            >
              <TrendingUp className="h-4 w-4" />
              重跑并推送
            </button>
          </div>
          {tech && tech.signals.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-text">
                    <th className="px-3 py-2">代码</th>
                    <th className="px-3 py-2">名称</th>
                    <th className="px-3 py-2">策略</th>
                    <th className="px-3 py-2 text-right">参考价</th>
                    <th className="px-3 py-2 text-right">强度</th>
                    <th className="px-3 py-2 text-center">龙资格</th>
                    <th className="px-3 py-2 text-center">新闻确认</th>
                    <th className="px-3 py-2 text-right">止损%</th>
                    <th className="px-3 py-2">备注</th>
                  </tr>
                </thead>
                <tbody>
                  {tech.signals.map((s) => (
                    <TechnicalSignalRow key={s.code} s={s} leaderMap={leaderMap} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-secondary-text">
              本期无技术入选标的（大盘空头门控下 DE-A 全灭属设计内；MF 卫星为补充信号）。可关注下方「新闻舆情候选」或等待大盘翻多。
            </p>
          )}
        </Card>

        {/* TOPGO 决策信号（新闻/LLM） */}
        <Card
          title="TOPGO 新闻/LLM 决策信号"
          subtitle={dsa ? `${dsa.available ? `可用 · ${dsa.signals.length} 条` : (dsa.reason ?? '不可用')}` : '加载中…'}
          padding="md"
        >
          {dsa && dsa.available && dsa.signals.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-text">
                    <th className="px-3 py-2">代码</th>
                    <th className="px-3 py-2">名称</th>
                    <th className="px-3 py-2 text-center">动作</th>
                    <th className="px-3 py-2 text-right">评分</th>
                    <th className="px-3 py-2 text-right">置信</th>
                    <th className="px-3 py-2">理由</th>
                  </tr>
                </thead>
                <tbody>
                  {dsa.signals.map((d) => (
                    <DsaDecisionRow key={d.id} d={d} leaderMap={leaderMap} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-secondary-text">
              {dsa?.available === false
                ? 'TOPGO 决策信号库暂不可用（需运行 TOPGO 分析引擎生成）。技术选股信号不受影响。'
                : '暂无 TOPGO 决策信号。'}
            </p>
          )}
        </Card>

        {/* 推送结果回显 */}
        {pushResult ? (
          pushResult.ok ? (
            <InlineAlert
              variant="success"
              title="已推送 QMT"
              message={`信号已写入 C:\\F\\sign.txt 并镜像到 C:\\F\\antinet_signals。最新预警行：${pushResult.last_sign_line ?? '—'}`}
            />
          ) : (
            <InlineAlert variant="danger" title="推送失败" message={pushResult.log.join('；')} />
          )
        ) : null}

        {pushing ? (
          <div className="flex items-center gap-2 text-sm text-secondary-text">
            <CheckCircle2 className="h-4 w-4 animate-pulse" /> 正在调用选股管线并写入 QMT 预警…
          </div>
        ) : null}

        {/* 概念/行业板块行情（东财 push2 真实数据，默认展开可见） */}
        <Collapsible
          title="概念/行业板块行情 · 涨幅榜/跌幅榜（真实）"
          icon={<LayoutGrid size={16} />}
          defaultOpen={true}
        >
          <SectorBoardPanel />
        </Collapsible>

        {/* 超短打板复盘（扣子导出包移植，只读档案；默认收起不影响主流程） */}
        <Collapsible
          title="超短打板复盘 · 策略档案（只读）"
          icon={<Flame size={16} />}
          defaultOpen={false}
        >
          <DragonBoardPanel />
        </Collapsible>
      </div>
    </AppPage>
  );
};

export default QuantDashboard;
