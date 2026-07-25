# 강호의 별 — 반실사 초상 아트 바이블

## 목표

고전 동아시아 전략게임의 인물화가 주는 무게감은 살리되 특정 회사·작품·배우의 얼굴이나 화풍을 복제하지 않는다. 결과물은 독자적인 프리미엄 무협 역사화이며, 정면에 가까운 3/4 흉상·차분한 단색 배경·명확한 인물 실루엣을 공통 문법으로 쓴다.

## 공통 생성 프롬프트

> Original premium semi-realistic wuxia historical strategy-game character portrait, painterly realism, Chinese ink-and-oil texture, chest-up three-quarter view, dignified natural anatomy, restrained cinematic light, period-appropriate hair and layered robe, muted parchment atmosphere, centered face with breathing room, square composition. No text, logo, border, actor likeness, modern clothing, photographic background, existing game character, or copied studio style.

인물마다 시대, 연령대, 성격, 복식 색, 무기·장신구 한 가지를 덧붙인다. 같은 인물의 후속 표정은 얼굴형·눈·코·입·머리·복식·조명을 고정하고 표정과 작은 상처만 바꾼다.

## 1차 파일럿 8명

| ID | 인물 | 핵심 시각 언어 | 프로젝트 경로 |
|---|---|---|---|
| `gj` | 곽정 | 정직하고 굳센 남송 협객, 청갈색 포의 | `public/portraits/hero/gj.webp` |
| `hy` | 황용 | 영리하고 생기 있는 책사, 청자색 의복 | `public/portraits/hero/hy.webp` |
| `yg` | 양과 | 고독하고 강렬한 검객, 어두운 남청색 | `public/portraits/hero/yg.webp` |
| `syn` | 소용녀 | 절제되고 고요한 고묘파 검객, 백의 | `public/portraits/hero/syn.webp` |
| `jmk` | 장무기 | 온화하지만 결연한 명교 지도자, 적흑색 | `public/portraits/hero/jmk.webp` |
| `jomin` | 조민 | 자신감 있고 전략적인 몽골 귀족, 남보석색 | `public/portraits/hero/jomin.webp` |
| `sb` | 소봉 | 호방하고 비극적인 북송 영웅, 모피·갈색 | `public/portraits/hero/sb.webp` |
| `dy` | 단예 | 온화하고 학구적인 대리 왕자, 상아·청록색 | `public/portraits/hero/dy.webp` |

각 ID에는 같은 이름의 `public/portraits/thumb/*.webp` 전장용 축소본이 있다. 원본 생성 PNG는 배포 저장소에 넣지 않고 제작 기록에서만 보관한다.

## 규격과 검수

- 원본: 정사각형 1,254px 이상. 배포: hero 768×768 WebP, thumb 192×192 WebP.
- hero 220KB 이하, thumb 30KB 이하를 CI 기준으로 한다.
- 얼굴이 작은 원형 토큰에서도 식별되어야 하며, 눈·피부·수염이 과도하게 사진처럼 날카롭지 않아야 한다.
- 텍스트·낙관·워터마크·현대 소품·배우 유사성·손가락이 강조된 포즈는 불합격이다.
- 나머지 93명은 작품별 핵심 인물 순으로 묶어 제작하되, 각 묶음마다 데스크톱/모바일 대화창과 전장 토큰을 함께 확인한 뒤 다음 묶음으로 간다.
