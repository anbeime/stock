import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { quantApi } from '../../api/quant';
import type { ChartData, KlineCandle, KlineMark, ChartOverlay, ChartSubchart } from '../../types/quant';

/**
 * 轻量 K 线图（零新增 npm 依赖，纯 Canvas 2D）。
 * 两种主图模式：
 *  - 简单：红涨绿跌 + MA5/10/20/60 + 真实决策/擒龙 B/S 标记 + 成交量。
 *  - 通达信：叠加用户主图公式复刻（MA5 角度变色、BBI 上下轨、一号支撑线+UB、
 *    轴心 MA99、涨停黄柱/跌停蓝柱、量能平台、高点压力、必杀线K、ZIG 拐点 B/S）。
 * 数据全部来自 /api/v1/quant/chart/{code}（真实 OHLCV + 真实买卖信号 + 公式指标）。
 * 注：ZIG/压力线含未来函数，仅复盘参考，图例显式标注，绝不冒充真实成交信号。
 */
interface Props {
  code: string;
  name?: string;
  onClose?: () => void;
}

const MA_COLORS: Record<string, string> = {
  ma5: '#00ccff', ma10: '#e36ad6', ma20: '#4fd1c5', ma60: '#7aa2f7',
};
const UP = '#f04b52';
const DOWN = '#26a86b';
const BG = '#0b0f14';
const GRID = '#1c2530';

/** 通达信主图复刻线条的中文图例（顺序与后端 lines 对齐，仅列主要项） */
const TDX_LEGEND: { key: string; label: string; color: string }[] = [
  { key: 'ma5', label: 'MA5', color: '#00ccff' },
  { key: 'ma10', label: 'MA10', color: '#e36ad6' },
  { key: 'ma20', label: 'MA20', color: '#4fd1c5' },
  { key: 'ma30', label: 'MA30', color: '#f5d76e' },
  { key: 'support1', label: '一号支撑', color: '#7bd88f' },
  { key: 'ub', label: 'UB上轨', color: '#e6edf3' },
  { key: 'ma99', label: 'MA99轴心', color: '#ff9f43' },
  { key: 'bbi', label: 'BBI', color: '#b39ddb' },
  { key: 'ma5_red', label: 'MA5强势', color: '#f04b52' },
  { key: 'ma5_green', label: 'MA5弱势', color: '#22c55e' },
];

