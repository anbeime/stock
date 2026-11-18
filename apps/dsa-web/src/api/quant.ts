// Antinet 量化融合 —— 前端 API 客户端
// 复用 TOPGO 的 axios 实例（自动带 API_BASE_URL / 凭证 / 401 跳转）。
import apiClient from './index';
import type {
  MergedSignals,
  QuantStatus,
  QuantSignalsResponse,
  DsaDecisionResponse,
  PushQmtResponse,
  DragonBoardSnapshot,
  SectorBoardSnapshot,
} from '../types/quant';

export const quantApi = {
  async getMerged(): Promise<MergedSignals> {
    const { data } = await apiClient.get<MergedSignals>('/api/v1/quant/merged');
    return data;
  },
  async getStatus(): Promise<QuantStatus> {
    const { data } = await apiClient.get<QuantStatus>('/api/v1/quant/status');
    return data;
  },
  async getSignals(): Promise<QuantSignalsResponse> {
    const { data } = await apiClient.get<QuantSignalsResponse>('/api/v1/quant/signals');
    return data;
  },
  async getDecisionSignals(limit = 50): Promise<DsaDecisionResponse> {
    const { data } = await apiClient.get<DsaDecisionResponse>('/api/v1/quant/decision-signals', {
      params: { limit },
    });
    return data;
  },
  async pushQmt(regenerate = false): Promise<PushQmtResponse> {
    const { data } = await apiClient.post<PushQmtResponse>('/api/v1/quant/push-qmt', {
      regenerate,
    });
    return data;
  },
  async getDragonBoard(date?: string): Promise<DragonBoardSnapshot> {
    const { data } = await apiClient.get<DragonBoardSnapshot>('/api/v1/quant/dragon-board', {
      params: date ? { date } : undefined,
    });
    return data;
  },
  async getSectorBoard(): Promise<SectorBoardSnapshot> {
    const { data } = await apiClient.get<SectorBoardSnapshot>('/api/v1/quant/sector-board');
    return data;
  },
};
