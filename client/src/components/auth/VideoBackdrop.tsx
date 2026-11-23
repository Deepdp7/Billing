import React, { useEffect, useRef, useState } from 'react';
import { LOGIN_MEDIA_URL, type LoginClip } from '../../lib/loginMedia.js';
import type { StoryStore } from './loginStory.js';

/**
 * The sign-in screen's full-screen background: the shop clips one after the other, each 8 seconds, cross-faded, for
 * ever. Made to be light on slow computers:
 *  - two <video> elements only: the clip on screen and the next one (loaded about 3 s before it is needed);
 *  - no JavaScript per frame: the switch is one timer, set when a clip starts playing and set again after any stall;
 *  - computers in lite mode (lib/performance.ts) get the 720p files; faster ones the 1080p files (both H.264, which
 *    Windows decodes in hardware);
 *  - it stops while the window is hidden or minimised, and frees the videos when the screen is left;
 *  - "reduce motion" (Windows setting), a video that cannot play, or a very slow start show the posters instead (the
 *    same pictures, changing every 8 s), and with no files at all just the dark background.
 */

const CLIP_MS = 8000;
const FADE_MS = 600;
/** The next clip starts this long before the current one ends, so the cross-fade finishes with it */
const LEAD_S = FADE_MS / 1000;
/** The next clip is loaded this long before it is needed */
const PREPARE_S = 3;
/** No picture after this long: use the posters */
const START_TIMEOUT_MS = 10_000;

