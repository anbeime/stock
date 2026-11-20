/**
 * Stock search suggestion list.
 */

import type { CSSProperties, MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { CandlestickChart } from 'lucide-react';
import type { StockSuggestion } from '../../types/stockIndex';
import { Badge } from '../common';
import { cn } from '../../utils/cn';
import { normalizeStockCode } from '../../utils/stockCode';

export interface SuggestionsListProps {
  /** Suggestion list */
  suggestions: StockSuggestion[];
  /** Highlighted index */
  highlightedIndex: number;
  /** Selection callback */
  onSelect: (suggestion: StockSuggestion) => void;
  /** Mouse hover callback */
  onMouseEnter: (index: number) => void;
  /** Custom style (for Portal fixed positioning) */
  style?: CSSProperties;
}

export function SuggestionsList({
  suggestions,
  highlightedIndex,
  onSelect,
  onMouseEnter,
  style,
}: SuggestionsListProps) {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <ul
      id="suggestions-list"
      className="z-[100] border-x border-b rounded-b-lg rounded-t-none max-h-60 overflow-auto"
      style={{
        ...style,
        backgroundColor: 'hsl(var(--card) / 0.85)',
        borderColor: 'var(--border-accent)',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.3), -4px 0 15px -3px rgba(0, 0, 0, 0.2), 4px 0 15px -3px rgba(0, 0, 0, 0.2)',
      }}
      role="listbox"
    >
      {suggestions.map((suggestion, index) => {
        // K 线数据源只覆盖 A 股/北交所 6 位代码；港美日韩等市场不展示入口。
        const klineCode = normalizeStockCode(suggestion.canonicalCode);
        const canOpenKline = (suggestion.market === 'CN' || suggestion.market === 'BSE')
          && /^\d{6}$/.test(klineCode);
        return (
          <li
            key={suggestion.canonicalCode}
            role="option"
            aria-selected={index === highlightedIndex}
            className={cn(
              'px-4 py-1 cursor-pointer flex items-center justify-between gap-2',
              'hover:bg-[var(--autocomplete-hover-bg)]/25',
              index === highlightedIndex && 'bg-[var(--autocomplete-hover-bg)]/25',
            )}
            onClick={() => onSelect(suggestion)}
            onMouseEnter={() => onMouseEnter(index)}
          >
            <div className="flex items-center gap-3">
              <MarketBadge market={suggestion.market} />

              <div className="flex flex-col">
                <span className="text-sm font-medium text-primary-text">
                  {suggestion.nameZh}
                </span>
                <span className="text-sm text-secondary-text">
                  {suggestion.displayCode}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {canOpenKline ? (
                <Link
                  to={`/kline/${klineCode}?name=${encodeURIComponent(suggestion.nameZh)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`查看 ${klineCode} 的 K 线（新标签页）`}
                  aria-label={`查看 ${klineCode} 的 K 线`}
                  className="shrink-0 rounded p-1 text-cyan transition-colors hover:bg-cyan/10"
                  onClick={(e: MouseEvent) => e.stopPropagation()}
                  onMouseEnter={(e: MouseEvent) => e.stopPropagation()}
                >
                  <CandlestickChart className="h-4 w-4" aria-hidden="true" />
                </Link>
              ) : null}
              <MatchTypeBadge matchType={suggestion.matchType} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const MARKET_BADGE_CONFIG = {
  CN: { label: 'A股', className: 'border-danger/25 bg-danger/10 text-danger' },
  HK: { label: '港股', className: 'border-success/25 bg-success/10 text-success' },
  US: { label: '美股', className: 'border-cyan/25 bg-cyan/10 text-cyan' },
  JP: { label: '日股', className: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-500' },
  KR: { label: '韩股', className: 'border-rose-500/25 bg-rose-500/10 text-rose-500' },
  INDEX: { label: '指数', className: 'border-purple/25 bg-purple/10 text-purple' },
  ETF: { label: 'ETF', className: 'border-warning/25 bg-warning/10 text-warning' },
  BSE: { label: '北交所', className: 'border-orange-500/25 bg-orange-500/10 text-orange-500' },
} as const;

function MarketBadge({ market }: { market: string }) {
  const config = MARKET_BADGE_CONFIG[market as keyof typeof MARKET_BADGE_CONFIG];

  if (!config) {
    throw new Error(`Unsupported market in stock suggestion: ${market}`);
  }

  return (
    <Badge variant="default" size="sm" className={cn('min-w-[3rem] justify-center shadow-none', config.className)}>
      {config.label}
    </Badge>
  );
}

function MatchTypeBadge({ matchType }: { matchType: string }) {
  const configMap = {
    exact: { label: '精确', className: 'border-cyan/25 bg-cyan/10 text-cyan' },
    prefix: { label: '前缀', className: 'border-purple/25 bg-purple/10 text-purple' },
    contains: { label: '包含', className: 'border-warning/25 bg-warning/10 text-warning' },
    fuzzy: { label: '模糊', className: 'border-border/55 bg-elevated/75 text-muted-text' },
  };

  const config = configMap[matchType as keyof typeof configMap] || configMap.fuzzy;

  return (
    <Badge variant="default" size="sm" className={cn('shrink-0 shadow-none', config.className)}>
      {config.label}
    </Badge>
  );
}

export default SuggestionsList;
