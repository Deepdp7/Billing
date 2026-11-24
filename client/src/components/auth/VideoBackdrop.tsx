import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LOGIN_MEDIA_URL, LOGIN_TIMING, type LoginClip } from '../../lib/loginMedia.js';
import type { StoryStore } from './loginStory.js';

/**
 * The sign-in screen's full-screen background: the shop clips cross-fading with a slow zoom. The same player and timing
 * as the PLRMS sign-in page (plrms-demo/src/components/layout/LoginHero.tsx), which plays smoothly on every PC:
 *  - every clip is exactly clipMs long and plays once; the next one fades in over the last fadeMs, so the next shot is
 *    already moving while this one ends: nothing freezes on a last frame and nothing loops;
 *  - only the visible clip decodes; the next one starts loading once the visible one can play through, and the switch
 *    waits for it (never fades into black on a slow start);
 *  - a hidden or minimised window freezes everything where it is (clip, zoom and bar) and carries on from the same frame
 *    on return; a snapshot of that frame covers the clip until it really shows it again (a restarted decoder would show
 *    black and replay the last second);
 *  - "reduce motion" or a data-saver setting shows the still pictures; a clip that cannot play shows its picture.
 */

function useMedia(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}

/** Data-saver browsers get the still posters instead of video. */
const saveData = Boolean((navigator as any).connection?.saveData);

