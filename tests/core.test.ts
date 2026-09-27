import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { AppError, validateRequest, validateAnswerSet, assess } from '../src/protocol.ts';
import type { Config, Model, Request } from '../src/protocol.ts';
import { Router, SerialQueue } from '../src/router.ts';
import { createApp } from '../src/server.ts';
import { newWorktree, integrate, withGitLock } from '../src/git-tools.ts';

const model = (id: string, family: 'laya'|'decider'='laya'): Model => ({id, family, repo: 'test/'+id, revision:'a'.repeat(40), path:'/unused', description:id, maxTokens:512, maxChoices:16, enabled:true});
const cfg = (models=[model('laya-multilingual'),model('laya-typed')]):Config => ({version:1,root:process.cwd(),stateDir:'/unused',tokenFile:'/unused',host:'127.0.0.1',port:0,python:{},models,router:'laya-multilingual',requestTimeoutMs:10000,maxQueue:8,maxBodyBytes:65536,idleSeconds:120,memoryBudgetBytes:1e9,lowMemory:false});
const request = ():Request => ({state:'The customer was charged twice.',questions:{topic:{type:'choice',instructions:'Choose the topic.',criteria:['billing','technical']}}});
function answer(req:Request, selected?:string, strength=0.95):any {
  return {model:'test',answers:Object.fromEntries(Object.entries(req.questions).map(([id,q])=> {
    if(q.type==='noul') return [id,{type:'noul',noul:strength}];
    const labels=q.type==='score'?(q.criteria as any[]).map((_,i)=>String(i)):Array.isArray(q.criteria)?q.criteria as string[]:Object.keys(q.criteria as object);
    const choice=selected&&labels.includes(selected)?selected:labels[0];
    return [id,{type:q.type, ...(q.type==='choice'?{choice}:{score:Number(choice)}),confidence:0,probabilities:Object.fromEntries(labels.map(l=>[l,l===choice?strength:(1-strength)/(labels.length-1)]))}];
  }))};
}
class Fake {
  calls:any[]=[]; rejected=new Set<string>(); uncertain=false; fixed='laya-typed'; malformed=false;
  async inspect(m:Model,req:Request){this.calls.push(['inspect',m.id]);if(this.rejected.has(m.id))throw new AppError('INPUT_TOO_LONG','Too long',422);return {truncated:false};}
  async predict(m:Model,req:Request){this.calls.push(['predict',m.id,Object.keys(req.questions)[0]]);if(this.malformed)return {answers:{}};return answer(req,req.questions.backend?this.fixed:undefined,req.questions.backend&&this.uncertain?0.51:0.95);}
  close(){}
}
for (const type of ['choice','score','noul'] as const) test('valid typed request: '+type,()=> {
  const r=request();r.questions.topic= type==='choice'?r.questions.topic:type==='score'?{type,instructions:'Rate',criteria:['low','high']}:{type,instructions:'True?'};
  assert.equal(validateRequest(r),r);validateAnswerSet(answer(r),r);
});
for (const [name,mutate] of [
  ['unknown fields',(r:any)=>r.prompt='x'],['missing state',(r:any)=>delete r.state],['no questions',(r:any)=>r.questions={}],
  ['duplicate choices',(r:any)=>r.questions.topic.criteria=['same','same']],['single choice',(r:any)=>r.questions.topic.criteria=['one']],
  ['empty instructions',(r:any)=>r.questions.topic.instructions=' '],['unknown type',(r:any)=>r.questions.topic.type='generate'],
  ['NaN',(r:any)=>r.state=NaN],['invalid policy',(r:any)=>r.policy={minProbability:2}],
  ['invalid noul criteria',(r:any)=>r.questions.topic={type:'noul',instructions:'?',criteria:{maybe:'yes'}}],
  ['too many questions',(r:any)=>r.questions=Object.fromEntries(Array.from({length:17},(_,i)=>[String(i),r.questions.topic]))],
] as [string,(r:any)=>void][]) test('rejects '+name,()=>{const r=request();mutate(r);assert.throws(()=>validateRequest(r),AppError);});
test('cyclic/non-JSON state rejected',()=>{const r:any=request();r.state=r;assert.throws(()=>validateRequest(r),AppError);});
test('bad answer IDs rejected',()=>assert.throws(()=>validateAnswerSet({answers:{}},request()),AppError));
test('bad probability totals rejected',()=>{const r=request(),a=answer(r);a.answers.topic.probabilities.billing=.3;assert.throws(()=>validateAnswerSet(a,r),AppError);});
test('answer must be a supplied option and argmax',()=>{const r=request(),a=answer(r);a.answers.topic.choice='technical';assert.throws(()=>validateAnswerSet(a,r),AppError);});
test('non-finite backend score rejected',()=>{const r:Request={state:'x',questions:{s:{type:'score',instructions:'Rate',criteria:['low','high']}}},a=answer(r);a.answers.s.score=NaN;assert.throws(()=>validateAnswerSet(a,r),AppError);});
test('review uses probabilities, not incompatible native confidence fields',()=>{const a=answer(request()).answers;assert.equal(assess(a).topic.needsReview,false);a.topic.probabilities={billing:.51,technical:.49};a.topic.confidence=1;assert.equal(assess(a).topic.needsReview,true);});
test('negative noul can be decisive',()=>assert.equal(assess({n:{type:'noul',noul:.02}}).n.needsReview,false));
test('router selects using the fixed classifier, never recursive routing',async()=>{const b=new Fake(),r=new Router(cfg(),b),a=await r.classify(request(),Date.now()+10000);assert.equal(a.model,'laya-typed');assert.equal(a.meta.routing.mode,'classifier');assert.equal(b.calls.filter(c=>c[0]==='predict').length,2);});
test('explicit model bypasses routing inference',async()=>{const b=new Fake(),a=await new Router(cfg(),b).classify({...request(),model:'laya-typed'},Date.now()+10000);assert.equal(a.meta.routing.mode,'explicit');assert.equal(b.calls.filter(c=>c[0]==='predict').length,1);});
test('only compatible model needs no routing call',async()=>{const b=new Fake();b.rejected.add('laya-multilingual');const a=await new Router(cfg(),b).classify(request(),Date.now()+10000);assert.equal(a.meta.routing.mode,'only-compatible');assert.equal(a.model,'laya-typed');});
test('no silent truncation when no model fits',async()=>{const b=new Fake();b.rejected=new Set(['laya-multilingual','laya-typed']);await assert.rejects(new Router(cfg(),b).classify(request(),Date.now()+10000),(e:any)=>e.code==='NO_COMPATIBLE_MODEL');assert.equal(b.calls.filter(c=>c[0]==='predict').length,0);});
test('uncertain routing falls back deterministically and reports it',async()=>{const b=new Fake();b.uncertain=true;const a=await new Router(cfg(),b).classify({...request(),language:'fr'},Date.now()+10000);assert.equal(a.model,'laya-multilingual');assert.equal(a.meta.routing.reason,'uncertain_routing');});
test('disabled model cannot be explicitly selected',async()=>{const c=cfg();c.models[1].enabled=false;await assert.rejects(new Router(c,new Fake()).classify({...request(),model:'laya-typed'},Date.now()+10000),(e:any)=>e.code==='MODEL_UNAVAILABLE');});
test('cache is exact, in-memory, opt-out and order-sensitive',async()=>{const b=new Fake(),r=new Router(cfg(),b),q=request();await r.classify(q,Date.now()+10000);assert.equal((await r.classify(q,Date.now()+10000)).meta.cached,true);assert.equal((await r.classify({...q,cache:false},Date.now()+10000)).meta.cached,false);q.questions.topic.criteria=['technical','billing'];assert.equal((await r.classify(q,Date.now()+10000)).meta.cached,false);});
test('malformed model answers are not accepted',async()=>{const b=new Fake();b.malformed=true;await assert.rejects(new Router(cfg(),b).classify({...request(),model:'laya-typed'},Date.now()+10000),(e:any)=>e.code==='BAD_BACKEND_RESPONSE');});
test('queue is serialized and bounded',async()=>{const q=new SerialQueue(2),order:number[]=[];let release!:()=>void;const gate=new Promise<void>(r=>release=r);const a=q.run(async()=>{order.push(1);await gate;order.push(2);},Date.now()+10000);const b=q.run(async()=>{order.push(3);},Date.now()+10000);await assert.rejects(q.run(async()=>{},Date.now()+10000),(e:any)=>e.code==='BUSY');release();await Promise.all([a,b]);assert.deepEqual(order,[1,2,3]);assert.equal(q.pending,0);});
test('expired queued requests fail before executing',async()=>{await assert.rejects(new SerialQueue(1).run(async()=>assert.fail('must not run'),Date.now()-1),(e:any)=>e.code==='TIMEOUT');});

