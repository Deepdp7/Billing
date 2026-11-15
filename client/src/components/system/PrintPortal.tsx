import React from 'react';
import { createPortal } from 'react-dom';

/**
 * What gets printed (and saved as PDF): a copy of `children` placed straight under <body>, hidden on screen. While it
 * is mounted, printing shows only it, at its natural height — never clipped to the window, so long bills and many
 * sticker sheets print in full.
 */
export const PrintPortal: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  createPortal(<div className="print-portal">{children}</div>, document.body);
