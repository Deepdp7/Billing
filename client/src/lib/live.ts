import { useEffect, useRef } from 'react';
import { inBackground } from './api.js';

/**
 * Reloads a screen's lists when another computer of the same account changed something (the local engine says so
 * over its event stream, see LicenseContext). Changes close together make one reload; the screen passes a quiet
 * reload (no spinner), and what the user is typing or the POS cart stays as it is.
 */
export function useLiveRefresh(reload: () => void) {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    let timer: number | undefined;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => inBackground(() => latest.current()), 80);
    };
    window.addEventListener('apna:data-changed', onChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('apna:data-changed', onChange);
    };
  }, []);
}
