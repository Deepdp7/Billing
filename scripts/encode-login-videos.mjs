#!/usr/bin/env node
/**
 * Makes the sign-in screen's background clips from the 4 source clips (AI videos, usually 4K), with the same settings as
 * the PLRMS sign-in page (plrms-demo/src/components/layout/LoginHero.tsx), which plays smoothly on every PC:
 *
 *   node scripts/encode-login-videos.mjs               reads branding/login-videos/raw/{1..4}-*.{mp4,mov,webm,mkv}
 *   node scripts/encode-login-videos.mjs --placeholder makes 4 stand-in clips (to build and test the screen first)
 *   node scripts/encode-login-videos.mjs --no-fixes    leaves out the touch-ups listed under CLIPS
 *
 * Per clip, in client/public/login-media/ (names carry a content hash, so a new clip still shows up after an update):
 *   <n>-<name>.<hash>.mp4    1920x1080, 24 fps, played at 80% speed (the in-between frames are motion-interpolated, never
 *                            repeated), exactly 8.5 s (204 frames), a key picture every 2 s, H.264 high, BT.709
 *   <n>-<name>.<hash>.webp   its first picture, shown before the video starts (and instead of it for "reduce motion")
 * and the list in client/src/lib/loginMedia.generated.ts.
 *
 * H.264 only (PLRMS also ships AV1 WebM): AV1 is decoded by the processor on PCs without AV1 hardware, which most
 * low-end shop PCs are; H.264 is decoded in hardware on every Windows PC.
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
const FPS = 24;
/** Played at 80% speed: calmer movement, and more time on each shop */
const SPEED = 0.8;
/** Every clip is exactly this long: 8.5 s at 24 fps (the player's timing is built on it) */
const CLIP_FRAMES = 204;
const MAX_CLIP_BYTES = 9 * 1024 * 1024;
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
 * One finished clip. AI video tools often tag their files with the old standard-definition colour matrix (BT.601),
 * while a browser assumes the HD one (BT.709): the colours are converted and tagged, so every graphics chip shows what
 * the owner saw in the video tool. Slowed to 80% by motion interpolation (no repeated frames: they would judder).
 */
function makeClip(src, dest) {
  const vf = 'scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos:in_color_matrix=auto:out_color_matrix=bt709:out_range=tv,'
    + `crop=1920:1080,setpts=PTS/${SPEED},minterpolate=fps=${FPS}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p`;
  ffmpeg(['-i', src, '-vf', vf, '-frames:v', String(CLIP_FRAMES),
    // a key picture every 2 s (and at the very start), none added by scene detection: even work for the decoder
    '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-tune', 'film', '-crf', '20', '-maxrate', '8M', '-bufsize', '16M',
    '-g', String(FPS * 2), '-keyint_min', String(FPS * 2), '-sc_threshold', '0', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', '-an', dest]);
}

fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const clips = [];
const rows = [];
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
  const need = (CLIP_FRAMES / FPS) * SPEED;
  if (info.duration < need - 0.05) {
    console.error(`${path.basename(src)} is only ${info.duration.toFixed(1)} s long: it must be at least ${need.toFixed(1)} s.`);
    process.exit(1);
  }
  console.log(`Encoding ${clip.n} ${clip.name} (${info.width}x${info.height}, ${info.fps} fps, ${info.duration.toFixed(1)} s)${!placeholder && !noFixes && clip.fix ? ', with its touch-up' : ''}…`);
  src = touchUp(clip, src, info);
  const tmp = path.join(WORK, `${clip.n}.mp4`);
  const tmpPoster = path.join(WORK, `${clip.n}.webp`);
  makeClip(src, tmp);
  ffmpeg(['-i', tmp, '-frames:v', '1', '-vf', 'scale=1280:-2', '-c:v', 'libwebp', '-quality', '78', tmpPoster]);
  const video = `${clip.n}-${clip.name}.${hash(tmp)}.mp4`;
  const poster = `${clip.n}-${clip.name}.${hash(tmpPoster)}.webp`;
  fs.copyFileSync(tmp, path.join(OUT, video));
  fs.copyFileSync(tmpPoster, path.join(OUT, poster));
  clips.push({ id: clip.name, video, poster });

  const m = probe(path.join(OUT, video));
  const size = fs.statSync(path.join(OUT, video)).size;
  const ok = size <= MAX_CLIP_BYTES && m.width === 1920 && m.height === 1080 && m.fps === FPS && m.frames === CLIP_FRAMES;
  if (!ok) failed = true;
  rows.push([clip.n, clip.name, `${m.width}x${m.height}`, `${m.fps} fps`, `${m.frames} frames`, `${m.duration.toFixed(2)} s`, `${(size / 1048576).toFixed(1)} MB`, ok ? 'ok' : 'WRONG']);
}

fs.rmSync(WORK, { recursive: true, force: true });

const meta = { clipMs: Math.round((CLIP_FRAMES / FPS) * 1000), fadeMs: 1200, clips };
fs.writeFileSync(GENERATED, `// Written by scripts/encode-login-videos.mjs. Do not edit by hand.\nexport const LOGIN_MEDIA = ${JSON.stringify(meta, null, 2)};\n`);

console.log('\n clip  name        picture     rate    frames      length   size     check');
for (const r of rows) console.log(` ${String(r[0]).padEnd(5)} ${String(r[1]).padEnd(11)} ${r[2].padEnd(11)} ${r[3].padEnd(7)} ${r[4].padEnd(11)} ${r[5].padEnd(8)} ${r[6].padEnd(8)} ${r[7]}`);
const total = fs.readdirSync(OUT).reduce((t, f) => t + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`\n Total in client/public/login-media: ${(total / 1048576).toFixed(1)} MB`);
if (failed) {
  console.error('\nSomething is off (see WRONG above). Make the source clips less busy (less grain / fast motion) if the size is the problem, and run this again.');
  process.exit(1);
}
console.log(placeholder ? '\nStand-in clips made. Put the real videos in branding/login-videos/raw and run this again without --placeholder.' : '\nDone.');