test('HTTP authentication, origin guard, schemas, routing and discovery',async(t)=>{
 const dir=mkdtempSync(join(tmpdir(),'ascr-http-')),token='f'.repeat(64),c=cfg();c.tokenFile=join(dir,'token');writeFileSync(c.tokenFile,token);const app=createApp(c,new Fake());
 await new Promise<void>(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${(app.server.address() as any).port}`;
 t.after(async()=>{app.backend.close();app.server.closeAllConnections();await new Promise<void>(resolve=>app.server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true});});
 const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
 await t.test('unauthenticated blocked',async()=>assert.equal((await fetch(base+'/health')).status,401));
 await t.test('Origin blocked even with token',async()=>assert.equal((await fetch(base+'/health',{headers:{...headers,Origin:'https://example.com'}})).status,401));
 await t.test('authenticated health',async()=>assert.equal((await fetch(base+'/health',{headers})).status,200));
 await t.test('model registry excludes private filesystem paths',async()=>{const r=await fetch(base+'/v1/models',{headers});assert.equal(r.status,200);assert.ok(!(await r.text()).includes('/unused'));});
 await t.test('malformed JSON returns 400',async()=>assert.equal((await fetch(base+'/v1/systemone',{method:'POST',headers,body:'{'})).status,400));
 await t.test('invalid request returns 422',async()=>assert.equal((await fetch(base+'/v1/systemone',{method:'POST',headers,body:'{}'})).status,422));
 await t.test('inference returns normalized typed result',async()=>{const r=await fetch(base+'/v1/systemone',{method:'POST',headers,body:JSON.stringify(request())});assert.equal(r.status,200);assert.equal((await r.json() as any).answers.topic.choice,'billing');});
 await t.test('wrong content type rejected',async()=>assert.equal((await fetch(base+'/v1/systemone',{method:'POST',headers:{Authorization:headers.Authorization,'Content-Type':'text/plain'},body:'{}'})).status,415));
});
test('deterministic tools: escaped JSON pointer and streaming SHA256',()=>{
 const root=new URL('..',import.meta.url).pathname,dir=mkdtempSync(join(tmpdir(),'ascr-tool-'));
 try{const f=join(dir,'input.txt');writeFileSync(f,'hello');const run=(name:string,args:string[],input?:string)=>spawnSync(process.execPath,['--experimental-strip-types','--disable-warning=ExperimentalWarning',join(root,'tools',name+'.ts'),...args],{encoding:'utf8',input});
 const p=run('json-pick',['/a~1b/~0x'],JSON.stringify({'a/b':{'~x':42}}));assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout),42);
 const h=run('sha256',[f]);assert.equal(h.status,0,h.stderr);assert.ok(h.stdout.includes(createHash('sha256').update('hello').digest('hex')));
 const missing=run('json-pick',['/absent'],'{}');assert.equal(missing.status,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Git helper creates worktrees, tests merged state and pushes without force',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ascr-git-')),remote=join(dir,'remote.git'),root=join(dir,'repo');
 const git=(cwd:string,args:string[])=>{const r=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 try{mkdirSync(root);git(dir,['init','--bare',remote]);git(root,['init','-b','main']);git(root,['config','user.name','Fixture']);git(root,['config','user.email','fixture@example.invalid']);mkdirSync(join(root,'tests'));writeFileSync(join(root,'package.json'),' {"type":"module"}\n');writeFileSync(join(root,'tests','simple.test.ts'),'import test from "node:test"; test("merged fixture",()=>{});\n');git(root,['add','.']);git(root,['commit','-m','Initial fixture']);git(root,['remote','add','origin',remote]);git(root,['push','-u','origin','main']);
 const wt=newWorktree(root,'feature');assert.ok(existsSync(wt.path));writeFileSync(join(wt.path,'feature.txt'),'works');git(wt.path,['add','feature.txt']);git(wt.path,['commit','-m','Feature']);const result=integrate(root,wt.path);assert.equal(result.status,'merged-and-pushed');assert.equal(readFileSync(join(root,'feature.txt'),'utf8'),'works');assert.equal(git(root,['rev-parse','HEAD']),git(dir,['--git-dir',remote,'rev-parse','main']));assert.equal(existsSync(wt.path),false);
 withGitLock(root,()=>assert.throws(()=>withGitLock(root,()=>{}),(e:any)=>e.code==='GIT_BUSY'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
