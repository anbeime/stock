import type React from 'react';
import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppPage, PageHeader } from '../components/common';
import { KlineChart } from '../components/quant/KlineChart';

/**
 * 独立 K 线页：给出可直接打开/分享的固定链接。
 *  - /kline/300085          路径参数形式
 *  - /kline?code=300085     查询参数形式
 * 代码支持带后缀（300085.SZ / sz300085），统一清洗为 6 位数字。
 */
const KlinePage: React.FC = () => {
  const { code: paramCode } = useParams<{ code: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const code = useMemo(() => {
    const raw = paramCode || searchParams.get('code') || searchParams.get('kline') || '';
    const digits = String(raw).replace(/[^0-9]/g, '');
    return digits.length >= 6 ? digits.slice(0, 6) : '';
  }, [paramCode, searchParams]);

  const name = searchParams.get('name') || undefined;

  return (
    <AppPage>
      <div className="space-y-4">
        <PageHeader
          eyebrow="知易 Antinet · 个股行情"
          title={code ? `K 线 · ${code}${name ? ` ${name}` : ''}` : 'K 线行情'}
          description="通达信主图指标 · 买卖点标记 · 多空能量副图"
          actions={(
            <button
              type="button"
              className="btn-secondary"
              onClick={() => navigate('/quant')}
            >
              返回量化面板
            </button>
          )}
        />
        {code ? (
          <KlineChart code={code} name={name} />
        ) : (
          <div className="rounded-lg border border-subtle bg-elevated/30 p-8 text-center text-sm text-secondary-text">
            请在链接中提供 6 位股票代码，例如 <code className="font-mono text-foreground">/kline/300085</code>
            {' '}或前往 <button type="button" className="text-cyan hover:underline" onClick={() => navigate('/quant')}>量化面板</button> 的「K 线速览」输入代码。
          </div>
        )}
      </div>
    </AppPage>
  );
};

export default KlinePage;
