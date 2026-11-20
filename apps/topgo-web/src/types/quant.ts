// Antinet 量化融合 —— 前端类型定义
// 与后端 quant_endpoint.py 的 /api/v1/quant/* 响应对齐。

export interface QuantSignal {
  code: string;
  name: string;
  strategy: string;
  signal_date?: string | null;
  ref_close?: number | null;
  weight_pct?: number | null;
  stop_loss_pct?: number | null;
  liq_rank_pct?: number | null;
  strength?: number | null;
  dragon_score?: number | null;
  dragon_gate?: string | null;
  sentiment?: number | null;
  from_news?: string | null;
  news_confirmed?: string | null;
  note?: string | null;
}

export interface QuantStatus {
  as_of: string | null;
  market_up: boolean | null;
  dragon_gate_enabled: boolean | null;
  universe_size?: number | null;
  liquidity_kept?: number | null;
  selected?: number | null;
  core_n?: number | null;
  satellite_n?: number | null;
  ticket?: string | null;
  elapsed_sec?: number | null;
}

export interface DsaDecisionSignal {
  id: number;
  stock_code: string;
  stock_name: string;
  market?: string | null;
  action?: string | null;
  action_label?: string | null;
  confidence?: number | null;
  score?: number | null;
  reason?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface QuantSignalsResponse {
  as_of: string | null;
  signals: QuantSignal[];
  summary: Record<string, unknown>;
}

export interface DsaDecisionResponse {
  source: string;
  available: boolean;
  signals: DsaDecisionSignal[];
  reason?: string;
}

export interface MergedSignals {
  technical: QuantSignalsResponse;
  dsa_decision: DsaDecisionResponse;
}

export interface PushQmtResponse {
  ok: boolean;
  as_of: string | null;
  log: string[];
  last_sign_line?: string;
}

// ---- 超短打板复盘（扣子导出包接口契约复用，东财 push2ex 真实数据） ----
export interface DragonTierStock {
  code: string;
  name: string;
  first_seal: string;
  broken: number;
  industry: string;
  amount_yi: number;
}

export interface DragonIndustryHeat {
  industry: string;
  limit_up_count: number;
}

// 雪球人气实时榜（当日展示，不参与回测/信号流）
export interface XueqiuHotStock {
  rank: number;
  code: string;
  symbol: string;
  name: string;
  heat: number;
  heat_change: number;
  rank_change: number; // >0 排名上升
  pct: number;
  price: number;
}

export interface DragonBoardSnapshot {
  ok: boolean;
  date: string | null;
  fetched_at: string | null;
  source: string;
  caveat: string;
  counts: {
    limit_up: number;
    broken: number;
    strong: number;
    early_seal: number;
  };
  tiers: Record<string, DragonTierStock[]>;
  industry_heat: DragonIndustryHeat[];
  limit_up_stocks: Array<{
    code: string; name: string; price: number | null; pct: number;
    limit_count: number; first_seal: string; industry: string; amount_yi: number;
  }>;
  broken_stocks: Array<{
    code: string; name: string; pct: number; broken: number;
    industry: string; first_seal: string;
  }>;
  early_seal_stocks: Array<{
    code: string; name: string; first_seal: string;
    limit_count: number; industry: string;
  }>;
  hot_stocks: XueqiuHotStock[];
  hot_error: string | null;
  hot_fetched_at: string | null;
  hot_source: string;
  errors?: Record<string, string>;
  error?: string;
}

// ---- 概念/行业板块行情（东财 push2 clist 真实数据） ----
export interface SectorStock {
  code: string;
  name: string;
  pct: number;
  up_count: number;
  down_count: number;
  leader: string;
  leader_code: string;
}

export interface SectorSection {
  label: string;
  total: number;
  gainers: SectorStock[];
  losers: SectorStock[];
}

export interface SectorBoardSnapshot {
  ok: boolean;
  fetched_at: string | null;
  source: string;
  caveat: string;
  sections: {
    industry: SectorSection;
    concept: SectorSection;
  };
  errors?: Record<string, string>;
  error?: string;
}

// ---- K 线图表聚合（/api/v1/quant/chart/{code}，零新增依赖，真实数据） ----
export interface KlineCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface KlineMark {
  kind: 'B' | 'S';
  date: string;
  index: number;
  price: number;
  label: string;
  source: 'dsa_decision' | 'dragon';
}

export interface KlineLevels {
  entry_low: number | null;
  entry_high: number | null;
  stop_loss: number | null;
  target_price: number | null;
  action: string | null;
  action_label: string | null;
  status: string | null;
  as_of: string | null;
}

export interface ChartData {
  ok: boolean;
  code: string;
  name?: string | null;
  as_of?: string;
  count?: number;
  candles: KlineCandle[];
  ma: { ma5?: (number|null)[]; ma10?: (number|null)[]; ma20?: (number|null)[]; ma60?: (number|null)[] };
  marks: KlineMark[];
  levels: KlineLevels | null;
  overlay?: ChartOverlay;
  subchart?: ChartSubchart;
  note?: string;
  error?: string;
}

// ---- 通达信主图指标叠加（tdx_overlay.py，未来函数已标注） ----
export interface TdxLine {
  key: string;
  color: string;
  width: number;
  data: (number | null)[];
}
export interface TdxBar { index: number; kind: 'limit_up' | 'limit_down'; y1: number; y2: number; color: string; }
export interface TdxIcon {
  index: number; kind: 'B' | 'S'; price: number; label: string;
  source: string; unconfirmed?: boolean;
}
export interface TdxSegment {
  x1: number; y1: number; x2: number; y2: number;
  color: string; dash: boolean; label: string;
}
export interface TdxText { index: number; price: number; text: string; color: string; }
export interface ChartOverlay {
  lines?: TdxLine[];
  bars?: TdxBar[];
  icons?: TdxIcon[];
  segments?: TdxSegment[];
  texts?: TdxText[];
  note?: string;
  legend_note?: string;
}

// ---- 通达信多空能量副图（tdx_subchart.py，公式技术信号） ----
export interface SubchartBar { index: number; value: number; kind: 'long' | 'short'; color: string; }
export interface SubchartSegment { start: number; end: number; state: 'xi' | 'la' | 'pai' | 'luo'; color: string; }
export interface SubchartIcon { index: number; value: number; label: string; color: string; source: string; }
export interface ChartSubchart {
  bars?: SubchartBar[];
  sd?: (number | null)[];
  sk?: (number | null)[];
  segments?: SubchartSegment[];
  icons?: SubchartIcon[];
  target_price?: number | null;
  expected_pct?: number | null;
  note?: string;
}
