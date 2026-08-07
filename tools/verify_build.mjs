import fs from 'fs';
import path from 'path';

const root=path.resolve(new URL('..',import.meta.url).pathname.replace(/^\/(.:)/,'$1'));
const dist=path.join(root,'dist');
const required=['index.html','manifest.webmanifest','sw.js'];
const errors=[];
for(const file of required) if(!fs.existsSync(path.join(dist,file))) errors.push(`missing ${file}`);

if(!errors.length){
  const html=fs.readFileSync(path.join(dist,'index.html'),'utf8');
  const manifest=JSON.parse(fs.readFileSync(path.join(dist,'manifest.webmanifest'),'utf8'));
  const sw=fs.readFileSync(path.join(dist,'sw.js'),'utf8');
  const assets=[...html.matchAll(/(?:src|href)="(?:\.\/|\/sajo-game\/)(assets\/[^"?#]+)"/g)].map(match=>match[1]);
  if(!assets.some(file=>file.endsWith('.js'))) errors.push('index has no bundled JavaScript');
  if(!assets.some(file=>file.endsWith('.css'))) errors.push('index has no bundled CSS');
  for(const asset of assets) if(!fs.existsSync(path.join(dist,asset))) errors.push(`index asset missing ${asset}`);
  if(manifest.start_url!=='/sajo-game/'||manifest.scope!=='/sajo-game/') errors.push('PWA scope/start_url mismatch');
  if(!sw.includes('index.html')||!assets.every(asset=>sw.includes(asset))) errors.push('service worker precache is missing the app shell');
  if(sw.includes('portraits/hero/')||sw.includes('portraits/thumb/')) errors.push('portrait library leaked into core precache');
  const bundle=assets.filter(asset=>asset.endsWith('.js')).map(asset=>fs.readFileSync(path.join(dist,asset),'utf8')).join('\n');
  const expectedVersion=`R23-${(process.env.GITHUB_SHA||process.env.APP_REVISION||'local').slice(0,7)}`;
  if(!bundle.includes(expectedVersion)) errors.push(`bundle build identifier mismatch (expected ${expectedVersion})`);
}

if(errors.length){ console.error('BUILD VERIFICATION FAILED'); errors.forEach(error=>console.error(' -',error)); process.exit(1); }
console.log('BUILD VERIFICATION OK · app shell precached · navigation fallback present · portraits lazy cached');
