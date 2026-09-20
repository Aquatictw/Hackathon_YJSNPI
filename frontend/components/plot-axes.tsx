'use client';

import { useId, type ReactNode } from 'react';
import { useLocale } from '@/components/locale-provider';
import './plot-axes.css';

// HTML titles stay readable and wrap independently of the SVG viewBox at zoom
// and narrow widths. Source unit metadata does not establish calibrated units.
export function PlotAxes({ children, perSite = false, metric = 'measurement', unit }: {
  children: ReactNode;
  perSite?: boolean;
  metric?: 'measurement' | 'yield' | 'coverage';
  unit?: string | null;
}) {
  const { locale } = useLocale();
  const id = useId();
  const zh = locale === 'zh-TW';
  const x = perSite
    ? (zh ? '各測試站內已完成元件順序（非時間）' : 'Completed-device order within each site (not time)')
    : (zh ? '已完成元件順序（非時間）' : 'Completed-device order (not time)');
  const y = metric === 'yield'
    ? (zh ? '累積良率（%）' : 'Cumulative yield (%)')
    : metric === 'coverage'
      ? (zh ? '特徵涵蓋率（比例，0–1）' : 'Feature coverage (ratio, 0–1)')
      : (zh ? '量測值' : 'Measurement value');
  const suppliedUnit = metric === 'measurement' && unit?.trim();
  return <div className="plot-axes" role="group" aria-labelledby={`${id}-y ${id}-x`}>
    <p className="plot-axis-title plot-axis-title--y" id={`${id}-y`}>
      <strong>{zh ? 'Y 軸' : 'Y axis'}</strong> · {y}
      {suppliedUnit && <span> · {zh ? '來源單位標記：' : 'Source unit label: '}{suppliedUnit}</span>}
    </p>
    <div className="plot-axes__viewport" role="region" tabIndex={0} aria-labelledby={`${id}-y ${id}-x`}>{children}</div>
    <p className="plot-axis-title plot-axis-title--x" id={`${id}-x`}>
      <strong>{zh ? 'X 軸' : 'X axis'}</strong> · {x}
    </p>
  </div>;
}
