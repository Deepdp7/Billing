#!/usr/bin/env node
/**
 * Makes the sign-in screen's background video from the 4 source clips (AI videos, usually 4K).
 *
 *   node scripts/encode-login-videos.mjs               reads branding/login-videos/raw/{1..4}-*.{mp4,mov,webm,mkv}
 *   node scripts/encode-login-videos.mjs --placeholder makes 4 stand-in clips (to build and test the screen first)
 *   node scripts/encode-login-videos.mjs --no-fixes    leaves out the touch-ups listed under CLIPS
 *
 * The result is ONE video, in client/public/login-media/ (its name carries a content hash, so it can be cached for a year
 * and a new video still shows up after an update):
 *   login.<hash>.mp4          1080p30 H.264 high, BT.709, ~10 MB: the 4 shops one after another, each dissolving into
 *                             the next, and the last dissolving into the first. The file starts and ends in the middle
 *                             of that last dissolve, so playing it in a loop has no visible join.
 *   login-<n>-<name>.<hash>.webp   a poster for each shop (its first clean picture), painted before the video starts
 * and the list in client/src/lib/loginMedia.generated.ts.
 *
 * Why one file: the screen needs only one video player, one decoder and no switching between files (switching is what
 * stalls, shows black or stutters on slow graphics chips). The player just plays it in a loop.
 * H.264 on purpose: every Windows PC decodes it in hardware (AV1 / VP9 can fall back to slow software decoding).
 * 30 fps: a 60 Hz screen then shows every frame exactly twice (24 fps is shown 3-2-3-2 times: a stutter on camera moves).
 * Needs ffmpeg and ffprobe on PATH.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'branding', 'login-videos', 'raw');
const OUT = path.join(ROOT, 'client', 'public', 'login-media');
const GENERATED = path.join(ROOT, 'client', 'src', 'lib', 'loginMedia.generated.ts');
const WORK = path.join(ROOT, 'branding', 'login-videos', '.work');
const SECONDS = 8;
const FPS = 30;
/** Every clip is cut to exactly this many frames (239 = just under 8 s at 30 fps) */
const CLIP_FRAMES = 239;
/** The dissolve between two shops, in frames (0.8 s) */
const OVERLAP = 24;
/** How long each shop has the screen: its clip minus the dissolve into the next one (215 frames = 7.17 s) */
const SEGMENT = CLIP_FRAMES - OVERLAP;
const MAX_VIDEO_BYTES = 14 * 1024 * 1024;
const FONT = 'C\\:/Windows/Fonts/segoeuib.ttf'; // placeholder clips only (escaped for ffmpeg's filter syntax)

// Touch-ups for flaws in the owner's own AI clips (the numbers are pixels of the 3840x2160 source). They belong to those
// exact clips: when a clip is made again, delete its entry here (or run with --no-fixes to see the clip as it is).
//  patchOut  paints over something that slides across a plain wall: the wall `fromBelow` pixels lower is copied over it
//            through a soft-edged mask that follows it (its right edge is at `right` px at time 0 and moves left `speed`
//            px per second, until `until` s; the mask is `patchW` wide and solid down to `solidH`, `pad` is how much of it lies
//            past `right`, and it is fully opaque up to `reach` px past `right`)
//  cropTop   cuts the top of the picture (a fraction of its height) and zooms in on the rest, to lose AI scribble at the edge
const CLIPS = [
  { n: 1, name: 'grocery', label: 'Grocery', colors: '0x14532d:0x0f766e',
    // The AI put a sign reading "4K 24 fps" on the teal pillar at the top left; it slides out of frame by 2.4 s
    fix: { patchOut: { right: 1460, speed: 594, until: 2.9, patchW: 1300, pad: 260, reach: 110, solidH: 580, fromBelow: 1100 } } },
  { n: 2, name: 'pharmacy', label: 'Pharmacy', colors: '0x0c4a6e:0x0e7490',
    // Garbled sign lettering is cut off along the top edge
    fix: { cropTop: 0.05 } },
  { n: 3, name: 'clothing', label: 'Clothing', colors: '0x581c87:0xbe185d' },
  { n: 4, name: 'restaurant', label: 'Restaurant', colors: '0x7c2d12:0xb45309' },
];