export const VideoBackdrop: React.FC<{ clips: LoginClip[]; story: StoryStore }> = ({ clips, story }) => {
  const { clipMs, fadeMs, showMs } = LOGIN_TIMING;
  const still = useMedia('(prefers-reduced-motion: reduce)') || saveData || clips.length === 0;
  const [index, setIndex] = useState(0);
  // the clip fading out: it keeps playing and zooming until the fade ends
  const [prev, setPrev] = useState(-1);
  // read by the delayed reset below and by the visibility handler, which run outside a render
  const indexRef = useRef(index);
  indexRef.current = index;
  const prevRef = useRef(prev);
  prevRef.current = prev;
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  // A snapshot of the exact frame on screen, laid over the clip while the window is away and until the clip has drawn
  // that same moment again (see the top).
  const frames = useRef<(HTMLCanvasElement | null)[]>([]);
  const resumeAt = useRef<number | null>(null);
  const [frozen, setFrozen] = useState(false);
  // bumped each time the window hides, so a watcher from an earlier return does nothing
  const epoch = useRef(0);
  // clips that could not play: their still picture is shown instead
  const [broken, setBroken] = useState<ReadonlySet<number>>(() => new Set());

  // The words and bars follow the shop on screen, and stop with the picture
  useEffect(() => { story.set(index); }, [index, story]);
  useEffect(() => { story.pause(hidden || frozen); }, [hidden, frozen, story]);

  // A hidden window (or minimised one) freezes the slideshow where it is: the clip, its zoom and the bar all pause
  // together and carry on from the same frame on return, so nothing skips, restarts or shows black.
  useEffect(() => {
    const onVis = () => {
      const away = document.visibilityState === 'hidden';
      if (away) {
        epoch.current++;
        const i = indexRef.current;
        const v = videos.current[i];
        const c = frames.current[i];
        // Away again before the clip came back: the snapshot that is up is still the picture to return to.
        if (v && c && c.hidden && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && v.videoWidth) {
          try {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            c.getContext('2d')?.drawImage(v, 0, 0);
            resumeAt.current = v.currentTime;
            c.hidden = false;
          } catch { /* no snapshot: the clip just carries on */ }
        }
        if (c && !c.hidden) setFrozen(true);
      }
      setHidden(away);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Next shot showMs after the current clip really starts moving, but never onto a clip that has not loaded yet: on a
  // slow start it would fade in black.
  useEffect(() => {
    if (still || hidden || frozen || clips.length < 2) return;
    const cleanups: (() => void)[] = [];
    const current = videos.current[index];
    const advance = () => {
      setPrev(index);
      setIndex((index + 1) % clips.length);
    };
    const nextIndex = (index + 1) % clips.length;
    const next = videos.current[nextIndex];
    let moved = false;
    const go = () => { if (!moved) { moved = true; advance(); } };
    const begin = () => {
      const left = showMs - (current?.currentTime ?? 0) * 1000;
      // 3 s before the switch the next clip is loaded again from its start. A clip that played a round ago was rewound,
      // and the browser puts an idle player to sleep while it still says "ready": it would only wake at the switch and
      // leave this clip standing on its last frame. Reloading a local file takes a fraction of a second.
      const warm = window.setTimeout(() => {
        if (!next || broken.has(nextIndex) || !next.paused) return;
        next.preload = 'auto';
        next.load();
      }, Math.max(0, left - 3000));
      const id = window.setTimeout(() => {
        if (!next || broken.has(nextIndex)) return go();
        if (next.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA && next.networkState !== HTMLMediaElement.NETWORK_EMPTY) return go();
        // Not ready yet: starting it is what wakes a sleeping player; it fades in on its first moving picture
        next.addEventListener('playing', go, { once: true });
        next.addEventListener('canplay', go, { once: true });
        next.play().catch(() => {});
        cleanups.push(() => { next.removeEventListener('playing', go); next.removeEventListener('canplay', go); });
      }, Math.max(0, left));
      cleanups.push(() => { clearTimeout(warm); clearTimeout(id); });
    };
    // Never stand on a last frame: if this clip ends before the next one is ready, switch now (the next one shows its
    // still picture until its first frame is there)
    if (current) {
      current.addEventListener('ended', go, { once: true });
      cleanups.push(() => current.removeEventListener('ended', go));
    }
    if (!current || broken.has(index) || (!current.paused && current.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA)) {
      begin();
    } else {
      // count from the first played frame, not from the moment the screen opened; give up waiting after 3 s
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        begin();
      };
      current.addEventListener('playing', start, { once: true });
      const fallback = window.setTimeout(start, 3000);
      cleanups.push(() => {
        current.removeEventListener('playing', start);
        clearTimeout(fallback);
      });
    }
    return () => cleanups.forEach((fn) => fn());
  }, [index, still, hidden, frozen, clips.length, showMs, broken]);

  // only the visible clip decodes; the next one is preloaded so the cross-fade starts on a real frame
  useEffect(() => {
    const current = videos.current[index];
    const thaw = (i: number) => {
      const c = frames.current[i];
      if (c && !c.hidden) {
        c.hidden = true;
        c.width = 0; // frees the snapshot
      }
    };
    const timers: number[] = [];
    videos.current.forEach((v, i) => {
      if (!v) return;
      if (i === index) {
        if (still || hidden) {
          v.pause();
          return;
        }
        const c = frames.current[i];
        if (c && !c.hidden) {
          // back on the frame the snapshot shows, then lift it once the clip has drawn that moment or later
          const at = resumeAt.current;
          if (at !== null && Math.abs(v.currentTime - at) > 0.04) v.currentTime = at;
          const mine = epoch.current;
          const done = () => {
            if (epoch.current !== mine) return;
            thaw(i);
            setFrozen(false);
          };
          if (typeof v.requestVideoFrameCallback === 'function') {
            const watch = () =>
              v.requestVideoFrameCallback((_now, frame) => {
                if (epoch.current !== mine) return;
                if (at === null || frame.mediaTime >= at - 0.1) done();
                else watch();
              });
            watch();
          } else {
            v.addEventListener('playing', done, { once: true });
          }
          timers.push(window.setTimeout(done, 3000));
        }
        v.play().catch(() => {});
        return;
      }
      thaw(i);
      if (hidden) {
        v.pause();
        return;
      }
      // the clip fading out keeps playing through the fade; others rewind for their next turn
      timers.push(
        window.setTimeout(() => {
          if (i !== indexRef.current && i !== prevRef.current) {
            v.pause();
            v.currentTime = 0;
          } else if (i === prevRef.current && i !== indexRef.current) {
            v.pause();
          }
        }, fadeMs + 100),
      );
    });
    // The next clip starts loading once the visible one has enough to play through (loading both at once splits the
    // disk and the decoder between them, so the first shot takes longer to appear).
    const next = videos.current[(index + 1) % Math.max(1, clips.length)];
    const loadNext = () => {
      if (next && next.preload !== 'auto') {
        next.preload = 'auto';
        next.load();
      }
    };
    const clear = () => timers.forEach((t) => clearTimeout(t));
    if (!current || current.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      loadNext();
      return clear;
    }
    current.addEventListener('canplaythrough', loadNext, { once: true });
    return () => {
      clear();
      current.removeEventListener('canplaythrough', loadNext);
    };
  }, [index, still, hidden, clips.length, fadeMs]);

  // Leaving the screen (signed in): the videos are let go at once
  useEffect(() => () => {
    videos.current.forEach((v) => {
      if (!v) return;
      v.pause();
      v.removeAttribute('src');
      v.load();
    });
  }, []);

  const paused = hidden || frozen;
  return (
    <div
      className="login-base pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      style={{ '--hero-ms': `${clipMs}ms`, '--fade-ms': `${fadeMs}ms` } as React.CSSProperties}
      aria-hidden="true"
    >
      {clips.map((clip, i) =>
        still || broken.has(i) ? (
          <img
            key={clip.id}
            src={`${LOGIN_MEDIA_URL}${clip.poster}`}
            alt=""
            decoding="async"
            draggable={false}
            className={`hero-fade absolute inset-0 h-full w-full object-cover ${i === index ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : (
          <div
            key={clip.id}
            className={`hero-fade absolute inset-0 ${i === index ? 'hero-zoom opacity-100' : i === prev ? 'hero-zoom opacity-0' : 'opacity-0'}`}
            style={{
              ...(i === index ? { willChange: 'transform' } : {}),
              ...(paused ? { animationPlayState: 'paused' } : {}),
            }}
          >
            <video
              ref={(el) => { videos.current[i] = el; }}
              src={`${LOGIN_MEDIA_URL}${clip.video}`}
              // its still picture until its first frame is there: never black, even on a late start
              poster={`${LOGIN_MEDIA_URL}${clip.poster}`}
              muted
              playsInline
              disablePictureInPicture
              disableRemotePlayback
              preload={i === 0 ? 'auto' : 'none'}
              tabIndex={-1}
              onError={() => setBroken((b) => new Set(b).add(i))}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <canvas
              ref={(el) => { frames.current[i] = el; }}
              hidden
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
        ),
      )}
      {/* Darkening so the words stay readable on any picture: strongest behind the text on the left */}
      <div className="login-shade absolute inset-0" />
    </div>
  );
};
