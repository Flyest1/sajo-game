export const LUNJIAN_HEROES=Object.freeze([
  'gj','hy','yg','syn','jmk','jomin','sb','dy','hj','zbt','wjy','ijy',
]);

export const LUNJIAN_BLESSINGS=Object.freeze({
  power:{name:'파진결',desc:'전원 힘·내공 +1',stats:{str:1,int:1}},
  guard:{name:'호심결',desc:'전원 방어·정신 +1',stats:{def:1,res:1}},
  speed:{name:'유운결',desc:'전원 속도·기술 +1',stats:{spd:1,skl:1}},
});

export const LUNJIAN_ROUNDS=Object.freeze([
  {boss:'mcp',arena:0,title:'흑풍쌍살의 그림자',minions:['jhp','dj'],boost:.82,guard:8,
    phases:[{at:.62,name:'구음백골조',stats:{spd:.12,skl:.08},guardRatio:.16,tactic:'hunter'}]},
  {boss:'imsu',arena:7,title:'적련선자의 빙백',minions:['hnp','sap'],boost:.88,guard:9,
    phases:[{at:.62,name:'빙백독장',stats:{int:.14,spd:.08},guardRatio:.18,tactic:'hunter'}]},
  {boss:'sgon',arena:11,title:'혼원벽력의 음모',minions:['ydg','ydg','gdb'],boost:.92,guard:10,
    phases:[{at:.65,name:'환음지',stats:{str:.14,skl:.1},guardRatio:.19,tactic:'leader'}]},
  {boss:'myb',arena:4,title:'이화접목의 공자',minions:['mgs','mgs','mgb'],boost:.96,guard:11,
    phases:[{at:.68,name:'두전성이',stats:{spd:.16,res:.08},guardRatio:.2,tactic:'execute'}]},
  {boss:'gmj',arena:17,title:'화염도의 국사',minions:['sab','sab','sap'],boost:1,guard:12,
    phases:[{at:.66,name:'소무상공',stats:{int:.17,res:.1},guardRatio:.21,tactic:'leader'}]},
  {boss:'jcc',arena:7,title:'화공대법의 독무',minions:['ssj','ssj','ssj','myg'],boost:1.04,guard:13,
    phases:[{at:.64,name:'화공독무',stats:{int:.18,skl:.1},guardRatio:.22,tactic:'execute'}]},
  {boss:'grb',arena:11,title:'오륜의 회전',minions:['mgb','mgs','mgs','gdb'],boost:1,guard:15,
    phases:[{at:.7,name:'오륜연격',stats:{int:.18,def:.1},guardRatio:.24,tactic:'leader'},{at:.34,name:'용상반야',stats:{int:.22,str:.12},guardRatio:.26,tactic:'execute'}]},
  {boss:'oyb',arena:17,title:'서독의 역구음',minions:['ogg','sab','sab','yjo'],boost:1.03,guard:18,
    phases:[{at:.72,name:'영사반격',stats:{int:.18,spd:.1},guardRatio:.23,tactic:'hunter'},{at:.32,name:'역구음합마',stats:{int:.24,res:.12},guardRatio:.28,tactic:'execute'}]},
]);

export function makeLunjianBattle(index,chapters){
  const round=LUNJIAN_ROUNDS[index],base=chapters[round.arena];
  const positions=(base.enemies||[]).map(enemy=>[enemy.x,enemy.y]);
  const fallback=[[base.map[0].length-3,2],[base.map[0].length-4,4],[base.map[0].length-3,6],[base.map[0].length-5,3],[base.map[0].length-5,7]];
  while(positions.length<round.minions.length+1) positions.push(fallback[positions.length%fallback.length]);
  const [bx,by]=positions[0];
  const enemies=[{cid:round.boss,x:bx,y:by,boss:true,boost:round.boost,guard:round.guard}];
  round.minions.forEach((cid,i)=>{const [x,y]=positions[i+1];enemies.push({cid,x,y,boost:Math.max(.76,round.boost-.12)});});
  return {
    no:10+index,title:`천하논검 ${index+1}관 — ${round.title}`,joins:[],map:base.map,spawns:base.spawns,
    enemies,win:{type:'boss',boss:round.boss,text:`${index+1}관주 격파`},lose:'전원 퇴각 시 패배',defeat:{type:'all'},
    deploy:{cap:4},bossPhases:round.phases,pre:[],post:[],sceneTheme:index===7?'huashan':null,
  };
}

