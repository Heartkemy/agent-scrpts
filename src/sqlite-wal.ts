import { openSync, closeSync, readSync, writeSync, fstatSync, copyFileSync, constants, truncateSync } from 'node:fs';
import { resolve } from 'node:path';

// Forensic overlay, including uncommitted pages. The output is a candidate,
// never a replacement database: validate it with SQLite before extracting rows.
export function walOverlay(wal: string, database?: string, output?: string) {
  if (!!database !== !!output) throw new Error('Database and new output must be supplied together');
  if (output && [wal, database!].some(p => resolve(p) === resolve(output))) throw new Error('Output must be separate');
  const fd = openSync(wal, 'r');
  try {
    const header = Buffer.alloc(32);
    if (readSync(fd, header, 0, 32, 0) !== 32) throw new Error('Truncated WAL header');
    const magic = header.readUInt32BE(0);
    if (magic !== 0x377f0682 && magic !== 0x377f0683) throw new Error('Invalid WAL magic');
    if (header.readUInt32BE(4) !== 3007000) throw new Error('Unsupported WAL version');
    const pageSize = header.readUInt32BE(8);
    if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1))) throw new Error('Invalid page size');
    const be = magic === 0x377f0683;
    let s0 = 0, s1 = 0;
    function checksum(data: Buffer, from: number, to: number) {
      for (let p = from; p < to; p += 8) {
        const a = be ? data.readUInt32BE(p) : data.readUInt32LE(p);
        const b = be ? data.readUInt32BE(p + 4) : data.readUInt32LE(p + 4);
        s0 = (s0 + a + s1) >>> 0;
        s1 = (s1 + b + s0) >>> 0;
      }
    }
    checksum(header, 0, 24);
    if (s0 !== header.readUInt32BE(24) || s1 !== header.readUInt32BE(28)) throw new Error('WAL header checksum mismatch');
    const frameSize = pageSize + 24;
    const size = fstatSync(fd).size;
    const chunk = Buffer.alloc(frameSize * 2048);
    const pages = new Map<number, number>();
    let validFrames = 0, lastCommitFrame = 0, commitPages = 0, maxPage = 0;
    let stopReason = 'end of file';
    outer: for (let offset = 32; offset + frameSize <= size;) {
      const count = readSync(fd, chunk, 0, Math.min(chunk.length, size - offset), offset);
      const complete = Math.floor(count / frameSize);
      if (!complete) break;
      for (let i = 0; i < complete; i++) {
        const p = i * frameSize;
        if (chunk.readUInt32BE(p + 8) !== header.readUInt32BE(16) || chunk.readUInt32BE(p + 12) !== header.readUInt32BE(20)) {
          stopReason = 'salt mismatch'; break outer;
        }
        const page = chunk.readUInt32BE(p), commit = chunk.readUInt32BE(p + 4);
        if (!page || page > 0xfffffffe) { stopReason = 'invalid page number'; break outer; }
        checksum(chunk, p, p + 8);
        checksum(chunk, p + 24, p + frameSize);
        if (s0 !== chunk.readUInt32BE(p + 16) || s1 !== chunk.readUInt32BE(p + 20)) {
          stopReason = 'frame checksum mismatch'; break outer;
        }
        validFrames++;
        pages.set(page, offset + p + 24);
        maxPage = Math.max(maxPage, page);
        if (commit) { lastCommitFrame = validFrames; commitPages = commit; }
      }
      offset += complete * frameSize;
    }
    if (output) {
      copyFileSync(database!, output, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      const dest = openSync(output, 'r+');
      try {
        const page = Buffer.alloc(pageSize);
        for (const [number, offset] of pages) {
          if (readSync(fd, page, 0, pageSize, offset) !== pageSize) throw new Error('WAL changed during overlay');
          if (writeSync(dest, page, 0, pageSize, (number - 1) * pageSize) !== pageSize) throw new Error('Short page write');
        }
        // Uncommitted transactions may have allocated pages beyond the last
        // committed size. Keep them for forensic extraction; never label valid.
        const targetPages = validFrames === lastCommitFrame ? commitPages : Math.max(commitPages, maxPage);
        if (targetPages) truncateSync(output, targetPages * pageSize);
      } finally { closeSync(dest); }
    }
    return {pageSize, validFrames, lastCommitFrame, uncommittedFrames: validFrames-lastCommitFrame, distinctPages: pages.size, maxPage, commitPages, stopReason, output: output ?? null, requiresSQLiteValidation: !!output};
  } finally { closeSync(fd); }
}
