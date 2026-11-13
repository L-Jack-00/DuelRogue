/**
 * 전투 키워드 정의.
 *
 * 카드 데이터의 `kw` 배열에는 아래 ID만 들어간다. 화면에 보이는 이름과 설명은
 * i18n 사전의 `kw.<ID>` / `kw.<ID>.desc` 키에서 가져온다.
 *
 * cost는 카드 생성기가 스탯 예산에서 차감하는 값(공+수 합계 기준)이다.
 * minLevel은 해당 키워드를 받을 수 있는 최저 레벨이다. (관통은 Lv3 이상 — 카드 디자인 제2원칙)
 */
import { t } from '../i18n/strings.js';

export const KEYWORDS = {
  TAUNT: { id: 'TAUNT', cost: 4, minLevel: 1 },
  PIERCE: { id: 'PIERCE', cost: 3, minLevel: 3 },
  DIRECT: { id: 'DIRECT', cost: 3.5, minLevel: 1 },
  STEALTH: { id: 'STEALTH', cost: 2, minLevel: 1 },
  DOUBLE: { id: 'DOUBLE', cost: 7, minLevel: 2 },
  LIFESTEAL: { id: 'LIFESTEAL', cost: 3, minLevel: 1 },
  UNDYING: { id: 'UNDYING', cost: 3.5, minLevel: 1 },
  DIVINE: { id: 'DIVINE', cost: 4.5, minLevel: 1 },
  RETALIATE: { id: 'RETALIATE', cost: 2.5, minLevel: 1 },
  BULWARK: { id: 'BULWARK', cost: 2.5, minLevel: 1 },
};

export const KEYWORD_IDS = Object.keys(KEYWORDS);

export function keywordName(id) {
  return t(`kw.${id}`);
}

export function keywordDesc(id) {
  return t(`kw.${id}.desc`);
}

/** 한국어 키워드 이름 → ID (구버전 카드 데이터 변환용) */
export function keywordIdFromName(name) {
  for (const id of KEYWORD_IDS) {
    if (t(`kw.${id}`) === name) return id;
  }
  return null;
}