const PLAIN_MAP=[
  '............','...f....f...','............','..hh....hh..','............','...f....f...','............','............',
];
const STONE_MAP=[
  'mmmm....mmmm','m..........m','....hh......','............','......hh....','m..........m','mmmm....mmmm','............',
];
const SPAWNS=[[1,2],[1,5],[2,3],[2,6]];

export const TRIALS=Object.freeze([
  {id:'flash',title:'전광의 한 수',school:'기초',brief:'두 협객으로 흩어진 적을 가장 짧은 수에 쓰러뜨린다.',party:['gj','hy'],level:9,map:PLAIN_MAP,spawns:SPAWNS,
    enemies:[{cid:'dj',x:6,y:2,boost:.58},{cid:'dj',x:6,y:5,boost:.58}],objective:{type:'rout',text:'도적 2명 격파'},
    gold:{turns:1,noLoss:true},silver:{turns:2},goldText:'1턴·전원 생존',silverText:'2턴 이내'},
  {id:'guard',title:'호신강기의 틈',school:'파훼',brief:'강적의 호신강기를 먼저 무너뜨린 뒤 결정타를 넣는다.',party:['gj','hy'],level:10,map:STONE_MAP,spawns:SPAWNS,
    enemies:[{cid:'mcp',x:8,y:3,boss:true,boost:.7,guard:5}],objective:{type:'boss',boss:'mcp',text:'매초풍 격파'},
    gold:{turns:3,guardBreaks:1,noLoss:true},silver:{turns:5},goldText:'3턴·강기 파훼·전원 생존',silverText:'5턴 이내'},
  {id:'mercy',title:'살리지 않는 승리',school:'제압',brief:'양강을 쓰러뜨리지 않고 체력 20%에서 제압한다.',party:['gj','hy'],level:10,map:PLAIN_MAP,spawns:SPAWNS,
    enemies:[{cid:'ygang',x:7,y:3,boss:true,boost:.72,guard:4}],objective:{type:'subdue',target:'ygang',threshold:.2,text:'양강 비살상 제압'},
    gold:{turns:3,enemyKillsMax:0,noLoss:true},silver:{turns:5,enemyKillsMax:0},goldText:'3턴·무사상',silverText:'5턴·무사상'},
  {id:'twoseals',title:'두 봉우리의 인장',school:'점거',brief:'양과와 소용녀를 갈라 두 거점을 동시에 점령한다.',party:['yg','syn'],level:11,map:PLAIN_MAP,spawns:SPAWNS,
    enemies:[{cid:'hnp',x:7,y:3,boost:.7,wait:1},{cid:'sap',x:8,y:5,boost:.68,wait:1}],objective:{type:'seize',tiles:[[6,1],[6,6]],text:'두 거점 동시 점령'},
    gold:{turns:2,noLoss:true},silver:{turns:4},goldText:'2턴·전원 생존',silverText:'4턴 이내'},
  {id:'escape',title:'만안사의 탈출로',school:'탈출',brief:'추격대를 뚫고 두 사람 모두 동쪽 출구에 도달한다.',party:['jmk','jjy'],level:11,map:STONE_MAP,spawns:SPAWNS,
    enemies:[{cid:'ydg',x:5,y:2,boost:.68},{cid:'ydg',x:5,y:5,boost:.68},{cid:'hbo',x:8,y:3,boost:.72,wait:1}],objective:{type:'escape',tiles:[[10,2],[10,5]],cids:['jmk','jjy'],min:2,text:'장무기·주지약 탈출'},
    gold:{turns:3,noLoss:true},silver:{turns:5},goldText:'3턴·두 사람 생존',silverText:'5턴 이내'},
  {id:'triangle',title:'삼재의 상극',school:'상성',brief:'외공·경공·내공의 상성을 읽어 세 적을 정리한다.',party:['sb','jomin','jmk'],level:11,map:PLAIN_MAP,spawns:SPAWNS,
    enemies:[{cid:'mgb',x:6,y:1,boost:.72},{cid:'mgs',x:7,y:3,boost:.72},{cid:'ydg',x:6,y:6,boost:.72}],objective:{type:'rout',text:'세 병종 전멸'},
    gold:{turns:3,noLoss:true},silver:{turns:5},goldText:'3턴·전원 생존',silverText:'5턴 이내'},
  {id:'endure',title:'독무 속의 세 호흡',school:'생존',brief:'성수파의 독진에서 세 턴을 버티고 생존한다.',party:['dy','hj'],level:11,map:STONE_MAP,spawns:SPAWNS,
    enemies:[{cid:'ssj',x:6,y:1,boost:.72},{cid:'ssj',x:7,y:3,boost:.72},{cid:'ssj',x:6,y:6,boost:.72}],objective:{type:'survive',turns:3,text:'3턴 생존'},
    gold:{damageMax:18,noLoss:true},silver:{noLoss:true},goldText:'총 피해 18 이하·전원 생존',silverText:'전원 생존'},
  {id:'brothers',title:'삼형제의 합격',school:'인연',brief:'소봉·단예·허죽의 협공과 연계로 구마지를 돌파한다.',party:['sb','dy','hj'],level:12,map:PLAIN_MAP,spawns:SPAWNS,
    enemies:[{cid:'gmj',x:8,y:3,boss:true,boost:.84,guard:8},{cid:'sab',x:7,y:1,boost:.7},{cid:'sab',x:7,y:6,boost:.7}],objective:{type:'boss',boss:'gmj',text:'구마지 격파'},
    gold:{turns:3,bondStrikes:2,guardBreaks:1,noLoss:true},silver:{turns:5,noLoss:true},goldText:'3턴·협공 2회·파훼',silverText:'5턴·전원 생존'},
  {id:'formation',title:'북두의 동시 진격',school:'복합',brief:'적장을 제압하면서 두 진지를 동시에 장악한다.',party:['wjy','zbt','gj'],level:12,map:STONE_MAP,spawns:SPAWNS,
    enemies:[{cid:'gci',x:8,y:3,boss:true,boost:.8,guard:7},{cid:'sap',x:6,y:1,boost:.7},{cid:'sap',x:6,y:6,boost:.7}],objective:{type:'all',text:'구천인 격파·두 진지 점령',objectives:[{type:'boss',boss:'gci',text:'구천인 격파'},{type:'seize',tiles:[[7,1],[7,6]],text:'두 진지'}]},
    gold:{turns:4,noLoss:true},silver:{turns:6},goldText:'4턴·전원 생존',silverText:'6턴 이내'},
  {id:'perfect',title:'서독 완전 파훼',school:'극의',brief:'네 시대의 주역으로 서독의 역구음과 수하를 돌파한다.',party:['gj','yg','jmk','sb'],level:13,map:STONE_MAP,spawns:SPAWNS,
    enemies:[{cid:'oyb',x:9,y:3,boss:true,boost:.9,guard:10},{cid:'ogg',x:7,y:1,boost:.74},{cid:'sab',x:7,y:5,boost:.74}],objective:{type:'boss',boss:'oyb',text:'구양봉 격파'},
    gold:{turns:4,guardBreaks:1,noLoss:true},silver:{turns:7,noLoss:true},goldText:'4턴·파훼·전원 생존',silverText:'7턴·전원 생존'},
]);

