#!/usr/bin/env node
/**
 * Makes the sign-in screen's background videos from the 4 source clips (AI videos, usually 4K).
 *
 *   node scripts/encode-login-videos.mjs               reads branding/login-videos/raw/{1..4}-*.{mp4,mov,webm,mkv}
 *   node scripts/encode-login-videos.mjs --placeholder makes 4 stand-in clips (to build and test the screen first)
 *
 * Per clip, in client/public/login-media/ (names carry a content hash, so they can be cached for a year and a new
 * clip still shows up after an update):
 *   <n>-<name>-1080.<hash>.mp4   1080p30 H.264 high, ~2-4 MB, normal computers
 *   <n>-<name>-720.<hash>.mp4    720p24 H.264 main, ~1 MB, slow computers (the app's lite mode)
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
const MAX_1080_BYTES = 4.5 * 1024 * 1024;
const MAX_720_BYTES = 2 * 1024 * 1024;
const FONT = 'C\\:/Windows/Fonts/segoeuib.ttf'; // placeholder clips only (escaped for ffmpeg's filter syntax)

const CLIPS = [
  { n: 1, name: 'grocery', label: 'Grocery', colors: '0x14532d:0x0f766e' },
  { n: 2, name: 'pharmacy', label: 'Pharmacy', colors: '0x0c4a6e:0x0e7490' },
  { n: 3, name: 'clothing', label: 'Clothing', colors: '0x581c87:0xbe185d' },
  { n: 4, name: 'restaurant', label: 'Restaurant', colors: '0x7c2d12:0xb45309' },
];

const placeholder = process.argv.includes('--placeholder');

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
  const j = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name:format=duration',
    '-of', 'json', file]));
  return { width: j.streams[0].width, height: j.streams[0].height, codec: j.streams[0].codec_name, duration: Number(j.format.duration) };
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

function encode(src, w, h, fps, profile, crf, maxrate, bufsize, gop, dest) {
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps},format=yuv420p`;
  ffmpeg(['-i', src, '-t', String(SECONDS), '-vf', vf, '-c:v', 'libx264', '-profile:v', profile, '-preset', 'slow', '-crf', String(crf),
    '-maxrate', maxrate, '-bufsize', bufsize, '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-movflags', '+faststart', '-an', dest]);
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
  console.log(`Encoding ${clip.n} ${clip.name} (${info.width}x${info.height}, ${info.duration.toFixed(1)} s, ${info.codec})…`);

  const t1080 = path.join(WORK, `${clip.n}-1080.mp4`);
  const t720 = path.join(WORK, `${clip.n}-720.mp4`);
  const tPoster = path.join(WORK, `${clip.n}.webp`);
  encode(src, 1920, 1080, 30, 'high', 23, '4M', '8M', 60, t1080);
  encode(src, 1280, 720, 24, 'main', 25, '1.6M', '3.2M', 48, t720);
  ffmpeg(['-ss', '0.4', '-i', t1080, '-frames:v', '1', '-vf', 'scale=1280:-2', '-c:v', 'libwebp', '-quality', '78', tPoster]);

  const named = {
    video1080: `${clip.n}-${clip.name}-1080.${hash(t1080)}.mp4`,
    video720: `${clip.n}-${clip.name}-720.${hash(t720)}.mp4`,
    poster: `${clip.n}-${clip.name}.${hash(tPoster)}.webp`,
  };
  fs.copyFileSync(t1080, path.join(OUT, named.video1080));
  fs.copyFileSync(t720, path.join(OUT, named.video720));
  fs.copyFileSync(tPoster, path.join(OUT, named.poster));
  names.push({ id: clip.name, ...named });

  for (const [label, file, max] of [['1080p', named.video1080, MAX_1080_BYTES], ['720p', named.video720, MAX_720_BYTES], ['poster', named.poster, Infinity]]) {
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
fs.writeFileSync(GENERATED, `${header}export const LOGIN_MEDIA_FILES: Array<{ id: string; video1080: string; video720: string; poster: string }> = ${JSON.stringify(names, null, 2)};\n`);

console.log('\n clip  file    size        length    bytes     check');
for (const r of rows) console.log(` ${String(r[0]).padEnd(5)} ${String(r[1]).padEnd(7)} ${String(r[2]).padEnd(11)} ${String(r[3]).padEnd(9)} ${String(r[4]).padEnd(9)} ${r[5]}`);
const total = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`\nTotal in client/public/login-media: ${(total / 1048576).toFixed(1)} MB`);
if (failed) {
  console.error('\nSome files are over budget. Make the source clip less busy (less grain / fast motion) or shorter, and run this again.');
  process.exit(1);
}
console.log(placeholder ? '\nStand-in clips made. Put the real videos in branding/login-videos/raw and run this again without --placeholder.' : '\nDone.');
