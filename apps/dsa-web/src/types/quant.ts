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
