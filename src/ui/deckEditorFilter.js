/**
 * 덱 편집기 가방(트렁크) 카드 통합 검색 · 정렬 순수 유틸리티
 * - 이름, #태그, 키워드, 효과 문구 공백 구분 AND 조건 매칭 (# 접두어 입력 시 태그 우선 매칭)
 * - 기본순 · 레벨순 · 공격력순 · 수비력순 · 레어도순 · 이름순 정렬
 */
import { normalizeRarityKey } from './raritySystem.js';

export const BAG_SORT_OPTIONS = [
  { value: 'DEFAULT', label: '기본순' },
  { value: 'LEVEL', label: '레벨순' },
  { value: 'ATTACK', label: '공격력순' },
  { value: 'DEFENSE', label: '수비력순' },
  { value: 'RARITY', label: '레어도순' },
  { value: 'NAME', label: '이름순' },
];

const RARITY_RANK = {
  COMMON: 0,
  UNCOMMON: 1,
  RARE: 2,
  EPIC: 3,
  LEGENDARY: 4,
};

/**
 * 카드 정의가 통합 검색어(이름 · #태그 · 키워드 · 효과 문구, 공백 AND)에 일치하는지 판정합니다.
 */
export function matchesBagSearchQuery(def, rawQuery = '') {
  if (!def) return false;
  const trimmed = String(rawQuery || '').trim().toLowerCase();
  if (!trimmed) return true;

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const nameText = String(def.name || '').toLowerCase();
  const tagRawList = (def.tags || []).map((t) => String(t).toLowerCase());
  const tagPlainList = tagRawList.map((t) => t.replace(/^#+/, ''));
  const kwText = [...(def.keywords || []), ...(def.kw || [])]
    .map((k) => String(k).toLowerCase())
    .join(' ');
  const effectText = [def.condition, def.target, def.effect, def.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return tokens.every((token) => {
    if (token.startsWith('#')) {
      const needle = token.replace(/^#+/, '');
      if (!needle) return true;
      return tagPlainList.some((tp) => tp.includes(needle)) || tagRawList.some((tr) => tr.includes(token));
    }
    return (
      nameText.includes(token) ||
      tagPlainList.some((tp) => tp.includes(token)) ||
      kwText.includes(token) ||
      effectText.includes(token)
    );
  });
}

function isMonsterDef(def) {
  return Boolean(def && (def.type === 'MONSTER' || (Number(def.attack) > 0 && def.type !== 'SPELL')));
}

/**
 * 카드 ID 배열을 지정된 기준(DEFAULT / LEVEL / ATTACK / DEFENSE / RARITY / NAME)으로 안정 정렬합니다.
 */
export function sortBagCardIds(cardIds, sortBy = 'DEFAULT', lookupDef = () => null) {
  const list = Array.isArray(cardIds) ? [...cardIds] : [];
  if (!sortBy || sortBy === 'DEFAULT') return list;

  const indexed = list.map((cardId, index) => ({
    cardId,
    index,
    def: lookupDef(cardId) || null,
  }));

  indexed.sort((a, b) => {
    const ad = a.def;
    const bd = b.def;
    if (!ad && !bd) return a.index - b.index;
    if (!ad) return 1;
    if (!bd) return -1;

    const aMonster = isMonsterDef(ad) ? 0 : 1;
    const bMonster = isMonsterDef(bd) ? 0 : 1;
    const aLv = Number(ad.level ?? ad.cost ?? 1);
    const bLv = Number(bd.level ?? bd.cost ?? 1);
    const aAtk = Number(ad.attack ?? 0);
    const bAtk = Number(bd.attack ?? 0);
    const aDef = Number(ad.defense ?? ad.health ?? 0);
    const bDef = Number(bd.defense ?? bd.health ?? 0);
    const aRar = RARITY_RANK[normalizeRarityKey(ad.rarity)] ?? 0;
    const bRar = RARITY_RANK[normalizeRarityKey(bd.rarity)] ?? 0;
    const aName = String(ad.name || '');
    const bName = String(bd.name || '');

    let cmp = 0;
    switch (sortBy) {
      case 'LEVEL':
        cmp = aLv - bLv || aMonster - bMonster || bAtk - aAtk;
        break;
      case 'ATTACK':
        cmp = bAtk - aAtk || aMonster - bMonster || bDef - aDef;
        break;
      case 'DEFENSE':
        cmp = bDef - aDef || aMonster - bMonster || bAtk - aAtk;
        break;
      case 'RARITY':
        cmp = bRar - aRar || bLv - aLv || aMonster - bMonster;
        break;
      case 'NAME':
        cmp = aName.localeCompare(bName, 'ko');
        break;
      default:
        cmp = 0;
    }

    if (cmp !== 0) return cmp;
    const nameTie = aName.localeCompare(bName, 'ko');
    if (nameTie !== 0) return nameTie;
    return a.index - b.index;
  });

  return indexed.map((item) => item.cardId);
}

/**
 * 검색어 필터링 후 정렬된 카드 ID 목록을 반환합니다.
 */
export function filterAndSortBagCardIds(cardIds, { query = '', sortBy = 'DEFAULT' } = {}, lookupDef = () => null) {
  const list = Array.isArray(cardIds) ? cardIds : [];
  const filtered = String(query || '').trim()
    ? list.filter((id) => matchesBagSearchQuery(lookupDef(id), query))
    : [...list];
  return sortBagCardIds(filtered, sortBy, lookupDef);
}
