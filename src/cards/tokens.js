/** 효과로만 등장하는 토큰 몬스터. 덱에 넣을 수 없다. */
export const TOKENS = [
  { id: 'T_SQUIRE', name: '성역의 종자', type: 'MONSTER', faction: 'BLUE', level: 1, attack: 3, defense: 7, kw: ['TAUNT'], tags: ['#성역'] },
  { id: 'T_EMBER', name: '불씨 정령', type: 'MONSTER', faction: 'RED', level: 1, attack: 6, defense: 2, kw: [], tags: ['#화염'] },
  { id: 'T_IMP', name: '꼬마 임프', type: 'MONSTER', faction: 'PURPLE', level: 1, attack: 4, defense: 4, kw: [], tags: ['#악마'] },
  { id: 'T_PHANTOM', name: '환영 분신', type: 'MONSTER', faction: 'PURPLE', level: 1, attack: 5, defense: 1, kw: ['STEALTH'], tags: ['#환영'] },
  { id: 'T_GEAR', name: '태엽 부품', type: 'MONSTER', faction: 'NEUTRAL', level: 1, attack: 2, defense: 7, kw: [], tags: ['#기계'] },
  { id: 'T_SKELETON', name: '해골 병사', type: 'MONSTER', faction: 'NEUTRAL', level: 1, attack: 5, defense: 4, kw: [], tags: ['#언데드'] },
  { id: 'T_WOLF', name: '새끼 늑대', type: 'MONSTER', faction: 'NEUTRAL', level: 1, attack: 5, defense: 3, kw: [], tags: ['#야수'] },
].map((c) => ({ ...c, isToken: true, collectible: false, rarity: 'COMMON' }));

export function tokenStatSumOf(id) {
  const tk = TOKENS.find((c) => c.id === id);
  return tk ? tk.attack + tk.defense : 10;
}
