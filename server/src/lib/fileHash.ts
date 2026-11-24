import crypto from 'crypto';
import fs from 'fs';

/**
 * SHA-256 of a file, read 8 MB at a time. A big shop's database (a mall store: several GB) never sits in memory whole:
 * reading it in one piece failed above 2 GB and used gigabytes of a 4 GB computer's memory.
 */
export function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const buf = Buffer.allocUnsafe(8 * 1024 * 1024);
  const fd = fs.openSync(filePath, 'r');
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}
