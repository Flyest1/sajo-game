/* 원작에서 실제로 익혔거나 명확히 보여 준 수련·전투 성향만 게임 규칙으로 번역한다.
   정식 명칭이 없는 경우 kind를 '특성'으로 두어 가공 내공처럼 보이지 않게 한다. */
export const INTERNALS=Object.freeze({
  gj_jiuyin:{name:'구음진경',kind:'내공',role:'균형·파훼',unlockLevel:8,source:'사조영웅전 · 도화도에서 전권을 익히고 총강의 강유상제를 깨달음',desc:'강유를 고르게 운용해 명중과 파훼가 안정된다.',effects:{stats:{res:1,skl:1},hit:3,guardDamage:1,kiOnBreak:2}},
  gj_quanzhen:{name:'전진현문내공',kind:'내공',role:'지속전',source:'사조영웅전 · 마옥에게 전진교 내공의 기초를 전수받음',desc:'정순한 호흡으로 기력을 오래 유지한다.',effects:{stats:{def:1,ki:4},turnKi:1}},
  hy_qimen:{name:'기문둔갑',kind:'특성',role:'간파·회피',source:'사조영웅전 · 도화도의 오행팔괘와 기문둔갑에 정통',desc:'진세와 빈틈을 읽어 명중과 회피가 상승한다.',effects:{hit:5,avoid:6,guardDamage:1}},
  hy_jiuyin:{name:'구음요결',kind:'내공',role:'정신·회복',unlockLevel:8,source:'사조영웅전 이후 · 곽정과 함께 구음진경을 연구함',desc:'구음의 요결로 내력과 정신을 고르게 다스린다.',effects:{stats:{int:1,res:1},turnKi:1}},
  yg_heavy:{name:'중검무봉',kind:'특성',role:'중격·파훼',unlockLevel:10,source:'신조협려 · 신조의 인도로 현철중검을 들고 해조와 폭포에서 수련',desc:'움직임을 줄이고 축적한 힘을 한 번에 쏟는다.',effects:{stationaryDamage:.18,guardDamage:1}},
  yg_yunu:{name:'옥녀심경',kind:'내공',role:'기동·연계',unlockLevel:4,source:'신조협려 · 소용녀와 함께 고묘파 옥녀심경을 수련',desc:'빠른 신법과 초식의 연결이 날카로워진다.',effects:{stats:{spd:1,skl:1},comboDamage:.08}},
  syn_yunu:{name:'옥녀심경',kind:'내공',role:'신속·회피',source:'신조협려 · 고묘파의 핵심 심법을 전승',desc:'가볍고 빠른 운기로 공격을 흘린다.',effects:{stats:{spd:1},avoid:8}},
  syn_dual:{name:'좌우쌍검',kind:'특성',role:'인연·연계',unlockLevel:10,source:'신조협려 · 주백통에게 좌우호박을 익혀 옥녀소심검을 홀로 펼침',desc:'인연 협공과 서로 다른 초식의 연계가 강해진다.',effects:{bondDamage:.1,comboDamage:.08}},
  jmk_jiuyang:{name:'구양신공',kind:'내공',role:'회복·지속전',unlockLevel:7,source:'의천도룡기 · 백원 뱃속의 구양진경을 수련해 현명신장의 한독을 몰아냄',desc:'순양의 진기로 매 턴 체력과 기력을 회복한다.',effects:{stats:{res:1},turnHeal:2,turnKi:1}},
  jmk_qiankun:{name:'건곤대나이',kind:'심법',role:'전환·파훼',unlockLevel:9,source:'의천도룡기 · 광명정 밀도에서 명교 호교신공을 익힘',desc:'상대의 힘을 이끌어 피해를 줄이고 강기를 무너뜨린다.',effects:{damageTaken:.1,guardDamage:1}},
  jmk_taiji:{name:'태극심의',kind:'심법',role:'수비·반격',unlockLevel:10,source:'의천도룡기 · 장삼봉에게 태극권검의 후발제인 뜻을 전수받음',desc:'급히 맞서지 않고 빈틈을 기다려 회피와 명중을 얻는다.',effects:{avoid:6,hit:3,lowHpReduction:.08}},
  jomin_hundred:{name:'백가박람',kind:'특성',role:'간파·정밀',source:'의천도룡기 · 만안사에서 육대문파의 절기를 관찰하고 약점을 짚음',desc:'여러 문파의 초식을 읽어 명중과 필살이 상승한다.',effects:{hit:8,crit:3}},
  jomin_command:{name:'군주지략',kind:'특성',role:'지휘·협공',source:'의천도룡기 · 여양왕부의 인재와 병력을 지휘해 무림 각파를 압박',desc:'인접한 동료가 많을수록 부대의 공격 흐름이 정교해진다.',effects:{adjacentDamage:.035,adjacentHit:2}},
  sb_battle:{name:'백전신위',kind:'특성',role:'난전·역전',source:'천룡팔부 · 수많은 악전에서 불리할수록 잠재된 용력이 솟는 모습',desc:'포위되거나 체력이 낮을수록 공격이 강해진다.',effects:{surroundedDamage:.06,lowHpDamage:.12}},
  sb_dragon:{name:'항룡유회',kind:'심법',role:'강공·절제',source:'천룡팔부 · 항룡장의 강맹함 속에 여력을 남겨 끊이지 않게 운용',desc:'강맹한 일격으로 본체와 호신강기를 함께 압박한다.',effects:{damage:.08,guardDamage:1}},
  dy_beiming:{name:'북명신공',kind:'내공',role:'흡기·지속전',source:'천룡팔부 · 무량산 낭환복지의 비권으로 북명신공을 익힘',desc:'공격이 적중할 때 상대의 기운을 끌어와 기력을 회복한다.',effects:{stats:{int:1},kiOnHit:2}},
  dy_lingbo:{name:'능파미보',kind:'경공',role:'기동·회피',source:'천룡팔부 · 북명신공과 함께 주역의 괘상을 밟는 능파미보를 익힘',desc:'이동력이 늘고 공격을 흘릴 가능성이 높아진다.',effects:{stats:{mov:1},avoid:10}},
  hj_beimingqi:{name:'북명진기',kind:'내공',role:'호체·지속전',source:'천룡팔부 · 무애자의 공력과 동모·이추수의 진기가 몸에 합쳐짐',desc:'깊은 진기가 몸을 보호하고 기력을 회복한다. 흡공 효과는 없다.',effects:{damageTaken:.1,turnKi:1}},
  hj_tianshan:{name:'천산절학',kind:'심법',role:'변화·연계',source:'천룡팔부 · 천산동모에게 천산절매수와 천산육양장을 전수받음',desc:'복잡한 변화를 이어 갈수록 초식의 위력이 높아진다.',effects:{hit:3,comboDamage:.1}},
  zbt_dual:{name:'좌우호박',kind:'특성',role:'연계·필살',source:'사조영웅전 · 도화도 동굴에서 분심이용의 좌우호박을 창안',desc:'서로 다른 초식을 잇는 연계와 필살이 강해진다.',effects:{comboDamage:.12,crit:3}},
  zbt_kongming:{name:'공명권의',kind:'심법',role:'유연·수비',source:'사조영웅전 · 도화도에서 지극히 부드러운 칠십이로 공명권을 창안',desc:'힘을 비워 상대의 공격을 흘린다.',effects:{damageTaken:.12,avoid:4}},
  wjy_xiantian:{name:'선천공',kind:'내공',role:'정순·파훼',source:'사조영웅전 회고 · 왕중양의 절정 내공이며 일양지와 함께 서독을 제압',desc:'정순한 선천진기로 내공과 파훼가 상승한다.',effects:{stats:{int:1,res:1},guardDamage:1,turnKi:1}},
  wjy_beidou:{name:'천강북두진',kind:'특성',role:'진형·협공',source:'사조영웅전 · 왕중양이 남긴 전진교의 천강북두진',desc:'인접한 동료와 진형을 이룰수록 공수 양면이 단단해진다.',effects:{adjacentDamage:.04,adjacentReduction:.035}},
  ijy_yunu:{name:'옥녀심경',kind:'내공',role:'신속·회피',source:'신조협려 회고 · 임조영이 전진 무학을 넘어설 목적으로 창안',desc:'빠른 운기와 몸놀림으로 공격을 비껴 낸다.',effects:{stats:{spd:1,skl:1},avoid:6}},
  ijy_counter:{name:'전진파훼',kind:'특성',role:'상극·간파',source:'신조협려 회고 · 옥녀심경의 여러 초식이 전진교 무공을 제어하도록 설계됨',desc:'내공형 상대의 흐름을 읽어 더 정확하고 강하게 파고든다.',effects:{vsInnerDamage:.12,vsInnerHit:5}},
});

