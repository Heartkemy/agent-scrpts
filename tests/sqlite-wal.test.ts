import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walOverlay } from '../src/sqlite-wal.ts';

for (const be of [false,true]) test(`WAL committed plus uncommitted recovery (${be ? 'BE':'LE'})`, () => {
  const dir=mkdtempSync(join(tmpdir(),'wal-test-'));
  try {
    let s0=0,s1=0;
    function sum(b:Buffer,start:number,end:number){for(let p=start;p<end;p+=8){s0=(s0+(be?b.readUInt32BE(p):b.readUInt32LE(p))+s1)>>>0;s1=(s1+(be?b.readUInt32BE(p+4):b.readUInt32LE(p+4))+s0)>>>0;}}
    const h=Buffer.alloc(32);h.writeUInt32BE(be?0x377f0683:0x377f0682,0);h.writeUInt32BE(3007000,4);h.writeUInt32BE(512,8);h.writeUInt32BE(7,16);h.writeUInt32BE(9,20);sum(h,0,24);h.writeUInt32BE(s0,24);h.writeUInt32BE(s1,28);
    function frame(page:number,commit:number,value:number){const f=Buffer.alloc(536);f.writeUInt32BE(page,0);f.writeUInt32BE(commit,4);h.copy(f,8,16,24);f.fill(value,24);sum(f,0,8);sum(f,24,536);f.writeUInt32BE(s0,16);f.writeUInt32BE(s1,20);return f;}
    const wal=join(dir,'input-wal'),db=join(dir,'input'),out=join(dir,'candidate');
    const first=frame(1,1,11),pending=frame(2,0,22),invalid=frame(1,0,33);invalid[24]^=1;
    writeFileSync(wal,Buffer.concat([h,first,pending,invalid]));writeFileSync(db,Buffer.alloc(512));
    const result=walOverlay(wal,db,out);
    assert.equal(result.validFrames,2);assert.equal(result.uncommittedFrames,1);assert.equal(result.stopReason,'frame checksum mismatch');
    assert.equal(readFileSync(out).length,1024);assert.equal(readFileSync(out)[512],22);assert.equal(readFileSync(db)[0],0);
    assert.throws(()=>walOverlay(wal,db,out));assert.throws(()=>walOverlay(wal,db,db));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
