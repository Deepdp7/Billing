#!/usr/bin/env node
/**
 * Makes the sign-in screen's background videos from the 4 source clips (AI videos, usually 4K).
 *
 *   node scripts/encode-login-videos.mjs               reads branding/login-videos/raw/{1..4}-*.{mp4,mov,webm,mkv}
 *   node scripts/encode-login-videos.mjs --placeholder makes 4 stand-in clips (to build and test the screen first)
 *
 * Per clip, in client/public/login-media/ (names carry a content hash, so they can be cached for a year and a new
 * clip still shows up after an update):
 *   <n>-<name>-1080.<hash>.mp4   1080p30 H.264 high, BT.709, ~3-4 MB, every computer
 *   <n>-<name>.<hash>.webp       poster, painted at once before the video starts
 * and the list of names in client/src/lib/loginMedia.generated.ts.
 *
 * H.264 on purpose: every Windows PC decodes it in hardware (AV1 / VP9 can fall back to slow software decoding).
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
// 30 frames a second: a 60 Hz screen shows each frame exactly twice, so slow camera moves glide. 24 fps (what AI tools
// make) is shown 3-2-3-2 times, which reads as a stutter on a slow dolly; 25 or 26 would be worse still. The frames in
// between are made by motion interpolation (not by repeating frames, which would judder).
const FPS = 30;
const MAX_1080_BYTES = 4.5 * 1024 * 1024;
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
  const j = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,r_frame_rate:format=duration',
    '-of', 'json', file]));
  const [num, den] = String(j.streams[0].r_frame_rate || '0/1').split('/').map(Number);
  return { width: j.streams[0].width, height: j.streams[0].height, codec: j.streams[0].codec_name, duration: Number(j.format.duration), fps: den ? num / den : 0 };
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
 * AI video tools often tag their files with the old standard-definition colour matrix (BT.601), while a browser assumes
 * the HD one (BT.709) for anything it cannot be sure of. The colours are converted to BT.709 here and tagged as such, so
 * every browser and graphics chip shows what the owner saw in the video tool.
 */
function encode(src, srcFps, w, h, fps, profile, crf, maxrate, bufsize, gop, dest) {
  // A slower source gets its missing frames by motion interpolation (the last frame is repeated once first, so the
  // interpolated clip is still a full 8 s); a source that is already fast enough is just resampled
  const rate = srcFps && srcFps < fps - 0.5
    ? `tpad=stop_mode=clone:stop=1,minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
    : `fps=${fps}`;
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos:in_color_matrix=auto:out_color_matrix=bt709:out_range=tv,`
    + `crop=${w}:${h},${rate},format=yuv420p`;
  ffmpeg(['-i', src, '-t', String(SECONDS), '-vf', vf, '-c:v', 'libx264', '-profile:v', profile, '-preset', 'slow', '-tune', 'film', '-crf', String(crf),
    '-maxrate', maxrate, '-bufsize', bufsize, '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', '-an', dest]);
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

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const rows = [];
const names = [];
let failed = false;

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
  console.log(`Encoding ${clip.n} ${clip.name} (${info.width}x${info.height}, ${info.duration.toFixed(1)} s, ${info.codec})${!placeholder && !noFixes && clip.fix ? ', with its touch-up' : ''}…`);
  src = touchUp(clip, src, info);

  const t1080 = path.join(WORK, `${clip.n}-1080.mp4`);
  const tPoster = path.join(WORK, `${clip.n}.webp`);
  encode(src, info.fps, 1920, 1080, FPS, 'high', 23, '4M', '8M', FPS * 2, t1080);
  ffmpeg(['-i', t1080, '-frames:v', '1', '-vf', 'scale=1280:-2', '-c:v', 'libwebp', '-quality', '78', tPoster]);

  const named = {
    video1080: `${clip.n}-${clip.name}-1080.${hash(t1080)}.mp4`,
    poster: `${clip.n}-${clip.name}.${hash(tPoster)}.webp`,
  };
  fs.copyFileSync(t1080, path.join(OUT, named.video1080));
  fs.copyFileSync(tPoster, path.join(OUT, named.poster));
  names.push({ id: clip.name, ...named });

  for (const [label, file, max] of [['1080p', named.video1080, MAX_1080_BYTES], ['poster', named.poster, Infinity]]) {
    const p = path.join(OUT, file);
    const size = fs.statSync(p).size;
    const meta = label === 'poster' ? { width: 1280, height: '-', duration: 0 } : probe(p);
    const ok = size <= max && (label === 'poster' || meta.duration >= SECONDS - 0.5);
    if (!ok) failed = true;
    rows.push([clip.n, label, `${meta.width}x${meta.height}`, label === 'poster' ? '-' : `${meta.duration.toFixed(2)} s`, `${(size / 1024).toFixed(0)} KB`, ok ? 'ok' : 'TOO BIG']);
  }
}

fs.rmSync(WORK, { recursive: true, force: true });

const header = `// Written by scripts/encode-login-videos.mjs. Do not edit by hand.\n`;
fs.writeFileSync(GENERATED, `${header}export const LOGIN_MEDIA_FILES: Array<{ id: string; video1080: string; poster: string }> = ${JSON.stringify(names, null, 2)};\n`);

console.log('\n clip  file    size        length    bytes     check');
for (const r of rows) console.log(` ${String(r[0]).padEnd(5)} ${String(r[1]).padEnd(7)} ${String(r[2]).padEnd(11)} ${String(r[3]).padEnd(9)} ${String(r[4]).padEnd(9)} ${r[5]}`);
const total = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`\nTotal in client/public/login-media: ${(total / 1048576).toFixed(1)} MB`);
if (failed) {
  console.error('\nSome files are over budget. Make the source clip less busy (less grain / fast motion) or shorter, and run this again.');
  process.exit(1);
}
console.log(placeholder ? '\nStand-in clips made. Put the real videos in branding/login-videos/raw and run this again without --placeholder.' : '\nDone.');
