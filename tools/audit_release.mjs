import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8'),issues=[];
const game=read('src/game.js'),pkg=JSON.parse(read('package.json')),vite=read('vite.config.js'),verify=read('tools/verify_build.mjs'),smoke=read('tests/smoke.spec.js');
const version=vite.match(/const appVersion=`([RU]\d+)-/)?.[1];
if(!version)issues.push('vite app version is missing');
if(version&&!verify.includes(`\`${version}-`))issues.push(`verify_build version does not match ${version}`);
if(version&&!smoke.includes(`^${version}-`))issues.push(`smoke PWA version does not match ${version}`);

const globals=game.match(/export const GLOBALS\s*=\s*\{([\s\S]*?)\n\};/)?.[1]||'',globalNames=new Set(globals.match(/\b[A-Za-z_$][\w$]*\b/g)||[]);
const handlers=new Set([...game.matchAll(/onclick="([A-Za-z_$][\w$]*)\s*\(/g)].map(match=>match[1]));
for(const handler of handlers)if(!new Set(['if']).has(handler)&&!globalNames.has(handler))issues.push(`inline handler is not exported through GLOBALS: ${handler}`);

const declarations=[...game.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map(match=>match[1]),seen=new Set();
for(const name of declarations){if(seen.has(name))issues.push(`duplicate game function declaration: ${name}`);seen.add(name);}
const gameLines=game.split(/\r?\n/).length;if(gameLines>3900)issues.push(`game.js ${gameLines} lines exceeds U7 ceiling 3900`);
for(const file of ['src/mastery.js','src/pathfinding.js','src/runtime.js','src/combat-rules.js','src/combat-resolution.js','src/enemy-ai.js'])if(!fs.existsSync(path.join(root,file)))issues.push(`engine module missing: ${file}`);
for(const spec of ['hotfix-skill.spec.js','r20-engine.spec.js','r21-progression.spec.js','r22-environment.spec.js','r23-campaign-battles.spec.js','r24-graphics.spec.js','r25-endgame.spec.js','r26-stability.spec.js','u7-completion.spec.js','u8-source.spec.js'])if(!pkg.scripts['test:smoke'].includes(spec))issues.push(`test:smoke missing ${spec}`);
if(!read('docs/COMPLETION_AUDIT.md').includes('U8 완료'))issues.push('U8 completion audit is not signed off');

const dist=path.join(root,'dist','assets');let chunks=[];
if(fs.existsSync(dist)){
  chunks=fs.readdirSync(dist).filter(file=>file.endsWith('.js')).map(file=>({file,bytes:fs.statSync(path.join(dist,file)).size}));
  for(const chunk of chunks)if(chunk.bytes>500*1024)issues.push(`JavaScript chunk ${chunk.file} exceeds 500 KiB (${chunk.bytes})`);
  if(chunks.reduce((sum,item)=>sum+item.bytes,0)>900*1024)issues.push('total JavaScript exceeds 900 KiB');
}

if(issues.length){console.error('U7 RELEASE AUDIT FAILED');for(const issue of issues)console.error(' -',issue);process.exit(1);}
console.log(`U8 RELEASE AUDIT OK · game.js ${gameLines}줄 · 인라인 핸들러 ${handlers.size}개 · JS 청크 ${chunks.length||'빌드 전'}개${chunks.length?` · 최대 ${Math.ceil(Math.max(...chunks.map(item=>item.bytes))/1024)}KiB`:''}`);
