import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { LayoutGrid, RefreshCw, Info } from 'lucide-react';
import { quantApi } from '../../api/quant';
import type { SectorBoardSnapshot, SectorSection, SectorStock } from '../../types/quant';

type BoardKind = 'industry' | 'concept';

// A股习惯：涨=红，跌=绿
function pctTone(pct: number): string {
  return pct > 0 ? 'text-rose-400' : pct < 0 ? 'text-emerald-400' : 'text-secondary-text';
}

/** 仅 A 股 6 位数字代码可打开 K 线（领涨股代码可能为空或非 A 股） */
const aShareCode = (raw: string): string | null => {
  const d = String(raw || '').replace(/[^0-9]/g, '');
  return /^\d{6}$/.test(d) ? d : null;
};

function SectorRow({ s, rank, onOpenChart }: {
  s: SectorStock; rank?: number; onOpenChart?: (code: string, name?: string) => void;
}) {
  const leaderCode = aShareCode(s.leader_code || '');
  return (
    <tr className="border-t border-border/50 hover:bg-elevated/30">
      {rank !== undefined && (
        <td className="px-2 py-1.5 text-center font-mono text-xs text-secondary-text">{rank}</td>
      )}
      <td className="px-2 py-1.5 text-xs text-foreground">{s.name}</td>
      <td className={`px-2 py-1.5 text-right font-mono text-xs font-medium ${pctTone(s.pct)}`}>
        {s.pct > 0 ? '+' : ''}{s.pct.toFixed(2)}%
      </td>
      <td className="px-2 py-1.5 text-center font-mono text-[11px] text-secondary-text">
        <span className="text-rose-400/80">{s.up_count}</span>
        <span className="mx-0.5 text-secondary-text/50">/</span>
        <span className="text-emerald-400/80">{s.down_count}</span>
      </td>
      <td className="px-2 py-1.5 text-xs text-foreground">
        {s.leader ? (
          leaderCode && onOpenChart ? (
            <button type="button" className="text-cyan hover:underline" title={`查看 ${leaderCode} 的 K 线`}
              onClick={() => onOpenChart(leaderCode, s.leader || undefined)}>
              {s.leader}
              <span className="ml-1 font-mono text-[11px] text-cyan/70">{s.leader_code}</span>
            </button>
          ) : (
            <>
              {s.leader}
              {s.leader_code && (
                <span className="ml-1 font-mono text-[11px] text-secondary-text">{s.leader_code}</span>
              )}
            </>
          )
        ) : <span className="text-secondary-text">-</span>}
      </td>
    </tr>
  );
}

function BoardTable({ title, rows, negative, onOpenChart }: {
  title: string; rows: SectorStock[]; negative?: boolean;
  onOpenChart?: (code: string, name?: string) => void;
}) {
  return (
    <div>
      <p className={`mb-1.5 text-xs font-medium ${negative ? 'text-emerald-400' : 'text-rose-400'}`}>
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="py-2 text-xs text-secondary-text">暂无数据</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/50">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-elevated/40 text-[11px] text-secondary-text">
                <th className="px-2 py-1.5 text-center">#</th>
                <th className="px-2 py-1.5">板块</th>
                <th className="px-2 py-1.5 text-right">涨跌幅</th>
                <th className="px-2 py-1.5 text-center">涨/跌家</th>
                <th className="px-2 py-1.5">领涨股</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => <SectorRow key={s.code || s.name} s={s} rank={i + 1} onOpenChart={onOpenChart} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SectionView({ sec, onOpenChart }: {
  sec: SectorSection; onOpenChart?: (code: string, name?: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-secondary-text">
        <span>共 <span className="font-mono text-foreground">{sec.total}</span> 个{sec.label}</span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BoardTable title={`${sec.label} · 涨幅榜`} rows={sec.gainers} onOpenChart={onOpenChart} />
        <BoardTable title={`${sec.label} · 跌幅榜`} rows={sec.losers} negative onOpenChart={onOpenChart} />
      </div>
    </div>
  );
}

export const SectorBoardPanel: React.FC<{ onOpenChart?: (code: string, name?: string) => void }> = ({ onOpenChart }) => {
  const [snap, setSnap] = useState<SectorBoardSnapshot | null>(null);
  const [kind, setKind] = useState<BoardKind>('concept');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await quantApi.getSectorBoard();
      setSnap(d);
      if (!d.ok) {
        setError(d.error ?? Object.values(d.errors ?? {})[0] ?? '板块数据源暂不可用');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const section = snap?.sections?.[kind];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-secondary-text">
          <Info size={14} className="mt-0.5 shrink-0 text-sky-400" />
          <span>
            概念/行业板块行情 · 来源：{snap?.source ?? '东财 push2'}
            {snap?.fetched_at ? ` · 抓取 ${snap.fetched_at}` : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-border/60 bg-elevated/40 p-0.5">
            <button
              type="button"
              onClick={() => setKind('concept')}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${kind === 'concept' ? 'bg-accent/20 text-foreground' : 'text-secondary-text hover:text-foreground'}`}
            >概念板块</button>
            <button
              type="button"
              onClick={() => setKind('industry')}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${kind === 'industry' ? 'bg-accent/20 text-foreground' : 'text-secondary-text hover:text-foreground'}`}
            >行业板块</button>
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
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
          {error}（技术选股信号不受影响）
        </p>
      )}

      {!snap && !loading && !error && (
        <p className="py-3 text-sm text-secondary-text"><LayoutGrid size={14} className="mr-1 inline" />加载中…</p>
      )}

      {section && <SectionView sec={section} onOpenChart={onOpenChart} />}

      {snap && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-300/90">
          {snap.caveat}。板块数据仅供复盘观察，不构成投资建议。红涨绿跌（A股习惯）。
        </p>
      )}
    </div>
  );
};

export default SectorBoardPanel;