const placeholder = process.argv.includes('--placeholder');
const noFixes = process.argv.includes('--no-fixes');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) {
    console.error(`Could not run ${cmd}: ${r.error.message}. Install ffmpeg (winget install Gyan.FFmpeg) and open a new terminal.`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`\n${cmd} ${args.join(' ')}\n${(r.stderr || '').split('\n').slice(-15).join('\n')}`);
    process.exit(1);
  }
  return r.stdout;
}

const ffmpeg = (args) => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);

function probe(file) {
  const j = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=width,height,codec_name,r_frame_rate,nb_read_frames:format=duration', '-of', 'json', file]));
  const [num, den] = String(j.streams[0].r_frame_rate || '0/1').split('/').map(Number);
  return { width: j.streams[0].width, height: j.streams[0].height, codec: j.streams[0].codec_name, duration: Number(j.format.duration),
    fps: den ? num / den : 0, frames: Number(j.streams[0].nb_read_frames) };
}

const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);

/** A stand-in 4K clip: a slowly drifting colour gradient with the shop's name, so the screen can be built first */
function makePlaceholder(clip, file) {
  const [a, b] = clip.colors.split(':');
  const text = `drawtext=fontfile='${FONT}':text='${clip.n}  ${clip.label}':fontsize=220:fontcolor=white@0.9:x=(w-text_w)/2+60*sin(t):y=(h-text_h)/2`;
  ffmpeg(['-f', 'lavfi', '-i', `gradients=s=3840x2160:c0=${a}:c1=${b}:x0=0:y0=0:x1=3840:y1=2160:speed=0.04:duration=${SECONDS}:rate=30`,
    '-vf', `${text},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-t', String(SECONDS), '-an', file]);
}

function findRaw(clip) {
  const files = fs.existsSync(RAW) ? fs.readdirSync(RAW) : [];
  return files.find((f) => f.startsWith(`${clip.n}-`) && /\.(mp4|mov|webm|mkv)$/i.test(f)) || null;
}

/**
 * Applies a clip's touch-ups (see CLIPS) once, at full size, into a near-lossless working file the encodes start from.
 * Returns the file to encode from (the source itself when there is nothing to fix).
 */
function touchUp(clip, src, info) {
  const fix = !placeholder && !noFixes && clip.fix;
  if (!fix) return src;
  const out = path.join(WORK, `${clip.n}-fixed.mp4`);
  const k = info.width / 3840; // the numbers are for a 4K source
  const px = (v) => Math.round(v * k);
  const common = ['-t', String(SECONDS), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '8', '-pix_fmt', 'yuv420p', out];
  if (fix.cropTop) {
    // 16:9 again after the cut: the same share is taken off the sides, centred
    const h = Math.floor((info.height * (1 - fix.cropTop)) / 2) * 2;
    const w = Math.floor(((h * 16) / 9) / 2) * 2;
    ffmpeg(['-i', src, '-vf', `crop=${w}:${h}:${Math.floor((info.width - w) / 2 / 2) * 2}:${info.height - h},scale=${info.width}:${info.height}:flags=lanczos`, ...common]);
  } else if (fix.patchOut) {
    const f = fix.patchOut;
    const H = info.height - px(f.fromBelow); // the part of the picture that is moved up
    const mw = px(f.patchW);
    const mh = px(f.solidH) + px(120);
    const x = `(${px(f.right)}-${px(f.speed)}*t-${px(f.patchW - f.pad)})`; // the mask's left edge at time t (can be off the picture)
    const graph = [
      '[0:v]split=2[base][src]',
      // the wall below, moved up (so each point takes its colour from the same place, `fromBelow` px lower)
      `[src]crop=${info.width}:${H}:0:${px(f.fromBelow)},format=yuv444p[low]`,
      // a soft-edged mask (opaque in the middle, fading out over ~40 px: no hard seam), carried to where the sign is now
      `color=c=black:s=${info.width}x${H}:r=24,format=yuv444p[canvas]`,
      `color=c=black:s=${mw}x${mh}:r=24,drawbox=x=${px(80)}:y=-${px(300)}:w=${px(f.patchW - f.pad + f.reach - 80)}:h=${px(f.solidH + 300)}:color=white:t=fill,boxblur=${px(50)}:2,format=yuv444p[mask]`,
      `[canvas][mask]overlay=x='${x}':y=0:format=yuv444[moving]`,
      // video black is level 16, white 235: stretched to 0..255, so "transparent" is really transparent and "solid" really solid
      `[moving]lutyuv=y='clip((val-16)*255/219,0,255)'[alpha]`,
      '[low][alpha]alphamerge[soft]',
      `[base][soft]overlay=x=0:y=0:enable='lt(t,${f.until})':format=auto[v]`,
    ].join(';');
    ffmpeg(['-i', src, '-filter_complex', graph, '-map', '[v]', ...common]);
  }
  return out;
}

/**
 * One clip as a 1080p30 working file, nearly lossless (it is encoded again as part of the montage), exactly CLIP_FRAMES
 * frames long. AI video tools often tag their files with the old standard-definition colour matrix (BT.601), while a
 * browser assumes the HD one (BT.709): the colours are converted and tagged here, so every browser and graphics chip
 * shows what the owner saw in the video tool. A 24 fps source gets its missing frames by motion interpolation (the last
 * frame is repeated once first, so the clip is still a full 8 s); a faster one is just resampled.
 */
function makeMaster(src, srcFps, dest) {
  const rate = srcFps && srcFps < FPS - 0.5
    ? `tpad=stop_mode=clone:stop=1,minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
    : `fps=${FPS}`;
  const vf = 'scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos:in_color_matrix=auto:out_color_matrix=bt709:out_range=tv,'
    + `crop=1920:1080,${rate},format=yuv420p`;
  ffmpeg(['-i', src, '-t', String(SECONDS), '-vf', vf, '-frames:v', String(CLIP_FRAMES), '-c:v', 'libx264', '-preset', 'fast', '-crf', '12',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-an', dest]);
}

/**
 * The montage. Clips in play order c1..cN; the picture is built from [cN, c1..cN, c1] with a dissolve between each pair,
 * and only the stretch from the middle of the first dissolve (cN into c1) to the middle of the last one (cN into c1
 * again) is kept. Both ends are in the same place of the same dissolve, so the file loops with no join.
 */
function makeMontage(masters, dest) {
  const n = masters.length;
  const order = [masters[n - 1], ...masters, masters[0]];
  const dissolve = OVERLAP / FPS;
  const parts = order.map((_, i) => `[${i}:v]setpts=PTS-STARTPTS,fps=${FPS},format=yuv420p,setsar=1[v${i}]`);
  let last = 'v0';
  for (let i = 1; i < order.length; i++) {
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${dissolve.toFixed(6)}:offset=${((i * SEGMENT) / FPS).toFixed(6)}[x${i}]`);
    last = `x${i}`;
  }
  const start = CLIP_FRAMES - OVERLAP / 2;
  parts.push(`[${last}]trim=start_frame=${start}:end_frame=${start + SEGMENT * n},setpts=PTS-STARTPTS[v]`);
  ffmpeg([...order.flatMap((f) => ['-i', f]), '-filter_complex', parts.join(';'), '-map', '[v]', '-frames:v', String(SEGMENT * n),
    // a key picture every 2 s (and at the very start), none added by scene detection: even work for the decoder, quick jumps
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-tune', 'film', '-crf', '23', '-maxrate', '4M', '-bufsize', '8M',
    '-g', String(FPS * 2), '-keyint_min', String(FPS * 2), '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', '-an', dest]);
}

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const masters = [];
for (const clip of CLIPS) {
  let src;
  if (placeholder) {
    src = path.join(WORK, `${clip.n}-${clip.name}-source.mp4`);
    console.log(`Making stand-in clip ${clip.n} (${clip.label})…`);
    makePlaceholder(clip, src);
  } else {
    const found = findRaw(clip);
    if (!found) {
      console.error(`Missing ${path.join(RAW, `${clip.n}-${clip.name}.mp4`)} (any of mp4, mov, webm, mkv starting with "${clip.n}-").`);
      process.exit(1);
    }
    src = path.join(RAW, found);
  }
  const info = probe(src);
  if (info.duration < SECONDS - 0.5) {
    console.error(`${path.basename(src)} is only ${info.duration.toFixed(1)} s long: it must be at least ${SECONDS - 0.5} s.`);
    process.exit(1);
  }
  console.log(`Preparing ${clip.n} ${clip.name} (${info.width}x${info.height}, ${info.fps} fps, ${info.duration.toFixed(1)} s)${!placeholder && !noFixes && clip.fix ? ', with its touch-up' : ''}…`);
  src = touchUp(clip, src, info);
  const master = path.join(WORK, `${clip.n}-master.mp4`);
  makeMaster(src, info.fps, master);
  const m = probe(master);
  if (m.frames !== CLIP_FRAMES) {
    console.error(`Clip ${clip.n} came out ${m.frames} frames long, not ${CLIP_FRAMES}.`);
    process.exit(1);
  }
  masters.push(master);
}

console.log('Joining the four clips into one looping video…');
const montage = path.join(WORK, 'login.mp4');
makeMontage(masters, montage);

const video = `login.${hash(montage)}.mp4`;
fs.copyFileSync(montage, path.join(OUT, video));

// A poster for each shop: the first clean picture of its stretch (just after its dissolve), which is also what the
// screen shows when the video starts or when someone presses that shop's bar
const clips = CLIPS.map((clip, i) => {
  const t = (i * SEGMENT + OVERLAP / 2) / FPS;
  const tmp = path.join(WORK, `${clip.n}.webp`);
  ffmpeg(['-ss', t.toFixed(4), '-i', montage, '-frames:v', '1', '-vf', 'scale=1280:-2', '-c:v', 'libwebp', '-quality', '78', tmp]);
  const poster = `login-${clip.n}-${clip.name}.${hash(tmp)}.webp`;
  fs.copyFileSync(tmp, path.join(OUT, poster));
  return { id: clip.name, poster };
});

fs.rmSync(WORK, { recursive: true, force: true });

const meta = {
  video,
  fps: FPS,
  segmentSeconds: Number((SEGMENT / FPS).toFixed(6)),
  overlapSeconds: Number((OVERLAP / FPS).toFixed(6)),
  durationSeconds: Number(((SEGMENT * CLIPS.length) / FPS).toFixed(6)),
  clips,
};
fs.writeFileSync(GENERATED, `// Written by scripts/encode-login-videos.mjs. Do not edit by hand.\nexport const LOGIN_MEDIA = ${JSON.stringify(meta, null, 2)};\n`);

// ---------------------------------------------------------------- checks
const final = probe(path.join(OUT, video));
const size = fs.statSync(path.join(OUT, video)).size;
const wantFrames = SEGMENT * CLIPS.length;
const checks = [
  ['size', `${(size / 1048576).toFixed(1)} MB`, size <= MAX_VIDEO_BYTES],
  ['picture', `${final.width}x${final.height}`, final.width === 1920 && final.height === 1080],
  ['frame rate', `${final.fps} fps`, final.fps === FPS],
  ['frames', `${final.frames} (want ${wantFrames})`, final.frames === wantFrames],
  ['length', `${final.duration.toFixed(2)} s (want ${(wantFrames / FPS).toFixed(2)})`, Math.abs(final.duration - wantFrames / FPS) < 0.05],
];
console.log(`\n ${video}`);
let failed = false;
for (const [what, value, ok] of checks) {
  if (!ok) failed = true;
  console.log(`   ${what.padEnd(11)} ${value.padEnd(26)} ${ok ? 'ok' : 'WRONG'}`);
}
const total = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`\n Total in client/public/login-media: ${(total / 1048576).toFixed(1)} MB (${CLIPS.length} posters + the video)`);
if (failed) {
  console.error('\nSomething is off (see WRONG above). Make the source clips less busy (less grain / fast motion) if the size is the problem, and run this again.');
  process.exit(1);
}
console.log(placeholder ? '\nStand-in clips made. Put the real videos in branding/login-videos/raw and run this again without --placeholder.' : '\nDone.');
