// 板块龙头联动：把「板块领涨股」映射为 code -> 板块标签列表。
// 模块级缓存 + in-flight 去重：多个信号组件同时挂载，只发一次 sector-board 请求。
// 失败返回空 Map，绝不阻断现有信号流。
import { useEffect, useState } from 'react';
import { quantApi } from '../api/quant';
import type { SectorBoardSnapshot } from '../types/quant';

const TTL = 60_000;
let cache: { map: SectorLeaderMap; ts: number } | null = null;
let inflight: Promise<SectorLeaderMap> | null = null;

export interface SectorLeaderInfo {
  sectors: string[]; // e.g. ["行业板块·集成电路制造", "概念板块·大基金持股"]
}
export type SectorLeaderMap = Map<string, SectorLeaderInfo>;

/** 统一代码格式：仅保留数字、补前导零到 6 位（防 f140 返回 int 丢零导致对不上） */
export function normCode(c: unknown): string {
  const s = String(c ?? '').replace(/\D/g, '');
  return s ? s.padStart(6, '0') : '';
}

export function buildMap(snap: SectorBoardSnapshot): SectorLeaderMap {
  const map: SectorLeaderMap = new Map();
  for (const sec of Object.values(snap.sections ?? {})) {
    if (!sec) continue;
    const label = sec.label ?? '';
    for (const row of [...(sec.gainers ?? []), ...(sec.losers ?? [])]) {
      const code = normCode(row.leader_code);
      if (!code || !row.leader) continue;
      const info = map.get(code) ?? { sectors: [] };
      const tag = `${label}·${row.name}`;
      if (!info.sectors.includes(tag)) info.sectors.push(tag);
      map.set(code, info);
    }
  }
  return map;
}

function fetchLeaders(): Promise<SectorLeaderMap> {
  if (cache && Date.now() - cache.ts < TTL) return Promise.resolve(cache.map);
  if (inflight) return inflight;
  inflight = quantApi.getSectorBoard()
    .then((snap) => {
      const map = buildMap(snap);
      cache = { map, ts: Date.now() };
      return map;
    })
    .catch(() => new Map<string, SectorLeaderInfo>()) // 板块数据失败 → 空映射，信号流照常
    .finally(() => { inflight = null; });
  return inflight;
}

/** 取板块龙头映射（模块级 60s 缓存，组件间共享） */
export function useSectorLeaders(): SectorLeaderMap {
  const [map, setMap] = useState<SectorLeaderMap>(() => cache?.map ?? new Map());
  const [, force] = useState(0);
  useEffect(() => {
    fetchLeaders().then((m) => {
      setMap(m);
      force((x) => x + 1); // 保证 Map 内容原地更新时也重渲染
    });
  }, []);
  return map;
}

/** 查某代码是否为板块领涨股 */
export function leaderInfoFor(map: SectorLeaderMap, code: unknown): SectorLeaderInfo | null {
  return map.get(normCode(code)) ?? null;
}
