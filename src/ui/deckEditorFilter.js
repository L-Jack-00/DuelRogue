/**
 * 덱 편집기 가방(트렁크) 카드 통합 검색 · 정렬 순수 유틸리티
 * - 이름, #태그, 키워드, 효과 문구 공백 구분 AND 조건 매칭 (# 접두어 입력 시 태그 우선 매칭)
 * - 기본순 · 레벨순 · 공격력순 · 수비력순 · 레어도순 · 이름순 정렬
 */
import { normalizeRarityKey } from './raritySystem.js';

export const BAG_SORT_OPTIONS = [
  { value: 'DEFAULT', label: '입수순' },
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

function compareCardEntriesBySort(a, b, sortBy, acquisitionOrder) {
  const ad = a.def;
  const bd = b.def;
  if (!ad && !bd) return a.index - b.index;
  if (!ad) return 1;
  if (!bd) return -1;

  // 모든 정렬 기준에서 몬스터가 마법보다 항상 앞에 배치된다 (몬스터 > 마법)
  const aIsMonster = isMonsterDef(ad);
  const bIsMonster = isMonsterDef(bd);
  const aMonster = aIsMonster ? 0 : 1;
  const bMonster = bIsMonster ? 0 : 1;
  if (aMonster !== bMonster) return aMonster - bMonster;

  const aName = String(ad.name || '');
  const bName = String(bd.name || '');
  const nameCmp = aName.localeCompare(bName, 'ko');

  if (sortBy === 'DEFAULT') {
    if (acquisitionOrder && typeof acquisitionOrder === 'object') {
      const aSeq = Number(acquisitionOrder[a.cardId] ?? 0);
      const bSeq = Number(acquisitionOrder[b.cardId] ?? 0);
      if (bSeq !== aSeq) return bSeq - aSeq;
      return nameCmp || a.index - b.index;
    }
    return b.index - a.index;
  }

  // 마법 카드 정렬 (이름순 / 레어도순 외 기준에서는 가나다순)
  if (!aIsMonster && !bIsMonster) {
    if (sortBy === 'RARITY') {
      const aRar = RARITY_RANK[normalizeRarityKey(ad.rarity)] ?? 0;
      const bRar = RARITY_RANK[normalizeRarityKey(bd.rarity)] ?? 0;
      return bRar - aRar || nameCmp || a.index - b.index;
    }
    return nameCmp || a.index - b.index;
  }

  // 몬스터 카드 정렬 (가나다순을 3단계 타이브레이커로 앞당김)
  const aLv = Number(ad.level ?? ad.cost ?? 1);
  const bLv = Number(bd.level ?? bd.cost ?? 1);
  const aAtk = Number(ad.attack ?? 0);
  const bAtk = Number(bd.attack ?? 0);
  const aDef = Number(ad.defense ?? ad.health ?? 0);
  const bDef = Number(bd.defense ?? bd.health ?? 0);
  const aRar = RARITY_RANK[normalizeRarityKey(ad.rarity)] ?? 0;
  const bRar = RARITY_RANK[normalizeRarityKey(bd.rarity)] ?? 0;

  let cmp = 0;
  switch (sortBy) {
    case 'LEVEL':
      cmp = bLv - aLv || bAtk - aAtk;
      break;
    case 'ATTACK':
      cmp = bAtk - aAtk || bLv - aLv;
      break;
    case 'DEFENSE':
      cmp = bDef - aDef || bLv - aLv;
      break;
    case 'RARITY':
      cmp = bRar - aRar || bLv - aLv;
      break;
    case 'NAME':
      cmp = nameCmp;
      break;
    default:
      cmp = 0;
  }

  if (cmp !== 0) return cmp;
  if (nameCmp !== 0) return nameCmp;
  return a.index - b.index;
}

/**
 * 카드 ID 배열을 지정된 기준(DEFAULT(입수순) / LEVEL / ATTACK / DEFENSE / RARITY / NAME)으로 정렬합니다.
 * - 모든 기준에서 몬스터가 마법보다 앞에 옵니다.
 */
export function sortBagCardIds(cardIds, sortBy = 'DEFAULT', lookupDef = () => null, acquisitionOrder = null) {
  const list = Array.isArray(cardIds) ? [...cardIds] : [];
  if (list.length <= 1) return list;

  const indexed = list.map((cardId, index) => ({
    cardId,
    index,
    def: lookupDef(cardId) || null,
  }));

  indexed.sort((a, b) => compareCardEntriesBySort(a, b, sortBy, acquisitionOrder));

  return indexed.map((item) => item.cardId);
}

/**
 * 덱 리스트를 덱 마스터 최우선 → 몬스터(레벨 높은 순 → 공격력 높은 순 → 가나다순) → 마법(가나다순)으로 정렬합니다.
 */
export function sortDeckListCardIds(cardIds, deckMasterCardId = null, lookupDef = () => null) {
  if (!Array.isArray(cardIds)) return [];
  const masters = [];
  const others = [];
  for (const id of cardIds) {
    if (deckMasterCardId && id === deckMasterCardId) masters.push(id);
    else others.push(id);
  }
  const sortedOthers = sortBagCardIds(others, 'LEVEL', lookupDef);
  return [...masters, ...sortedOthers];
}

/**
 * 검색어 필터링 후 정렬된 카드 ID 목록을 반환합니다.
 */
export function filterAndSortBagCardIds(
  cardIds,
  { query = '', sortBy = 'DEFAULT', acquisitionOrder = null } = {},
  lookupDef = () => null
) {
  const list = Array.isArray(cardIds) ? cardIds : [];
  const filtered = String(query || '').trim()
    ? list.filter((id) => matchesBagSearchQuery(lookupDef(id), query))
    : [...list];
  return sortBagCardIds(filtered, sortBy, lookupDef, acquisitionOrder);
}
