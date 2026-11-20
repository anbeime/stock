import type React from 'react';
import { Crown } from 'lucide-react';
import type { SectorLeaderInfo } from '../../hooks/useSectorLeaders';

/** 板块龙头徽标：命中的信号行显示，所属板块用 sr-only 供读屏器获取 */
export const SectorLeaderBadge: React.FC<{ info: SectorLeaderInfo | null }> = ({ info }) => {
  if (!info) return null;
  return (
    <span
      className="ml-1.5 inline-flex items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 align-middle"
    >
      <Crown size={10} /> 板块龙头
      <span className="sr-only">领涨板块：{info.sectors.join(' / ')}</span>
    </span>
  );
};

/** 命中行的淡金高亮 class（A股语境：强势=暖色，不干扰红涨绿跌） */
export const LEADER_ROW_CLASS = 'bg-amber-400/[0.07] hover:bg-amber-400/[0.12]';
