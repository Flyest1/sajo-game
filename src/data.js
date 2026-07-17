/* ============================================================
   사조영웅전: 강호의 별 — 게임 데이터 모듈
   (수치·챕터·캐릭터는 src/data/*.json 에서 관리)
   ============================================================ */
import TILE from './data/tiles.json';
import SKILLS from './data/skills.json';
import CHARS from './data/characters.json';
import CHAPTERS from './data/chapters.json';
import ENDING from './data/ending.json';
import ENEMY_ID_LIST from './data/enemy_ids.json';

export const TS = 52; // 타일 크기(px)
export { TILE, SKILLS, CHARS, CHAPTERS, ENDING };
export const ENEMY_IDS = new Set(ENEMY_ID_LIST);
export const TYPE_NAME = {'외':'외공','경':'경공','내':'내공'};

/* 상성: 외공 → 경공 → 내공 → 외공 (앞이 뒤에 유리) */
export function triangle(a, b){
  if(a===b) return 0;
  if((a==='외'&&b==='경')||(a==='경'&&b==='내')||(a==='내'&&b==='외')) return 1;
  return -1;
}
