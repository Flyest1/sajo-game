# 사조영웅전: 강호의 별 (射鵰英雄傳 — 江湖의 별)

김용(金庸) 원작 팬메이드 무협 SRPG — **AI(Claude) 제작 데모** · 한국어

**▶ 플레이: https://flyest1.github.io/sajo-game/**

전 19장 스토리(사조영웅전 → 신조협려 → 의천도룡기 → 천룡팔부) + 영웅집결 무한 모드.
PC · 모바일(터치) 지원, 진행 상황 자동 저장(localStorage).

## 개발

```bash
npm install
npm run dev        # 로컬 개발 서버 (모바일은 같은 네트워크에서 접속 가능)
npm run validate   # 게임 데이터 무결성 검증
npm run build      # dist/ 프로덕션 빌드
npm run preview    # 빌드 결과 미리보기
```

## 구조

```
index.html               Vite 엔트리
src/
  main.js                부팅 · 전역 노출
  style.css              전체 스타일 (반응형/모바일 포함)
  data.js                데이터 로더 · 상성 규칙
  data/*.json            챕터·캐릭터·무공·지형·엔딩 데이터 (콘텐츠는 여기만 수정)
  gfx.js                 SVG 그래픽 (초상화 생성기·타일·유닛 토큰)
  game.js                전투 엔진 · 화면 흐름 (이동/전투/AI/무한 모드)
tools/validate_data.mjs  데이터 검증 (CI에서 빌드 전 실행)
legacy/                  구버전 단일 파일 백업
```

## 배포

`main` 브랜치에 push → GitHub Actions가 검증·빌드 후 GitHub Pages로 자동 배포.
(저장소 Settings → Pages → Source 를 **GitHub Actions** 로 설정 필요)

## 게임 시스템

무공 상성(외공▶경공▶내공▶외공) · 지형 효과 · 무공(기 소모)/2연격/치유 · 중독 · 협공 보정 ·
적 증원군 · 방어전 · 출전 멤버 선택 · 무공 습득 · 장 선택(회상) · 무한 웨이브 서바이벌
