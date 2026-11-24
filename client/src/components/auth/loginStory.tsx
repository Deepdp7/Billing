import React, { useSyncExternalStore } from 'react';
import { FALLBACK_WORDS, LOGIN_TIMING, type LoginClip } from '../../lib/loginMedia.js';

/**
 * Which shop the sign-in background shows, and whether it is paused (window hidden, or waiting for the picture to come
 * back). The player sets it; the words and the bars follow. Nothing here runs per frame: the words change once per
 * shop, and the bar of the shop on screen fills by a CSS animation (drawn by the graphics chip), paused with the video.
 */
export interface StoryStore {
  getIndex(): number;
  getPaused(): boolean;
  subscribe(fn: () => void): () => void;
  /** The player: the shop now showing */
  set(index: number): void;
  /** The player: the picture is paused (the bar stops with it) */
  pause(paused: boolean): void;
}

export function createStory(): StoryStore {
  let index = 0;
  let paused = false;
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach((fn) => fn());
  return {
    getIndex: () => index,
    getPaused: () => paused,
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    set(next) { if (next !== index) { index = next; tell(); } },
    pause(next) { if (next !== paused) { paused = next; tell(); } },
  };
}

/** The chip, headline and one line under it for the shop on screen */
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

/** One thin bar per shop: done ones full, the one on screen filling over its time, the next ones empty */
export const StoryBars: React.FC<{ clips: LoginClip[]; story: StoryStore; still?: boolean }> = ({ clips, story, still }) => {
  const index = useSyncExternalStore(story.subscribe, story.getIndex);
  const paused = useSyncExternalStore(story.subscribe, story.getPaused);
  if (clips.length < 2) return null;
  return (
    <div className="hidden max-w-md gap-2 md:flex" aria-hidden="true">
      {clips.map((clip, i) => (
        <span key={clip.id} className="block h-1 flex-1 overflow-hidden rounded-full bg-white/30">
          <span
            // a new element for each turn of the shop on screen, so its fill starts again from empty
            key={i === index ? `on-${index}` : 'off'}
            className={`block h-full origin-left rounded-full bg-white ${i < index ? 'opacity-70' : i > index ? 'scale-x-0' : still ? '' : 'story-progress'}`}
            style={i === index && !still ? { '--story-ms': `${LOGIN_TIMING.showMs}ms`, animationPlayState: paused ? 'paused' : 'running' } as React.CSSProperties : undefined}
          />
        </span>
      ))}
    </div>
  );
};