const stillPicture = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const VideoBackdrop: React.FC<{ clips: LoginClip[]; story: StoryStore }> = ({ clips, story }) => {
  const [mode, setMode] = useState<'video' | 'poster'>(() => (clips.length === 0 || stillPicture() ? 'poster' : 'video'));
  const [index, setIndex] = useState(0);
  const [front, setFront] = useState(0);
  const videoA = useRef<HTMLVideoElement>(null);
  const videoB = useRef<HTMLVideoElement>(null);

  // ---------------------------------------------------------------- video
  useEffect(() => {
    if (mode !== 'video') return;
    const els = [videoA.current, videoB.current];
    if (!els[0] || !els[1]) return;
    const vids = els as HTMLVideoElement[];
    const lite = document.documentElement.classList.contains('lite');
    const urlOf = (clip: number) => `${LOGIN_MEDIA_URL}${lite ? clips[clip].video720 : clips[clip].video1080}`;
    const many = clips.length > 1;

    let alive = true;
    let cur = 0; // the clip on screen
    let slot = 0; // the element showing it
    const loaded = [-1, -1]; // which clip each element holds
    let token = 0; // each switch gets a number; one overtaken by a newer switch does nothing when its clip is ready
    let switchTimer: number | undefined;
    let prepareTimer: number | undefined;
    let startWatchdog: number | undefined;
    const release: Array<number | undefined> = [undefined, undefined];

    const fail = () => { if (alive) setMode('poster'); };
    const clearTimers = () => { window.clearTimeout(switchTimer); window.clearTimeout(prepareTimer); };

    const load = (s: number, clip: number) => {
      window.clearTimeout(release[s]);
      const v = vids[s];
      v.preload = 'auto';
      v.src = urlOf(clip);
      v.load();
      loaded[s] = clip;
    };
    const unload = (s: number) => {
      const v = vids[s];
      v.pause();
      v.removeAttribute('src');
      v.load();
      loaded[s] = -1;
    };

    const prepareNext = () => {
      const next = (cur + 1) % clips.length;
      if (loaded[1 - slot] !== next) load(1 - slot, next);
    };

    /** One timer for the next switch (and one for loading the next clip), from where the picture is now */
    const schedule = () => {
      clearTimers();
      const v = vids[slot];
      if (!many || v.paused || !Number.isFinite(v.duration)) return;
      const left = v.duration - v.currentTime;
      switchTimer = window.setTimeout(() => goTo((cur + 1) % clips.length), Math.max(0, (left - LEAD_S) * 1000));
      prepareTimer = window.setTimeout(prepareNext, Math.max(0, (left - PREPARE_S) * 1000));
    };

    /** Cross-fades to a clip: loads it if it is not ready, starts it, and lets the old one go once it has faded out */
    const goTo = (target: number) => {
      if (!alive || target === cur) return;
      clearTimers();
      const mine = ++token;
      const to = 1 - slot;
      const old = slot;
      if (loaded[to] !== target) load(to, target);
      const v = vids[to];
      const begin = () => {
        if (!alive || mine !== token) return;
        v.currentTime = 0;
        v.play().catch(fail);
        slot = to;
        cur = target;
        setFront(to);
        setIndex(target);
        story.set(target);
        release[old] = window.setTimeout(() => unload(old), FADE_MS + 150);
      };
      // The old clip keeps its last picture until the new one can play
      if (v.readyState >= 3) begin();
      else v.addEventListener('canplay', begin, { once: true });
    };

    const onPlaying = (s: number) => () => {
      if (s !== slot) return;
      window.clearTimeout(startWatchdog);
      schedule();
    };
    const onStopped = (s: number) => () => { if (s === slot) clearTimers(); };
    const onEnded = (s: number) => () => { if (s === slot && many) goTo((cur + 1) % clips.length); };
    const onError = (s: number) => () => { if (loaded[s] >= 0) fail(); };

    const handlers = vids.map((_, s) => ({ playing: onPlaying(s), waiting: onStopped(s), pause: onStopped(s), ended: onEnded(s), error: onError(s) }));
    vids.forEach((v, s) => {
      for (const [name, fn] of Object.entries(handlers[s])) v.addEventListener(name, fn);
      v.loop = !many;
    });

    // A bar was pressed
    story.setJump((target) => { if (target >= 0 && target < clips.length) goTo(target); });

    // Hidden or minimised: stop decoding; back: carry on
    const onVisibility = () => {
      if (document.hidden) {
        clearTimers();
        vids.forEach((v) => v.pause());
      } else {
        vids[slot].play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // The bars (a few times a second, straight into the page: no React render)
    const progressTimer = window.setInterval(() => {
      if (document.hidden) return;
      const v = vids[slot];
      if (v.duration > 0) story.progress(cur, v.currentTime / v.duration);
    }, lite ? 250 : 100);

    // Start
    setIndex(0);
    setFront(0);
    story.set(0);
    load(0, 0);
    vids[0].play().catch(fail);
    const arm = () => { startWatchdog = window.setTimeout(() => (document.hidden ? arm() : fail()), START_TIMEOUT_MS); };
    arm();

    return () => {
      alive = false;
      story.setJump(null);
      clearTimers();
      window.clearTimeout(startWatchdog);
      window.clearInterval(progressTimer);
      release.forEach((t) => window.clearTimeout(t));
      document.removeEventListener('visibilitychange', onVisibility);
      vids.forEach((v, s) => {
        for (const [name, fn] of Object.entries(handlers[s])) v.removeEventListener(name, fn);
        unload(s);
      });
    };
  }, [mode, clips, story]);

  // ---------------------------------------------------------------- posters (reduced motion, or the video could not play)
  useEffect(() => {
    if (mode !== 'poster' || clips.length === 0) return;
    let cur = 0;
    let shownMs = 0; // how long this poster has been on screen, counting only while the window is visible
    let last = performance.now();
    story.set(0);
    setIndex(0);
    const show = (target: number) => {
      cur = target;
      shownMs = 0;
      setIndex(target);
      story.set(target);
    };
    story.setJump((target) => { if (target >= 0 && target < clips.length) show(target); });
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (!document.hidden) shownMs += now - last;
      last = now;
      if (shownMs >= CLIP_MS && clips.length > 1) show((cur + 1) % clips.length);
      else story.progress(cur, Math.min(1, shownMs / CLIP_MS));
    }, 150);
    return () => { window.clearInterval(timer); story.setJump(null); };
  }, [mode, clips, story]);

  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-slate-950" aria-hidden="true">
      {/* Posters: the first picture at once, and what shows if the video cannot play */}
      {clips.map((clip, i) => (
        <img key={clip.id} src={`${LOGIN_MEDIA_URL}${clip.poster}`} alt="" decoding="async" draggable={false}
          className={`login-fade absolute inset-0 h-full w-full object-cover ${i === index ? 'opacity-100' : 'opacity-0'}`} />
      ))}
      {mode === 'video' && [videoA, videoB].map((ref, i) => (
        <video key={i} ref={ref} muted playsInline disablePictureInPicture disableRemotePlayback preload="none" tabIndex={-1}
          className={`login-fade absolute inset-0 h-full w-full object-cover ${front === i ? 'opacity-100' : 'opacity-0'}`} />
      ))}
      {/* Darkening so the words stay readable on any picture: strongest behind the text on the left */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/40 to-black/10 max-md:bg-black/55" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/20" />
    </div>
  );
};
