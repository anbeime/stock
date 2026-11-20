import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Flame, RefreshCw, Info, Users } from 'lucide-react';
import { quantApi } from '../../api/quant';
import type { DragonBoardSnapshot, XueqiuHotStock } from '../../types/quant';
import { SectorLeaderBadge, LEADER_ROW_CLASS } from './SectorLeaderBadge';
import { useSectorLeaders, leaderInfoFor, type SectorLeaderMap } from '../../hooks/useSectorLeaders';

const SEAL_GOOD = 'text-rose-400'; // 早盘封板强 → 红色（A股涨=红）
const TIER_ORDER = ['5板+', '4板', '3板', '2板', '1板'];

function MiniStat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-elevated/40 px-3 py-2">
      <p className="text-[11px] text-secondary-text">{label}</p>
      <p className={`mt-0.5 text-xl font-semibold ${tone ?? 'text-foreground'}`}>{value}</p>
    </div>
  );
}

/** 仅 A 股 6 位数字代码可打开 K 线（雪球榜含港股/美股，需过滤） */
const aShareCode = (raw: string): string | null => {
  const d = String(raw || '').replace(/[^0-9]/g, '');
  return /^\d{6}$/.test(d) ? d : null;
};

function SealRow({ code, name, seal, tier, industry, leaderMap, onOpenChart }: {
  code: string; name: string; seal: string; tier?: string; industry?: string;
  leaderMap?: SectorLeaderMap; onOpenChart?: (code: string, name?: string) => void;
}) {
  const leader = leaderMap ? leaderInfoFor(leaderMap, code) : null;
  const valid = aShareCode(code);
  return (
    <tr className={`border-t border-border/50 hover:bg-elevated/30 ${leader ? LEADER_ROW_CLASS : ''}`}>
      <td className="px-2 py-1.5 font-mono text-xs text-foreground">
        {valid && onOpenChart
          ? <button type="button" className="text-cyan hover:underline" title={`查看 ${valid} 的 K 线`} onClick={() => onOpenChart(valid, name)}>{code}</button>
          : code}
      </td>
      <td className="px-2 py-1.5 text-xs text-foreground">
        {valid && onOpenChart
          ? <button type="button" className="hover:underline" onClick={() => onOpenChart(valid, name)}>{name}</button>
          : name}<SectorLeaderBadge info={leader} />
      </td>
      <td className="px-2 py-1.5 text-xs text-secondary-text">{industry ?? '-'}</td>
      <td className="px-2 py-1.5 text-xs text-secondary-text">{tier ?? '-'}</td>
      <td className={`px-2 py-1.5 text-right font-mono text-xs ${SEAL_GOOD}`}>{seal}</td>
    </tr>
  );
}

// 雪球人气榜行：A股习惯红涨绿跌；排名上升=红(更热)，下降=绿
function HotRow({ s, onOpenChart }: { s: XueqiuHotStock; onOpenChart?: (code: string, name?: string) => void }) {
  const pctTone = s.pct > 0 ? 'text-rose-400' : s.pct < 0 ? 'text-emerald-400' : 'text-secondary-text';
  const rankTone = s.rank_change > 0 ? 'text-rose-400' : s.rank_change < 0 ? 'text-emerald-400' : 'text-secondary-text';
  const valid = aShareCode(s.symbol);
  return (
    <tr className="border-t border-border/50 hover:bg-elevated/30">
      <td className="px-2 py-1.5 text-center font-mono text-xs text-secondary-text">{s.rank}</td>
      <td className="px-2 py-1.5 font-mono text-xs text-foreground">
        {valid && onOpenChart
          ? <button type="button" className="text-cyan hover:underline" title={`查看 ${valid} 的 K 线`} onClick={() => onOpenChart(valid, s.name)}>{s.symbol}</button>
          : s.symbol}
      </td>
      <td className="px-2 py-1.5 text-xs text-foreground">
        {valid && onOpenChart
          ? <button type="button" className="hover:underline" onClick={() => onOpenChart(valid, s.name)}>{s.name}</button>
          : s.name}
      </td>
      <td className="px-2 py-1.5 text-right font-mono text-xs text-foreground">
        {s.price ? s.price.toFixed(2) : '-'}
      </td>
      <td className={`px-2 py-1.5 text-right font-mono text-xs ${pctTone}`}>
        {s.pct > 0 ? '+' : ''}{s.pct.toFixed(2)}%
      </td>
      <td className="px-2 py-1.5 text-right font-mono text-xs text-secondary-text">
        {s.heat >= 10000 ? `${(s.heat / 10000).toFixed(2)}万` : Math.round(s.heat)}
      </td>
      <td className={`px-2 py-1.5 text-right font-mono text-xs ${rankTone}`}>
        {s.rank_change > 0 ? `↑${s.rank_change}` : s.rank_change < 0 ? `↓${Math.abs(s.rank_change)}` : '—'}
      </td>
    </tr>
  );
}

