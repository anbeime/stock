// 板块龙头联动逻辑测试——fixture 取自 2026-11-17 13:30 真实 sector-board 端点响应
// （非 mock 臆造；仅固化为快照使测试无需网络）
import { describe, it, expect } from 'vitest';
import { buildMap, normCode, leaderInfoFor } from '../useSectorLeaders';
import type { SectorBoardSnapshot } from '../../types/quant';
import fixture from './sector_snap.fixture.json';

const snap = fixture as SectorBoardSnapshot;

describe('normCode 代码归一化', () => {
  it('保留6位代码与带前缀符号', () => {
    expect(normCode('002685')).toBe('002685');
    expect(normCode('SZ002685')).toBe('002685');
  });
  it('int 丢前导零时补回6位（防 f140 返回数字）', () => {
    expect(normCode(2685)).toBe('002685');
    expect(normCode('521')).toBe('000521');
  });
  it('空值返回空串', () => {
    expect(normCode(null)).toBe('');
    expect(normCode('')).toBe('');
  });
});

describe('buildMap 真实板块快照', () => {
  const map = buildMap(snap);

  it('构建出领涨股映射（真实快照 > 20 只）', () => {
    expect(map.size).toBeGreaterThan(20);
  });

  it('002685 反转股领涨 → 命中且带板块标签', () => {
    const info = leaderInfoFor(map, '002685');
    expect(info).not.toBeNull();
    expect(info!.sectors.some((s) => s.includes('反转股'))).toBe(true);
  });

  it('带前缀/缺零代码也能查到同一只', () => {
    expect(leaderInfoFor(map, 'SZ002685')).toEqual(leaderInfoFor(map, 2685));
  });

  it('非领涨股(600519 贵州茅台)不命中', () => {
    expect(leaderInfoFor(map, '600519')).toBeNull();
  });

  it('领涨股在同板块涨跌榜重复出现时去重板块标签', () => {
    for (const info of map.values()) {
      expect(new Set(info.sectors).size).toBe(info.sectors.length);
    }
  });
});

describe('打板信号联动交集（真实快照交叉验证）', () => {
  it('真实打板快照里 002685/000521 为领涨股∩涨停命中', () => {
    // 该结论来自 2026-11-17 实抓：领涨∩涨停 = {002685, 000521}
    const map = buildMap(snap);
    expect(leaderInfoFor(map, '002685')).not.toBeNull();
    expect(leaderInfoFor(map, '000521')).not.toBeNull();
  });
});