export const HERO_INTERNALS=Object.freeze({
  gj:['gj_jiuyin','gj_quanzhen'],hy:['hy_qimen','hy_jiuyin'],yg:['yg_heavy','yg_yunu'],syn:['syn_yunu','syn_dual'],
  jmk:['jmk_jiuyang','jmk_qiankun','jmk_taiji'],jomin:['jomin_hundred','jomin_command'],sb:['sb_battle','sb_dragon'],
  dy:['dy_beiming','dy_lingbo'],hj:['hj_beimingqi','hj_tianshan'],zbt:['zbt_dual','zbt_kongming'],
  wjy:['wjy_xiantian','wjy_beidou'],ijy:['ijy_yunu','ijy_counter'],
});

export function internalOptions(cid){ return HERO_INTERNALS[cid]||[]; }
export function defaultInternal(cid){ return internalOptions(cid)[0]||null; }
export function internalById(id){ return id&&INTERNALS[id]||null; }
export function validInternal(cid,id){ return internalOptions(cid).includes(id)?id:defaultInternal(cid); }

export function internalEffectText(id){
  const item=internalById(id);if(!item)return '고유 심법 없음';
  const e=item.effects||{},parts=[];
  for(const [key,value] of Object.entries(e.stats||{})) parts.push(`${{hp:'HP',str:'힘',int:'내공',def:'방어',res:'정신',spd:'속도',skl:'기술',mov:'이동',ki:'최대 기력'}[key]||key} +${value}`);
  if(e.damage)parts.push(`피해 +${Math.round(e.damage*100)}%`);if(e.hit)parts.push(`명중 +${e.hit}`);if(e.crit)parts.push(`필살 +${e.crit}`);if(e.avoid)parts.push(`회피 +${e.avoid}`);
  if(e.guardDamage)parts.push(`강기 피해 +${e.guardDamage}`);if(e.damageTaken)parts.push(`받는 피해 -${Math.round(e.damageTaken*100)}%`);
  if(e.turnHeal)parts.push(`매 턴 HP +${e.turnHeal}`);if(e.turnKi)parts.push(`매 턴 기력 +${e.turnKi}`);if(e.kiOnHit)parts.push(`적중 시 기력 +${e.kiOnHit}`);if(e.kiOnBreak)parts.push(`파훼 시 기력 +${e.kiOnBreak}`);
  if(e.stationaryDamage)parts.push(`미이동 공격 +${Math.round(e.stationaryDamage*100)}%`);if(e.comboDamage)parts.push(`연계 피해 +${Math.round(e.comboDamage*100)}%`);if(e.bondDamage)parts.push(`인연 협공 피해 +${Math.round(e.bondDamage*100)}%`);
  if(e.surroundedDamage)parts.push(`인접 적당 피해 +${Math.round(e.surroundedDamage*100)}%`);if(e.lowHpDamage)parts.push(`위기 시 피해 +${Math.round(e.lowHpDamage*100)}%`);
  if(e.adjacentDamage)parts.push(`인접 아군당 피해 +${Math.round(e.adjacentDamage*100)}%`);if(e.adjacentReduction)parts.push(`인접 아군당 피해 감소 ${Math.round(e.adjacentReduction*100)}%`);
  if(e.vsInnerDamage)parts.push(`내공형 대상 피해 +${Math.round(e.vsInnerDamage*100)}%`);if(e.vsInnerHit)parts.push(`내공형 대상 명중 +${e.vsInnerHit}`);
  return parts.join(' · ')||item.desc;
}
