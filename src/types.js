/**
 * @file types.js
 * @description 「듀얼 로그 (Duel Rogue)」 코어 도메인 상수 정의 (SPEC.md 및 types.ts 계약 100% 준수)
 */

export const BinderCardState = {
  UNKNOWN: 0,     // 미발견: 바인더에 '?' 표시
  DISCOVERED: 1,  // 발견: 흑백 실루엣/음영, 상세 정보 열람 가능
  OWNED: 2,       // 소유: 정식 컬러 활성화
  MASTERED: 3,    // 숙련: 숙련도 임계치 도달, 홀로그램/오라 이펙트 및 포인트 노출
};

export const TargetPolarity = {
  BENEFICIAL: 'BENEFICIAL', // 초록색 오라 (이로움 / Buff / Heal)
  MIXED: 'MIXED',           // 노랑색 오라 (복합적 / Neutral / Gamble)
  HARMFUL: 'HARMFUL',       // 빨강색 오라 (해를 끼침 / Attack / Damage)
};
