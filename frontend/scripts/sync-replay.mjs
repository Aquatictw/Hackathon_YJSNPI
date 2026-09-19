import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseReplay} from '../lib/rtdi/replay.ts';
const source=new URL('../../results/replay/summary.json',import.meta.url);
const text=await readFile(source,'utf8');parseReplay(JSON.parse(text));
const target=new URL('../public/replay/',import.meta.url);await mkdir(target,{recursive:true});
await writeFile(new URL('summary.json',target),text);
await writeFile(new URL('source.json',target),JSON.stringify({source:'results/replay/summary.json',mode:'replay',sha256:createHash('sha256').update(text).digest('hex')},null,2)+'\n');
console.log('Validated replay snapshot copied; no live data or API call.');
