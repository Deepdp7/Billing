import React, { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** A QR code drawn as one SVG path: sharp at any size, on screen, in the PDF and on paper (thermal printers too). */
export const QrSvg: React.FC<{ value: string; className?: string; color?: string }> = ({ value, className, color = '#000' }) => {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return { size: n + 4, path: d };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill={color} />
    </svg>
  );
};
