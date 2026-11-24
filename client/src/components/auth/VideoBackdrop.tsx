import React, { useEffect, useRef, useState } from 'react';
import { LOGIN_MEDIA_URL, LOGIN_VIDEO, type LoginClip } from '../../lib/loginMedia.js';
import type { StoryStore } from './loginStory.js';

/**
 * The sign-in screen's full-screen background: one looping video of the shops one after another (the clips dissolve into
 * each other inside the file, and the end dissolves into the start, so the loop has no visible join). Made to be light
 * and hard to break on any computer:
 *  - ONE <video> element and one file: nothing is switched between files, so there is no hand-over that can stall, show
 *    black, or need a second decoder. The player only plays, loops and watches;
 *  - 1080p30 H.264: Windows decodes it in hardware, so the processor hardly works; 30 fps shows every frame for exactly
 *    two refreshes of a 60 Hz screen (no 3-2 stutter on camera moves);
 *  - nothing moves or fades on top of the video, and nothing blurs it: the words, the bars and the card sit still over a
 *    fixed darkening layer, so the graphics chip only has the video to draw;
 *  - which shop is on (words, bars) is read from the video's own clock four times a second, not driven by timers of
 *    its own, so the words can never get out of step with the picture;
 *  - it stops while the window is hidden or minimised, notices a picture that has frozen and starts it again (up to a
 *    few times), and frees the video when the screen is left;
 *  - "reduce motion" (a Windows setting), a video that cannot play, or a very slow start show the posters instead (the
 *    same pictures, changing at the same pace), and under everything is a dark green gradient, never plain black.
 */

/** No picture after this long: use the posters */
const START_TIMEOUT_MS = 12_000;
/** A frozen picture is started again this many times before the posters take over */
const MAX_RECOVERIES = 3;
/** The recoveries are counted over this long: a freeze now and then is fine, a constant one is not */
const RECOVERY_WINDOW_MS = 60_000;

const stillPicture = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const VideoBackdrop: React.FC<{ clips: LoginClip[]; story: StoryStore }> = ({ clips, story }) => {
  const [mode, setMode] = useState<'video' | 'poster'>(() => (clips.length === 0 || stillPicture() ? 'poster' : 'video'));
  const [index, setIndex] = useState(0); // posters only: the one on show
  const videoRef = useRef<HTMLVideoElement>(null);

  // ---------------------------------------------------------------- video
  useEffect(() => {
    if (mode !== 'video') return;
    const v = videoRef.current;
    if (!v) return;
    const { file, segment, overlap } = LOGIN_VIDEO;
    const url = `${LOGIN_MEDIA_URL}${file}`;
    const shops = clips.length;
    /** Where a shop's clean picture begins: just after its dissolve (this is also what its poster shows) */
    const startOf = (shop: number) => shop * segment + overlap / 2;

    let alive = true;
    let started = false;
    let startWatchdog: number | undefined;
    const recoveries: number[] = [];

    const fail = () => { if (alive) setMode('poster'); };

    /** (Re)loads the video and carries on from `at` seconds */
    const load = (at: number) => {
      v.src = url;
      v.load();
      v.addEventListener('loadedmetadata', () => {
        if (!alive) return;
        try { v.currentTime = at; } catch { /* the start is the start */ }
        v.play().catch(() => { /* the watchdog tries again */ });
      }, { once: true });
    };

    /** The picture froze or the video broke: start it again where it was, unless that keeps happening */
    const recover = () => {
      const now = performance.now();
      while (recoveries.length && now - recoveries[0] > RECOVERY_WINDOW_MS) recoveries.shift();
      if (recoveries.length >= MAX_RECOVERIES) return fail();
      recoveries.push(now);
      load(Math.max(startOf(0), v.currentTime || 0));
    };

    const onPlaying = () => { started = true; window.clearTimeout(startWatchdog); };
    const onError = () => recover();
    // A looping video does not end; if some browser lets it, it goes on from the start (inside the dissolve: not visible)
    const onEnded = () => { v.currentTime = 0; v.play().catch(() => {}); };
    v.addEventListener('playing', onPlaying);
    v.addEventListener('error', onError);
    v.addEventListener('ended', onEnded);

    // A bar was pressed: that shop's clean picture
    story.setJump((shop) => {
      if (shop < 0 || shop >= shops || v.readyState < 1) return;
      v.currentTime = startOf(shop);
    });

    // Hidden or minimised: stop decoding; back: carry on
    const onVisibility = () => {
      if (document.hidden) v.pause();
      else v.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Which shop is on, from the video's own clock (four times a second, straight into the page: no React render)
    const follow = window.setInterval(() => {
      if (document.hidden || !(v.duration > 0)) return;
      const t = Math.min(v.currentTime, v.duration);
      const shop = Math.min(shops - 1, Math.floor(t / segment));
      story.set(shop);
      story.progress(shop, (t - shop * segment) / segment);
    }, 250);

    // The watchdog: once a second, a picture that should be moving but is not is started again
    let last = -1;
    let still = 0;
    const watch = window.setInterval(() => {
      if (document.hidden || !started) { still = 0; return; }
      if (v.paused) { v.play().catch(() => {}); return; }
      still = Math.abs(v.currentTime - last) < 0.05 ? still + 1 : 0;
      last = v.currentTime;
      if (still >= 3) { still = 0; recover(); }
    }, 1000);

    // Start: the first picture is already there (the poster); the video takes over from the very same moment
    story.set(0);
    story.progress(0, 0);
    load(startOf(0));
    const arm = () => { startWatchdog = window.setTimeout(() => (document.hidden ? arm() : fail()), START_TIMEOUT_MS); };
    arm();

    return () => {
      alive = false;
      story.setJump(null);
      window.clearTimeout(startWatchdog);
      window.clearInterval(follow);
      window.clearInterval(watch);
      document.removeEventListener('visibilitychange', onVisibility);
      v.removeEventListener('playing', onPlaying);
      v.removeEventListener('error', onError);
      v.removeEventListener('ended', onEnded);
      v.pause();
      v.removeAttribute('src');
      v.load();
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
      if (shownMs >= LOGIN_VIDEO.segment * 1000 && clips.length > 1) show((cur + 1) % clips.length);
      else story.progress(cur, Math.min(1, shownMs / (LOGIN_VIDEO.segment * 1000)));
    }, 250);
    return () => { window.clearInterval(timer); story.setJump(null); };
  }, [mode, clips, story]);

  return (
    <div className="login-base pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {/* Posters: the first picture at once (the video starts from the very same picture), and what stays if the video
          cannot play. Under playing video there is only the first one: other layers would be redrawn for nothing. */}
      {clips.map((clip, i) => (mode === 'poster' || i === 0) && (
        <img key={clip.id} src={`${LOGIN_MEDIA_URL}${clip.poster}`} alt="" decoding="async" draggable={false}
          className={`absolute inset-0 h-full w-full object-cover ${mode === 'poster' ? `login-fade ${i === index ? 'opacity-100' : 'opacity-0'}` : ''}`} />
      ))}
      {mode === 'video' && (
        <video ref={videoRef} muted loop playsInline autoPlay disablePictureInPicture disableRemotePlayback preload="auto" tabIndex={-1}
          className="absolute inset-0 h-full w-full object-cover" />
      )}
      {/* Darkening so the words stay readable on any picture: strongest behind the text on the left */}
      <div className="login-shade absolute inset-0" />
    </div>
  );
};
