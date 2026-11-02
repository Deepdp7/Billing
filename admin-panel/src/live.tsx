import { useEffect, useRef, useState } from 'react';
import { session } from './api';

type Notice = { id: number; title: string; message: string };

/**
 * Keeps the open console in step with the license server.
 * Customer actions raise a notice. Every action, from either side, reloads the page that is open.
 */
export function LiveFeed({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  useEffect(() => {
    let stopped = false;
    let ctrl: AbortController | null = null;
    let refreshTimer = 0;
    const drop = (id: number) => setNotices((list) => list.filter((n) => n.id !== id));

    const push = (title: string, message: string) => {
      const id = Date.now() + Math.random();
      setNotices((list) => [...list.slice(-3), { id, title, message }]);
      window.setTimeout(() => drop(id), 7000);
    };

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => window.dispatchEvent(new Event('apna:admin-refresh')), 200);
    };

    const read = async (token: string) => {
      ctrl = new AbortController();
      const res = await fetch('/api/admin/v1/live', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: ctrl.signal,
      });
      if (res.status === 401) {
        session.clear();
        unauthorized.current();
        return;
      }
      if (!res.ok || !res.body) throw new Error('live');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          idx = buf.indexOf('\n\n');
          if (!block.includes('event: activity')) continue;
          const line = block.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          try {
            const data = JSON.parse(line.slice(5).trim()) as { title?: string; message?: string; notify?: boolean };
            scheduleRefresh();
            if (data.notify && data.title) push(data.title, data.message || '');
          } catch {
            scheduleRefresh();
          }
        }
      }
    };

    const loop = async () => {
      let wait = 1000;
      while (!stopped) {
        const token = session.get();
        if (!token) return;
        try {
          await read(token);
          wait = 1000;
        } catch {
          if (stopped) return;
          wait = Math.min(wait * 2, 15000);
        }
        await new Promise((r) => setTimeout(r, wait));
      }
    };
    void loop();
    return () => {
      stopped = true;
      ctrl?.abort();
      window.clearTimeout(refreshTimer);
    };
  }, []);

  if (notices.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {notices.map((n) => (
        <div key={n.id} className="rounded-xl border border-indigo-200 bg-white px-3 py-2.5 shadow-lg dark:border-indigo-500/40 dark:bg-slate-900 dark:shadow-black/40">
          <div className="text-xs font-bold text-slate-900 dark:text-white">{n.title}</div>
          <div className="mt-0.5 text-[11px] leading-snug text-slate-600 dark:text-slate-300">{n.message}</div>
        </div>
      ))}
    </div>
  );
}
