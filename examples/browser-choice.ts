/** Example only: reads an extracted DOM/accessibility snapshot; never clicks anything. */
import { readFileSync } from 'node:fs';
import { classify } from '../src/client.ts';
const input = JSON.parse(readFileSync(process.argv[2] || 0, 'utf8'));
if (typeof input.goal !== 'string' || !Array.isArray(input.candidates) || input.candidates.length < 2) throw new Error('Provide {goal, candidates:[{id,text}]} from a fresh page snapshot.');
const candidates = new Map<string, string>();
for (const c of input.candidates) {
  if (typeof c.id !== 'string' || !c.id || typeof c.text !== 'string' || candidates.has(c.id)) throw new Error('Candidates need distinct stable IDs and text.');
  candidates.set(c.id,c.text);
}
const result = await classify({state:input.goal, task:'Choose a browser UI candidate; do not execute it', cache:false,
  questions:{target:{type:'choice', instructions:'Which candidate matches the goal?', criteria:Object.fromEntries(candidates)}}});
if(result.status !== 'ok') { console.log(JSON.stringify({action:'review',result},null,2));process.exitCode=3; }
else {
  const id=result.answers.target.choice;
  if(!candidates.has(id)) throw new Error('Classifier selected an unknown candidate.');
  console.log(JSON.stringify({candidateId:id,action:'selection-only',requiredNextStep:'Check permission, reacquire the current page, resolve this ID, then independently verify any authorized action.'},null,2));
}
