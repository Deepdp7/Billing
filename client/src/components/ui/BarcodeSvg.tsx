import React, { useMemo } from 'react';
import { code128 } from '../../lib/code128.js';

/** A real, scannable Code 128 barcode drawn as crisp vector bars. */
export const BarcodeSvg: React.FC<{ value: string; className?: string }> = ({ value, className }) => {
  const widths = useMemo(() => code128(value), [value]);
  const quiet = 8;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  return (
    <svg viewBox={`0 0 ${total} 40`} preserveAspectRatio="none" shapeRendering="crispEdges" className={className} aria-label={value}>
      {widths.map((w, i) => {
        const bar = i % 2 === 0 ? <rect key={i} x={x} y={0} width={w} height={40} fill="#000" /> : null;
        x += w;
        return bar;
      })}
    </svg>
  );
};
