import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cliWrapper } from '../bootstrap.ts';

test('installed CLI resolves current PATH Node and preserves paths and arguments',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ascr-wrapper-'));
  try {
    const root=join(dir,"repo's directory"),config=join(dir,"config's file.json"),wrapper=join(dir,'ascr');
    writeFileSync(wrapper,cliWrapper(root,config),{mode:0o755});
    writeFileSync(join(dir,'node'),'#!/bin/sh\nprintf \'%s\\n\' "$ASCR_CONFIG" "$@"\n',{mode:0o755});
    const r=spawnSync(wrapper,['run','json-pick','/a b'],{encoding:'utf8',env:{...process.env,PATH:dir}});
    assert.equal(r.status,0,r.stderr);
    assert.deepEqual(r.stdout.trimEnd().split('\n'),[config,'--experimental-strip-types','--disable-warning=ExperimentalWarning',join(root,'src','cli.ts'),'run','json-pick','/a b']);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