export const KlineChart: React.FC<Props> = ({ code, name, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(120);
  const [hover, setHover] = useState<number | null>(null);
  const [tdxMode, setTdxMode] = useState(true); // 默认通达信主图（用户提供的公式）
  const [markFilter, setMarkFilter] = useState<'all' | 'real' | 'formula'>('real'); // 默认只看真实信号，避免 ZIG 图标铺满
  const [showSub, setShowSub] = useState(true); // 多空能量副图显隐
  const [pinned, setPinned] = useState<number | null>(null); // 从明细表点选后锁定读数

  const load = useCallback(() => {
    if (!code) return;
    setLoading(true);
    setError(null);
    quantApi.getChart(code, days)
      .then((d) => {
        setData(d);
        if (!d.ok && d.error) setError(d.error);
        setLoading(false);
      })
      .catch((e) => {
        setError(e?.parsedApiError?.message || e?.message || '加载 K 线失败');
        setLoading(false);
      });
  }, [code, days]);

  useEffect(() => { load(); }, [load]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !data || !data.candles?.length) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth;
    const H = Math.max(420, Math.min(760, wrap.clientHeight || 620));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const candles = data.candles;
    const n = candles.length;
    const padL = 8, padR = 66, padT = 26, padB = 26;
    const sub: ChartSubchart | undefined = showSub ? data.subchart : undefined;
    const hasSub = Boolean(sub && (sub.bars?.length || sub.sd?.length));
    const bodyH = H - padT - padB;
    // 有副图时：主图 62% / 成交量 14% / 副图 18%（余量做间隔）
    const priceH = bodyH * (hasSub ? 0.56 : 0.74);
    const volTop = padT + priceH + 16;
    const volH = hasSub ? bodyH * 0.14 : H - padB - volTop;
    const subTop = hasSub ? volTop + volH + 22 : 0;
    const subH = hasSub ? Math.max(60, H - padB - subTop) : 0;
    const plotW = W - padL - padR;

    // 价格范围：纳入 overlay 的水平线/段/图标价，避免画到图外
    let hi = -Infinity, lo = Infinity, volMax = 0;
    candles.forEach((c) => {
      hi = Math.max(hi, c.high); lo = Math.min(lo, c.low);
      volMax = Math.max(volMax, c.volume || 0);
    });
    const ov: ChartOverlay | undefined = tdxMode ? data.overlay : undefined;
    if (ov) {
      (ov.lines || []).forEach((l) => l.data.forEach((p) => {
        if (p != null) { hi = Math.max(hi, p); lo = Math.min(lo, p); }
      }));
      (ov.segments || []).forEach((s) => { hi = Math.max(hi, s.y1, s.y2); lo = Math.min(lo, s.y1, s.y2); });
      (ov.icons || []).forEach((m) => { hi = Math.max(hi, m.price); lo = Math.min(lo, m.price); });
      (ov.texts || []).forEach((t) => { hi = Math.max(hi, t.price); lo = Math.min(lo, t.price); });
    }
    const lv = data.levels;
    if (lv) {
      [lv.entry_high, lv.target_price, lv.entry_low, lv.stop_loss].forEach((p) => {
        if (p != null) { hi = Math.max(hi, p); lo = Math.min(lo, p); }
      });
    }
    const range = (hi - lo) || 1;
    hi += range * 0.05; lo -= range * 0.05;
    const priceY = (p: number) => padT + (hi - p) / (hi - lo) * priceH;
    const slot = plotW / n;
    const bw = Math.max(1, Math.min(9, slot * 0.62));
    const cx = (i: number) => padL + slot * (i + 0.5);

    // 网格 + 右价格轴
    ctx.strokeStyle = GRID; ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, monospace'; ctx.textBaseline = 'middle';
    for (let g = 0; g <= 4; g++) {
      const p = lo + (hi - lo) * (g / 4);
      const y = priceY(p);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
      ctx.fillStyle = '#8794a8'; ctx.fillText(p.toFixed(2), W - padR + 6, y);
    }
    ctx.beginPath(); ctx.moveTo(padL, volTop - 8); ctx.lineTo(W - padR, volTop - 8); ctx.stroke();
    ctx.fillStyle = '#8794a8'; ctx.fillText('VOL', padL + 2, volTop + 6);

    // 蜡烛 + 成交量
    candles.forEach((c, i) => {
      const x = cx(i);
      const up = c.close >= c.open;
      const color = up ? UP : DOWN;
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.beginPath(); ctx.moveTo(x, priceY(c.high)); ctx.lineTo(x, priceY(c.low)); ctx.stroke();
      const yO = priceY(c.open), yC = priceY(c.close);
      const top = Math.min(yO, yC), hgt = Math.max(1.2, Math.abs(yC - yO));
      if (up) ctx.fillRect(x - bw / 2, top, bw, hgt);
      else { ctx.globalAlpha = 0.15; ctx.fillRect(x - bw / 2, top, bw, hgt); ctx.globalAlpha = 1; ctx.strokeRect(x - bw / 2, top, bw, hgt); }
      const vh = volMax ? (c.volume / volMax) * volH : 0;
      ctx.globalAlpha = 0.6; ctx.fillRect(x - bw / 2, volTop + volH - vh, bw, vh); ctx.globalAlpha = 1;
    });

    // 通达信主图指标叠加
    if (ov) {
      // 涨停黄柱 / 跌停蓝柱（画在K线上层）
      (ov.bars || []).forEach((b) => {
        if (b.index < 0 || b.index >= n) return;
        const x = cx(b.index);
        ctx.strokeStyle = b.color; ctx.lineWidth = 3;
        ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(x, priceY(b.y1)); ctx.lineTo(x, priceY(b.y2)); ctx.stroke();
        ctx.globalAlpha = 1; ctx.lineWidth = 1;
      });

      // 水平/倾斜参考线：量能平台、高点压力、必杀线K
      (ov.segments || []).forEach((s) => {
        ctx.strokeStyle = s.color; ctx.lineWidth = s.dash ? 1 : 1.5;
        if (s.dash) ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(cx(Math.max(0, s.x1)), priceY(s.y1));
        ctx.lineTo(cx(Math.min(n - 1, s.x2)), priceY(s.y2));
        ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 1;
        ctx.fillStyle = s.color;
        ctx.fillText(s.label, Math.min(W - padR - 52, cx(Math.max(0, s.x1)) + 3), priceY(s.y1) - 6);
      });

      // 指标线（后画的加粗线如 ma5_red 覆盖基础线）
      const order = ['ma145', 'ub', 'upr', 'dwn', 'bbi', 'ma99', 'support1',
                     'ma30', 'ma20', 'ma10', 'ma5', 'ma5_red', 'ma5_green', 'bbi_red'];
      const byKey = new Map((ov.lines || []).map((l) => [l.key, l]));
      order.forEach((key) => {
        const l = byKey.get(key);
        if (!l) return;
        ctx.strokeStyle = l.color; ctx.lineWidth = l.width;
        ctx.beginPath(); let pen = false;
        l.data.forEach((p, i) => {
          if (p == null) { pen = false; return; }
          const x = cx(i), y = priceY(p);
          if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
      ctx.lineWidth = 1;

      // 文字标注：轴心值、K、S（RSI超买）
      (ov.texts || []).forEach((t) => {
        if (t.index < 0 || t.index >= n) return;
        ctx.fillStyle = t.color;
        ctx.font = t.text === 'K' || t.text === 'S' ? 'bold 12px ui-monospace, monospace' : '9px ui-monospace, monospace';
        ctx.fillText(t.text, cx(t.index) - (t.text.length > 2 ? 12 : 3), priceY(t.price) + (t.text.length > 2 ? 12 : -6));
      });
      ctx.font = '10px ui-monospace, monospace';

      // 公式 ZIG 拐点 B/S 图标：空心三角，区别于真实信号的实心三角
      // 按 markFilter 过滤；未确认拐点画虚线边（未来函数提示）
      if (markFilter !== 'real') {
        (ov.icons || []).forEach((m) => {
          if (m.index < 0 || m.index >= n) return;
          const x = cx(m.index);
          const isB = m.kind === 'B';
          const y = isB ? priceY(m.price) + 16 : priceY(m.price) - 16;
          const color = isB ? '#ff8a8a' : '#7fe0a0';
          ctx.strokeStyle = color; ctx.fillStyle = BG; ctx.lineWidth = 1.5;
          if (m.unconfirmed) ctx.setLineDash([2, 2]);
          ctx.beginPath();
          if (isB) { ctx.moveTo(x, y - 9); ctx.lineTo(x - 6, y); ctx.lineTo(x + 6, y); }
          else { ctx.moveTo(x, y + 9); ctx.lineTo(x - 6, y); ctx.lineTo(x + 6, y); }
          ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = color; ctx.font = 'bold 10px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(m.kind, x, isB ? y - 2 : y + 3);
          ctx.textAlign = 'left'; ctx.font = '10px ui-monospace, monospace';
        });
      }
    } else {
      // 简单模式：基础均线
      Object.entries(data.ma || {}).forEach(([key, series]) => {
        if (!Array.isArray(series)) return;
        ctx.strokeStyle = MA_COLORS[key] || '#aaa'; ctx.lineWidth = 1.4;
        ctx.beginPath(); let pen = false;
        series.forEach((p, i) => {
          if (p == null) { pen = false; return; }
          const x = cx(i), y = priceY(p);
          if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
      ctx.lineWidth = 1;
    }

    // 决策价位线（真实 TOPGO 决策）：虚线 + 右侧标签
    if (lv) {
      const lines: [number | null, string, string][] = [
        [lv.entry_high, `压力 ${lv.entry_high?.toFixed(2)}`, '#f5d76e'],
        [lv.target_price, `目标 ${lv.target_price?.toFixed(2)}`, '#4fd1c5'],
        [lv.entry_low, `买区 ${lv.entry_low?.toFixed(2)}`, '#e36ad6'],
        [lv.stop_loss, `止损 ${lv.stop_loss?.toFixed(2)}`, '#f04b52'],
      ];
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      lines.forEach(([p, label, color]) => {
        if (p == null) return;
        const y = priceY(p);
        ctx.strokeStyle = color; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.globalAlpha = 1; ctx.fillStyle = color;
        ctx.fillText(label, W - padR - 54, y - 7);
      });
      ctx.setLineDash([]);
    }

    // 真实买卖点 B/S 标记：实心三角 + 白字（与公式图标区分）
    // 按 markFilter 过滤；邻近标记垂直错层避免叠字
    if (markFilter !== 'formula') {
      const realMarks = [...(data.marks || [])].sort((a, b) => a.index - b.index);
      const lastX: number[] = [];
      realMarks.forEach((m: KlineMark) => {
        const i = m.index;
        if (i < 0 || i >= n) return;
        const x = cx(i);
        const isB = m.kind === 'B';
        let tier = 0;
        // 与最近的同类标记若 x 距离 < 22px，则往上/下错一层
        while (lastX.some((px) => Math.abs(px - x) < 22) && tier < 3) { tier++; }
        lastX.push(x);
        const base = isB ? priceY(m.price) + 16 : priceY(m.price) - 16;
        const y = base + (isB ? 1 : -1) * tier * 15;
        const color = isB ? '#ff4d4f' : '#22c55e';
        ctx.fillStyle = color;
        if (tier > 0) { // 错层标记画一条细引线连回真实价格位
          ctx.strokeStyle = color; ctx.globalAlpha = 0.5;
          ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, y); ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        if (isB) { ctx.moveTo(x, y - 10); ctx.lineTo(x - 6, y); ctx.lineTo(x + 6, y); }
        else { ctx.moveTo(x, y + 10); ctx.lineTo(x - 6, y); ctx.lineTo(x + 6, y); }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.textAlign = 'center'; ctx.fillText(m.kind, x, isB ? y - 3 : y + 3); ctx.textAlign = 'left';
      });
    }

    // ===== 通达信多空能量副图 =====
    if (hasSub && sub) {
      // 值域：多能柱 + SD 线 + 0 轴
      let mx = 0;
      (sub.bars || []).forEach((b) => { mx = Math.max(mx, Math.abs(b.value)); });
      (sub.sd || []).forEach((v) => { if (v != null) mx = Math.max(mx, Math.abs(v)); });
      (sub.icons || []).forEach((ic) => { mx = Math.max(mx, Math.abs(ic.value)); });
      mx = mx || 1;
      const zeroY = subTop + subH / 2;
      const subY = (v: number) => zeroY - (v / mx) * (subH / 2 - 8);
      // 副图边框 + 标题 + 0 轴
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.strokeRect(padL, subTop, plotW, subH);
      ctx.beginPath(); ctx.moveTo(padL, zeroY); ctx.lineTo(W - padR, zeroY); ctx.stroke();
      ctx.fillStyle = '#8794a8'; ctx.font = '10px ui-monospace, monospace';
      ctx.fillText('多空能量', padL + 4, subTop + 9);
      ctx.fillStyle = '#f04b52'; ctx.fillText('多能', W - padR - 56, subTop + 9);
      ctx.fillStyle = '#22c55e'; ctx.fillText('空能', W - padR - 24, subTop + 9);
      // 多能/空能红绿柱（以 0 轴为基）
      (sub.bars || []).forEach((b) => {
        if (b.index < 0 || b.index >= n) return;
        const x = cx(b.index);
        const y = subY(b.value);
        ctx.fillStyle = b.color;
        ctx.globalAlpha = 0.55;
        if (b.kind === 'long') ctx.fillRect(x - bw / 2, y, bw, Math.max(1, zeroY - y));
        else ctx.fillRect(x - bw / 2, zeroY, bw, Math.max(1, y - zeroY));
        ctx.globalAlpha = 1;
      });
      // SD 四态变色线（分段，颜色来自 EME13 状态）
      const sdArr = sub.sd || [];
      ctx.lineWidth = 1.6;
      (sub.segments || []).forEach((seg) => {
        ctx.strokeStyle = seg.color;
        ctx.beginPath(); let pen = false;
        for (let i = Math.max(0, seg.start); i <= Math.min(n - 1, seg.end); i++) {
          const v = sdArr[i];
          if (v == null) { pen = false; continue; }
          const x = cx(i), y = subY(v);
          if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      ctx.lineWidth = 1;
      // 信号图标：小圆点为主；文字仅画最近 6 个，避免 60+ 标签铺满重叠
      const iconsAll = sub.icons || [];
      const recentStart = Math.max(0, n - Math.round(n * 0.18));
      const recentIcons = iconsAll.filter((ic) => ic.index >= recentStart);
      const labelSet = new Set(recentIcons.slice(-6).map((ic) => `${ic.index}-${ic.label}`));
      iconsAll.forEach((ic) => {
        if (ic.index < 0 || ic.index >= n) return;
        const x = cx(ic.index);
        const y = subY(ic.value) + (ic.value >= 0 ? 1 : -1) * 7;
        ctx.fillStyle = ic.color;
        ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
        if (labelSet.has(`${ic.index}-${ic.label}`)) {
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillText(ic.label, x + 4, y + 3);
        }
      });
      ctx.font = '10px ui-monospace, monospace';
      // 目标价标注
      if (sub.target_price != null) {
        ctx.fillStyle = '#e36ad6';
        ctx.fillText(`目标价 ${sub.target_price.toFixed(2)}  预期 ${((sub.expected_pct || 0) * 100).toFixed(1)}%`,
          padL + 4, subTop + subH - 5);
      }
    }

    // 日期刻度（等距 6 个）
    ctx.fillStyle = '#8794a8'; ctx.font = '10px ui-monospace, monospace';
    const tickCount = Math.min(6, n);
    for (let t = 0; t < tickCount; t++) {
      const i = tickCount === 1 ? 0 : Math.round((n - 1) * t / (tickCount - 1));
      const label = (candles[i]?.date || '').slice(5);
      const tx = Math.min(W - padR - 40, Math.max(padL, cx(i) - 18));
      ctx.fillText(label, tx, H - 10);
    }

    // 最新价标签（右侧轴常驻，红涨绿跌）
    const lastC = candles[n - 1];
    if (lastC) {
      const up = lastC.close >= lastC.open;
      const ly = priceY(lastC.close);
      ctx.setLineDash([2, 3]); ctx.strokeStyle = up ? UP : DOWN; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(W - padR, ly); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = up ? UP : DOWN;
      ctx.fillRect(W - padR + 1, ly - 9, padR - 3, 18);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.fillText(lastC.close.toFixed(2), W - padR + 4, ly);
    }

    // 悬停/锁定十字线 + 增强气泡（当日 MA/支撑/压力/涨跌幅/信号来源）
    const focus = pinned != null ? pinned : hover;
    if (focus != null && focus >= 0 && focus < n) {
      const c: KlineCandle = candles[focus];
      const x = cx(focus);
      ctx.strokeStyle = '#6b7a90'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padL, priceY(c.close)); ctx.lineTo(W - padR, priceY(c.close)); ctx.stroke();
      ctx.setLineDash([]);
      // 右轴高亮当前收盘价
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(W - padR + 1, priceY(c.close) - 9, padR - 3, 18);
      ctx.fillStyle = '#0b0f14'; ctx.font = 'bold 10px ui-monospace, monospace';
      ctx.fillText(c.close.toFixed(2), W - padR + 4, priceY(c.close));

      const prevClose = focus > 0 ? candles[focus - 1].close : c.open;
      const pct = prevClose ? (c.close - prevClose) / prevClose * 100 : 0;
      const lines: string[] = [
        `${c.date}  涨跌 ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
        `开${c.open} 高${c.high} 低${c.low} 收${c.close}`,
        `量${(c.volume / 1e4).toFixed(0)}万 额${((c.volume * c.close) / 1e8).toFixed(2)}亿`,
      ];
      // 当日指标值（通达信模式取 overlay，简单模式取基础 ma）
      const vals: string[] = [];
      const ma5v = ov ? (ov.lines || []).find((l) => l.key === 'ma5')?.data[focus] : (data.ma?.ma5 || [])[focus];
      const ma20v = ov ? (ov.lines || []).find((l) => l.key === 'ma20')?.data[focus] : (data.ma?.ma20 || [])[focus];
      if (ma5v != null) vals.push(`MA5 ${Number(ma5v).toFixed(2)}`);
      if (ma20v != null) vals.push(`MA20 ${Number(ma20v).toFixed(2)}`);
      if (lv?.entry_high != null) vals.push(`压力 ${lv.entry_high.toFixed(2)}`);
      if (lv?.stop_loss != null) vals.push(`止损 ${lv.stop_loss.toFixed(2)}`);
      if (vals.length) lines.push(vals.join(' '));
      // 多空能量副图当日读数
      const sb = data.subchart;
      if (showSub && sb) {
        const sv: string[] = [];
        const bar = (sb.bars || [])[focus];
        if (bar) sv.push(`${bar.kind === 'long' ? '多能' : '空能'} ${Math.abs(bar.value).toFixed(2)}`);
        const sdv = (sb.sd || [])[focus];
        const seg = (sb.segments || []).find((g) => focus >= g.start && focus <= g.end);
        const stateName: Record<string, string> = { xi: '跌中回升', la: '涨中走强', pai: '涨势放缓', luo: '跌势延续' };
        if (sdv != null) sv.push(`SD ${Number(sdv).toFixed(2)}${seg ? `(${stateName[seg.state] || seg.state})` : ''}`);
        const dayIcons = (sb.icons || []).filter((ic) => ic.index === focus).map((ic) => ic.label);
        if (dayIcons.length) sv.push(`⚑${dayIcons.slice(0, 2).join('/')}`);
        if (sv.length) lines.push(sv.join(' '));
      }
      // 当日信号来源
      const dayMarks = (data.marks || []).filter((m) => m.index === focus);
      const dayIcons = ov ? (ov.icons || []).filter((m) => m.index === focus && markFilter !== 'real') : [];
      if (dayMarks.length || dayIcons.length) {
        const src = [...dayMarks.map((m) => `${m.kind}·${m.label}`), ...dayIcons.map((m) => `${m.kind}·公式`)].slice(0, 3).join(' / ');
        lines.push(`⚑ ${src}`);
      }
      const boxW = 248, boxH = 14 * lines.length + 8;
      const bx = Math.min(W - padR - boxW - 4, x + 12 < W - padR - boxW ? x + 12 : x - boxW - 12);
      ctx.fillStyle = 'rgba(10,15,22,0.94)'; ctx.fillRect(Math.max(padL, bx), padT + 2, boxW, boxH);
      ctx.strokeStyle = '#334155'; ctx.strokeRect(Math.max(padL, bx), padT + 2, boxW, boxH);
      ctx.fillStyle = '#dbe4ef'; ctx.font = '10px ui-monospace, monospace';
      lines.forEach((t, k) => ctx.fillText(t, Math.max(padL, bx) + 6, padT + 15 + k * 14));
    }
  }, [data, hover, pinned, tdxMode, markFilter, showSub]);

  useEffect(() => {
    draw();
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data?.candles?.length || pinned != null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const padL = 8, padR = 66;
    const plotW = rect.width - padL - padR;
    const slot = plotW / data.candles.length;
    setHover(Math.max(0, Math.min(data.candles.length - 1, Math.floor((e.clientX - rect.left - padL) / slot))));
  };

  // 键盘左右移动光标（专业看盘习惯）：focus 位置随方向键平移
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pinned != null) { setPinned(null); return; }
      if (!data?.candles?.length) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const cur = pinned != null ? pinned : (hover != null ? hover : data.candles.length - 1);
      const next = Math.max(0, Math.min(data.candles.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1)));
      setPinned(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, hover, pinned]);

  return (
    <div className="rounded-2xl border border-subtle bg-card/70 shadow-soft-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="font-mono font-semibold text-foreground">{code}</span>
          <span className="text-sm text-secondary-text">{name || data?.name || ''}</span>
          {data?.as_of ? <span className="text-xs text-tertiary-text">截至 {data.as_of}</span> : null}
          {data?.levels?.action_label ? (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">
              决策：{data.levels.action_label}{data.levels.status === 'expired' ? '（已过期）' : ''}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setTdxMode((v) => !v)}
            className={`rounded px-2 py-0.5 text-xs transition-colors ${tdxMode ? 'bg-amber-500/20 text-amber-400' : 'text-secondary-text hover:bg-hover'}`}
            title="通达信主图公式复刻 / 简单均线">
            {tdxMode ? '通达信主图' : '简单均线'}
          </button>
          <button type="button"
            onClick={() => setMarkFilter((v) => v === 'real' ? 'all' : v === 'all' ? 'formula' : 'real')}
            className="rounded bg-slate-500/15 px-2 py-0.5 text-xs text-slate-300 hover:bg-hover"
            title="买卖点显示范围">
            信号：{markFilter === 'real' ? '决策' : markFilter === 'all' ? '全部' : '公式'}
          </button>
          <button type="button"
            onClick={() => setShowSub((v) => !v)}
            className={`rounded px-2 py-0.5 text-xs transition-colors ${showSub ? 'bg-emerald-500/20 text-emerald-400' : 'text-secondary-text hover:bg-hover'}`}
            title="多空能量副图">
            {showSub ? '副图:开' : '副图:关'}
          </button>
          {[60, 120, 250].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)}
              className={`rounded px-2 py-0.5 text-xs transition-colors ${days === d ? 'bg-accent/20 text-accent' : 'text-secondary-text hover:bg-hover'}`}>
              {d}日
            </button>
          ))}
          <button type="button" onClick={load} className="rounded px-2 py-0.5 text-xs text-secondary-text hover:bg-hover">刷新</button>
          {onClose ? (
            <button type="button" onClick={onClose} className="rounded px-2 py-0.5 text-sm text-secondary-text hover:bg-hover" title="关闭">✕</button>
          ) : null}
        </div>
      </div>

      {/* 图例：通达信模式显示公式线，简单模式显示基础线；真实标记始终显示 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-[11px]">
        {tdxMode ? (
          <>
            {TDX_LEGEND.map((l) => <span key={l.key} style={{ color: l.color }}>— {l.label}</span>)}
            <span className="text-amber-400">▮ 涨停</span>
            <span className="text-blue-400">▮ 跌停</span>
            {markFilter !== 'real' ? (
              <>
                <span className="text-red-300">▽ B(公式)</span>
                <span className="text-green-300">▽ S(公式)</span>
              </>
            ) : null}
          </>
        ) : (
          <>
            <span style={{ color: MA_COLORS.ma5 }}>— MA5</span>
            <span style={{ color: MA_COLORS.ma10 }}>— MA10</span>
            <span style={{ color: MA_COLORS.ma20 }}>— MA20</span>
            <span style={{ color: MA_COLORS.ma60 }}>— MA60</span>
          </>
        )}
        {markFilter !== 'formula' ? (
          <>
            <span className="text-red-400">▲ B</span>
            <span className="text-green-400">▼ S</span>
          </>
        ) : null}
        {showSub ? (
          <>
            <span className="text-red-400">▮ 多能</span>
            <span className="text-green-400">▮ 空能</span>
            <span className="text-amber-300">— SD</span>
          </>
        ) : null}
        {pinned != null ? <span className="text-accent">● 已锁定 Esc</span> : null}
      </div>

      {/* 无买卖点时给个切换入口，不解释数据来源，摆图即可。 */}
      {!loading && !error && data?.candles?.length && markFilter === 'real'
        && !(data.marks || []).length
        && ((data.overlay?.icons || []).length || (data.subchart?.bars || []).length) ? (
        <div className="mx-4 mt-2 text-xs text-tertiary-text">
          无买卖点 · <button type="button" className="text-sky-400 hover:underline"
            onClick={() => setMarkFilter('all')}>看公式信号</button>
        </div>
      ) : null}

      <div ref={wrapRef} className="relative h-[620px] w-full px-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-secondary-text">加载 K 线…</div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-red-400">
            <span>{error}</span>
            <button type="button" onClick={load} className="rounded border border-subtle px-3 py-1 text-xs hover:bg-hover">重试</button>
          </div>
        ) : !data?.candles?.length ? (
          <div className="flex h-full items-center justify-center text-sm text-secondary-text">
            {data?.note || '暂无 K 线数据'}
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="cursor-crosshair"
            onMouseMove={onMouseMove}
            onMouseLeave={() => setHover(null)}
            onClick={() => setPinned((p) => p == null ? hover : null)}
            title="移动查看读数 · 点击锁定 · ← → 逐日"
          />
        )}
      </div>

      {/* 决策区间 */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-subtle px-4 py-2 text-xs text-secondary-text">
        {data?.levels ? (
          <>
            <span>买入区 <b className="font-mono text-foreground">{data.levels.entry_low ?? '-'} ~ {data.levels.entry_high ?? '-'}</b></span>
            <span>止损 <b className="font-mono text-red-400">{data.levels.stop_loss ?? '-'}</b></span>
            <span>目标 <b className="font-mono text-green-400">{data.levels.target_price ?? '-'}</b></span>
            <span>信号日 {data.levels.as_of ?? '-'}</span>
          </>
        ) : null}
        {pinned != null && data?.candles?.[pinned] ? (
          <span className="text-accent">已锁定 {data.candles[pinned].date} 收 {data.candles[pinned].close}（点击图或按 Esc 解锁）</span>
        ) : null}
        {showSub && data?.subchart?.target_price != null ? (
          <span className="text-tertiary-text">副图目标价 <b className="font-mono text-foreground">{data.subchart.target_price.toFixed(2)}</b></span>
        ) : null}
      </div>

      {/* 信号明细表：真实(擒龙/决策) + 公式(ZIG)，点击定位到该日读数 */}
      {(() => {
        type Row = { index: number; date: string; kind: 'B' | 'S'; price: number; label: string; source: string; real: boolean };
        const realRows: Row[] = (data?.marks || []).map((m) => ({
          index: m.index, date: m.date, kind: m.kind, price: m.price,
          label: m.label, source: m.source === 'dragon' ? '擒龙' : '决策', real: true,
        }));
        const formulaRows: Row[] = tdxMode && markFilter !== 'real'
          ? (data?.overlay?.icons || []).map((m) => ({
              index: m.index,
              date: data?.candles?.[m.index]?.date || '',
              kind: m.kind, price: m.price, label: m.label,
              source: m.source === 'formula_speed' ? '涨速见顶' : `ZIG${m.unconfirmed ? '(未确认)' : ''}`,
              real: false,
            }))
          : [];
        const rows = [...realRows, ...formulaRows].sort((a, b) => a.index - b.index);
        if (!rows.length) return null;
        return (
          <div className="border-t border-subtle px-4 py-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="label-uppercase">买卖点明细（点击定位 · 共 {rows.length} 个）</span>
              {pinned != null ? <button type="button" onClick={() => setPinned(null)} className="text-xs text-secondary-text hover:text-foreground">取消锁定</button> : null}
            </div>
            <div className="max-h-28 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card/95 text-secondary-text">
                  <tr className="text-left">
                    <th className="py-1 pr-2 font-normal">日期</th>
                    <th className="py-1 pr-2 font-normal">信号</th>
                    <th className="py-1 pr-2 text-right font-normal">价格</th>
                    <th className="py-1 pr-2 font-normal">来源</th>
                    <th className="py-1 font-normal">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, k) => (
                    <tr
                      key={`${r.source}-${r.index}-${k}`}
                      onClick={() => setPinned(pinned === r.index ? null : r.index)}
                      className={`cursor-pointer border-t border-subtle/50 hover:bg-hover ${pinned === r.index ? 'bg-accent/10' : ''}`}
                    >
                      <td className="py-1 pr-2 font-mono text-secondary-text">{r.date}</td>
                      <td className="py-1 pr-2">
                        <span className={r.kind === 'B' ? (r.real ? 'font-bold text-red-400' : 'text-red-300') : (r.real ? 'font-bold text-green-400' : 'text-green-300')}>
                          {r.kind === 'B' ? '▲买' : '▼卖'}
                        </span>
                      </td>
                      <td className="py-1 pr-2 text-right font-mono text-foreground">{r.price.toFixed(2)}</td>
                      <td className="py-1 pr-2">
                        <span className={r.real ? 'text-accent' : 'text-amber-500/80'}>{r.source}</span>
                      </td>
                      <td className="py-1 text-secondary-text">{r.label}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
      {tdxMode && data?.overlay?.legend_note ? (
        <div className="border-t border-subtle px-4 py-2 text-[11px] leading-relaxed text-amber-500/80">
          ⚠ ZIG 与压力线含未来函数，仅供复盘参考
        </div>
      ) : null}
    </div>
  );
};
