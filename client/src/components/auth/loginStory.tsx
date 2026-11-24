import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { FALLBACK_WORDS, type LoginClip } from '../../lib/loginMedia.js';

/**
 * Which clip of the sign-in story is on screen and how far it is. The headline re-renders only when the clip changes;
 * the progress bars are moved straight in the page (no React render), so typing a password never competes with it.
 */
export interface StoryStore {
  getIndex(): number;
  subscribe(fn: () => void): () => void;
  /** The player: the clip now showing */
  set(index: number): void;
  /** The player: how far the clip is (0..1) */
  progress(index: number, fraction: number): void;
  onProgress(fn: (index: number, fraction: number) => void): () => void;
  /** A bar was pressed: ask the player to show that clip */
  jump(index: number): void;
  setJump(fn: ((index: number) => void) | null): void;
}

export function createStory(): StoryStore {
  let index = 0;
  const indexListeners = new Set<() => void>();
  const progressListeners = new Set<(i: number, p: number) => void>();
  let jumpFn: ((i: number) => void) | null = null;
  return {
    getIndex: () => index,
    subscribe: (fn) => { indexListeners.add(fn); return () => { indexListeners.delete(fn); }; },
    set(next) {
      if (next === index) return;
      index = next;
      indexListeners.forEach((fn) => fn());
      progressListeners.forEach((fn) => fn(next, 0));
    },
    progress: (i, p) => progressListeners.forEach((fn) => fn(i, p)),
    onProgress: (fn) => { progressListeners.add(fn); return () => { progressListeners.delete(fn); }; },
    jump: (i) => jumpFn?.(i),
    setJump: (fn) => { jumpFn = fn; },
  };
}

/** The chip, headline and one line under it for the clip on screen */
export const StoryText: React.FC<{ clips: LoginClip[]; story: StoryStore }> = ({ clips, story }) => {
  const index = useSyncExternalStore(story.subscribe, story.getIndex);
  const clip = clips[index];
  const words = clip || FALLBACK_WORDS;
  return (
    <div key={index} className="apna-headline space-y-3" aria-live="polite">
      {clip && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/90">
          <clip.Icon className="h-3.5 w-3.5 text-emerald-300" />{clip.category}
        </span>
      )}
      <h2 className="font-['Outfit'] text-4xl font-extrabold leading-[1.05] tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.45)] lg:text-5xl">
        {words.headline}
      </h2>
      <p className="hidden max-w-md text-sm leading-relaxed text-white/80 drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)] md:block">{words.subline}</p>
    </div>
  );
};

/** One thin bar per clip, filling as the clip plays; a bar can be pressed to jump to its clip */
export const StoryBars: React.FC<{ clips: LoginClip[]; story: StoryStore }> = ({ clips, story }) => {
  const fills = useRef<Array<HTMLSpanElement | null>>([]);
  useEffect(() => {
    const paint = (index: number, p: number) => {
      fills.current.forEach((el, i) => { if (el) el.style.transform = `scaleX(${i < index ? 1 : i > index ? 0 : Math.min(1, Math.max(0, p))})`; });
    };
    paint(story.getIndex(), 0);
    return story.onProgress(paint);
  }, [story]);
  if (clips.length < 2) return null;
  return (
    <div className="hidden max-w-md gap-2 md:flex">
      {clips.map((clip, i) => (
        <button key={clip.id} type="button" onClick={() => story.jump(i)} aria-label={`Show ${clip.category}`}
          className="group flex h-6 flex-1 items-center">
          <span className="block h-1 w-full overflow-hidden rounded-full bg-white/30 transition-[height] group-hover:h-1.5">
            <span ref={(el) => { fills.current[i] = el; }} className="story-fill block h-full origin-left rounded-full bg-white" style={{ transform: 'scaleX(0)' }} />
          </span>
        </button>
      ))}
    </div>
  );
};