function meets(condition,metrics){
  if(!condition) return false;
  if(condition.turns&&metrics.turn>condition.turns) return false;
  if(condition.noLoss&&metrics.allyLost) return false;
  if(condition.damageMax!==undefined&&metrics.damageTaken>condition.damageMax) return false;
  if(condition.guardBreaks&&metrics.guardBreaks<condition.guardBreaks) return false;
  if(condition.bondStrikes&&metrics.bondStrikes<condition.bondStrikes) return false;
  if(condition.enemyKillsMax!==undefined&&metrics.enemyKills>condition.enemyKillsMax) return false;
  return true;
}

export function trialById(id){ return TRIALS.find(trial=>trial.id===id)||null; }
export function evaluateTrial(trial,metrics){ return meets(trial.gold,metrics)?'gold':(meets(trial.silver,metrics)?'silver':'bronze'); }
export function betterMedal(a,b){
  const rank={none:0,bronze:1,silver:2,gold:3};
  return (rank[b]||0)>(rank[a]||0)?b:(a||'none');
}

export function makeTrialBattle(trial){
  return {
    no:8,title:`전투 수수께끼 — ${trial.title}`,joins:[],map:trial.map,spawns:trial.spawns,enemies:trial.enemies,
    win:trial.objective,objective:trial.objective,lose:'전원 퇴각 시 패배',defeat:{type:'all'},
    deploy:{cap:trial.party.length,forced:trial.party},pre:[],post:[],trialId:trial.id,
  };
}