export const DragonBoardPanel: React.FC<{ onOpenChart?: (code: string, name?: string) => void }> = ({ onOpenChart }) => {
  const [snap, setSnap] = useState<DragonBoardSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaderMap = useSectorLeaders();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await quantApi.getDragonBoard();
      setSnap(d);
      if (!d.ok) setError(d.error ?? '数据源暂不可用');
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!snap && !loading && !error) {
    return <p className="py-3 text-sm text-secondary-text">加载中…</p>;
  }

  const counts = snap?.counts;
  const tiers = snap?.tiers ?? {};
  const tierKeys = TIER_ORDER.filter((k) => tiers[k]?.length);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-secondary-text">
          <Info size={14} className="mt-0.5 shrink-0 text-sky-400" />
          <span>
            只读复盘面板 · 数据来源：{snap?.source ?? '东财 push2ex'}
            {snap?.date ? ` · 交易日 ${snap.date}` : ''}
            {snap?.fetched_at ? ` · 抓取 ${snap.fetched_at}` : ''}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-elevated/40 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-elevated disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {loading ? '刷新中' : '刷新'}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
          {error}（技术选股信号不受影响）
        </p>
      )}

      {snap && snap.ok && counts && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="涨停家数" value={counts.limit_up} tone="text-rose-400" />
            <MiniStat label="炸板家数" value={counts.broken} tone="text-amber-400" />
            <MiniStat label="早盘封板(≤10:00)" value={counts.early_seal} tone={SEAL_GOOD} />
            <MiniStat label="强势股池" value={counts.strong} />
          </div>

          {/* 连板梯队 */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Flame size={15} className="text-rose-400" /> 连板梯队
              <span className="text-xs font-normal text-secondary-text">
                （涨停股按连板高度分组，真实封板时间）
              </span>
            </p>
            {tierKeys.length === 0 ? (
              <p className="py-2 text-xs text-secondary-text">当日无涨停梯队数据</p>
            ) : (
              <div className="space-y-2">
                {tierKeys.map((key) => (
                  <div key={key}>
                    <p className="mb-1 text-xs text-secondary-text">
                      {key} · {tiers[key].length} 只
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-border/50">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-elevated/40 text-[11px] text-secondary-text">
                            <th className="px-2 py-1.5">代码</th>
                            <th className="px-2 py-1.5">名称</th>
                            <th className="px-2 py-1.5">所属行业</th>
                            <th className="px-2 py-1.5">炸板</th>
                            <th className="px-2 py-1.5 text-right">首封时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tiers[key].slice(0, 12).map((s) => (
                            <SealRow
                              key={s.code}
                              code={s.code}
                              name={s.name}
                              seal={s.first_seal}
                              industry={s.industry}
                              leaderMap={leaderMap}
                              onOpenChart={onOpenChart}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 行业热度 */}
          {snap.industry_heat.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">涨停股行业分布</p>
              <div className="flex flex-wrap gap-2">
                {snap.industry_heat.map((h) => (
                  <span
                    key={h.industry}
                    className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs text-rose-300"
                  >
                    {h.industry} · {h.limit_up_count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 早盘封板观察 */}
          {snap.early_seal_stocks.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium text-foreground">早盘封板观察（≤10:00）</p>
              <div className="overflow-x-auto rounded-lg border border-border/50">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-elevated/40 text-[11px] text-secondary-text">
                      <th className="px-2 py-1.5">代码</th>
                      <th className="px-2 py-1.5">名称</th>
                      <th className="px-2 py-1.5">行业</th>
                      <th className="px-2 py-1.5">连板</th>
                      <th className="px-2 py-1.5 text-right">首封</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.early_seal_stocks.slice(0, 15).map((s) => (
                      <SealRow
                        key={`e-${s.code}`}
                        code={s.code}
                        name={s.name}
                        seal={s.first_seal}
                        tier={`${s.limit_count}板`}
                        industry={s.industry}
                        leaderMap={leaderMap}
                        onOpenChart={onOpenChart}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 雪球人气实时榜（当日展示，不回测/不进信号流） */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Users size={15} className="text-sky-400" /> 雪球人气实时榜
              <span className="text-xs font-normal text-secondary-text">
                （仅当日展示，不参与回测/信号流）
              </span>
            </p>
            {snap.hot_error ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300/90">
                人气榜暂不可用：{snap.hot_error}（打板池数据不受影响）
              </p>
            ) : (snap.hot_stocks ?? []).length === 0 ? (
              <p className="py-2 text-xs text-secondary-text">暂无人气榜数据</p>
            ) : (
              <>
                <div className="overflow-x-auto rounded-lg border border-border/50">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-elevated/40 text-[11px] text-secondary-text">
                        <th className="px-2 py-1.5 text-center">#</th>
                        <th className="px-2 py-1.5">代码</th>
                        <th className="px-2 py-1.5">名称</th>
                        <th className="px-2 py-1.5 text-right">现价</th>
                        <th className="px-2 py-1.5 text-right">涨跌幅</th>
                        <th className="px-2 py-1.5 text-right">人气值</th>
                        <th className="px-2 py-1.5 text-right">排名变化</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snap.hot_stocks.map((s) => <HotRow key={s.symbol} s={s} onOpenChart={onOpenChart} />)}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1.5 text-[11px] text-secondary-text">
                  来源：{snap.hot_source}
                  {snap.hot_fetched_at ? ` · 抓取 ${snap.hot_fetched_at}` : ''}
                  {' · 雪球榜含港股/美股，非纯 A 股；红涨绿跌'}
                </p>
              </>
            )}
          </div>

          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300/90">
            {snap.caveat}。本面板仅供复盘观察，不构成投资建议；人气股策略技术内核经样本外回测亏损（PF 1.07 / 篮子 -9.3%），未纳入实时选股信号流。
          </p>
        </>
      )}
    </div>
  );
};

export default DragonBoardPanel;
