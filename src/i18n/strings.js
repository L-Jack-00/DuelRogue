/**
 * 화면 문구 사전.
 *
 * 새로 추가되는 화면 문구와 카드 효과 설명은 이 사전의 키로만 참조한다.
 * 현재는 한국어(ko)만 제공하며, 다른 언어는 같은 키 구조의 사전을 STRINGS에 추가하고
 * setLocale()로 전환하면 된다. 키가 없으면 ko 사전, 그래도 없으면 키 자체를 돌려준다.
 *
 * 문구 안의 {name} 형태 자리표시자는 t(key, { name: '...' })의 값으로 치환된다.
 *
 * 다국어를 붙일 때의 순서
 * 1) 이 파일의 ko 사전과 같은 키로 en 등 사전을 만들어 registerStrings('en', {...})로 등록
 * 2) setLocale('en') 후 화면을 다시 그린다 (main.js의 applyStaticTranslations가 index.html의
 *    data-i18n="키" 요소를 사전 문구로 바꾼다)
 * 3) 아직 사전으로 옮기지 않은 화면 문구는 index.html과 main.js에 남아 있다. 옮길 때는 문구를
 *    사전에 키로 추가하고, 요소에는 data-i18n, 코드에서는 t('키')를 쓴다.
 * 카드 이름은 카드 데이터에, 카드 효과 설명은 효과 데이터로부터 이 사전의 문구로 자동 생성된다.
 */

const ko = {
  // ---- 타이틀 · 공용 화면 ----
  'ui.title.subtitle': '덱을 키우고 운명의 보스에게 도전하는 1v1 카드 듀얼',
  'ui.title.continue': '이어서 하기',
  'ui.title.newRun': '새로운 듀얼 런 개시',
  'ui.title.binder': '3×3 콜렉션 바인더 열람',
  'ui.title.badges': '카드 516종 • 3대 운명과 보스',
  'ui.binder.all': '전체',
  'ui.binder.ownedOnly': '보유만',


  'kw.TAUNT': '도발',
  'kw.TAUNT.desc': '상대는 도발 몬스터부터 공격해야 한다.',
  'kw.PIERCE': '관통',
  'kw.PIERCE.desc': '공격으로 몬스터를 파괴하면 초과한 공격력만큼 상대 본체에 피해를 준다.',
  'kw.DIRECT': '직접공격',
  'kw.DIRECT.desc': '상대 필드에 몬스터가 있어도 본체를 직접 공격할 수 있다.',
  'kw.STEALTH': '은신',
  'kw.STEALTH.desc': '아군에 다른 몬스터가 있는 동안 공격 대상으로 지정되지 않는다. 공격하면 은신이 풀린다.',
  'kw.DOUBLE': '연속공격',
  'kw.DOUBLE.desc': '한 턴에 두 번 공격할 수 있다.',
  'kw.LIFESTEAL': '흡혈',
  'kw.LIFESTEAL.desc': '상대 본체에 준 피해만큼 아군 본체를 회복한다.',
  'kw.UNDYING': '불굴',
  'kw.UNDYING.desc': '처음 파괴될 때 한 번 버티고 수비력 1로 남는다.',
  'kw.DIVINE': '신성',
  'kw.DIVINE.desc': '상대 카드 효과의 대상이 되지 않고 효과 피해를 받지 않는다.',
  'kw.RETALIATE': '반격',
  'kw.RETALIATE.desc': '공격받고 살아남으면 공격한 몬스터의 수비력을 이 몬스터의 공격력만큼 깎는다.',
  'kw.BULWARK': '철벽',
  'kw.BULWARK.desc': '이 몬스터가 돌려주는 수비 반사 피해가 2배가 된다.',

  // ---- 트리거(조건) ----
  'trigger.ON_SUMMON': '소환 시',
  'trigger.ON_DESTROYED': '파괴되었을 때',
  'trigger.ON_ATTACK': '공격을 선언할 때',
  'trigger.ON_KILL': '전투로 몬스터를 파괴했을 때',
  'trigger.ON_TURN_START': '내 턴 시작 시',
  'trigger.ON_TURN_END': '내 턴 종료 시',
  'trigger.INSTANT': '발동 시',
  'trigger.ON_ATTACKED': '세트 후 상대가 공격할 때',
  'trigger.SET_TURN_START': '세트 후 내 턴 시작 시',
  'trigger.SET_TURN_END': '세트 후 내 턴 종료 시',
  'trigger.ON_ENEMY_SUMMON': '세트 후 상대가 몬스터를 소환할 때',

  // ---- 추가 조건 ----
  'cond.selfLpBelow': '내 LP가 {value} 이하라면',
  'cond.enemyLpBelow': '상대 LP가 {value} 이하라면',
  'cond.enemyBoardAtLeast': '상대 몬스터가 {value}마리 이상이라면',
  'cond.allyBoardAtLeast': '아군 몬스터가 {value}마리 이상이라면',
  'cond.handAtMost': '내 패가 {value}장 이하라면',
  'cond.allyTagAtLeast': '이 카드 외에 {tag} 아군이 {value}마리 이상이라면',
  'cond.behindOnBoard': '상대 몬스터 수가 아군보다 많다면',
  'chance': '{value}% 확률로',
  'chance.else': '실패하면',

  // ---- 대상 ----
  'target.SELF': '이 몬스터',
  'target.ALLY_ALL': '아군 몬스터 전체',
  'target.ALLY_OTHERS': '다른 아군 몬스터 전체',
  'target.ALLY_RANDOM': '무작위 아군 몬스터 1마리',
  'target.ALLY_WEAKEST': '수비력이 가장 낮은 아군 몬스터',
  'target.ENEMY_ALL': '적 몬스터 전체',
  'target.ENEMY_RANDOM': '무작위 적 몬스터 1마리',
  'target.ENEMY_STRONGEST': '공격력이 가장 높은 적 몬스터',
  'target.ENEMY_WEAKEST': '수비력이 가장 낮은 적 몬스터',
  'target.ENEMY_HIGHEST_LEVEL': '레벨이 가장 높은 적 몬스터',
  'target.ATTACKER': '공격한 몬스터',
  'target.SUMMONED': '방금 소환된 적 몬스터',
  'target.ENEMY_HERO': '상대 본체',
  'target.ALLY_HERO': '아군 본체',
  'target.BOTH_HEROES': '양쪽 본체',

  // ---- 효과 문장 ----
  'op.DAMAGE_HERO': '{target}에 {value}의 피해를 준다',
  'op.HEAL_HERO': '{target}의 LP를 {value} 회복한다',
  'op.DAMAGE_UNIT': '{target}에 {value}의 피해를 준다',
  'op.DESTROY_UNIT': '{target}을(를) 파괴한다',
  'op.DESTROY_UNIT.maxLevel': '{target} 중 레벨 {maxLevel} 이하인 몬스터 1마리를 파괴한다',
  'op.BUFF': '{target}의 {stats}',
  'op.DEBUFF': '{target}의 {stats}',
  'op.SHIELD_HERO': '아군 본체에 {value}의 피해를 막는 보호막을 친다',
  'op.DRAW': '카드를 {value}장 뽑는다',
  'op.EXTRA_SUMMON': '이번 턴 일반 소환권을 {value}회 추가로 얻는다',
  'op.SUMMON_TOKEN': '빈자리에 「{token}」을(를) {value}마리 소환한다',
  'op.FREEZE': '{target}은(는) 다음 턴에 공격할 수 없다',
  'op.SILENCE': '{target}의 키워드와 효과를 모두 지운다',
  'op.RETURN_TO_HAND': '{target}을(를) 주인의 패로 되돌린다',
  'op.RETURN_TO_HAND.maxLevel': '{target} 중 레벨 {maxLevel} 이하인 몬스터 1마리를 주인의 패로 되돌린다',
  'op.GRANT_KEYWORD': '{target}에게 「{keyword}」을(를) 부여한다',
  'op.DISCARD_RANDOM': '상대의 패를 무작위로 {value}장 버린다',
  'op.REVIVE': '내 묘지에서 레벨 {maxLevel} 이하 몬스터 1마리를 무작위로 되살린다',
  'op.SWAP_STATS': '{target}의 공격력과 수비력을 맞바꾼다',
  'op.DAMAGE_BOTH_HEROES': '양쪽 본체에 {value}의 피해를 준다',
  'stat.atkUp': '공격력 +{value}',
  'stat.defUp': '수비력 +{value}',
  'stat.atkDown': '공격력 -{value}',
  'stat.defDown': '수비력 -{value}',
  'stat.join': ', ',

  // ---- 카드 설명 머리말 ----
  'label.condition': '[조건]',
  'label.target': '[대상]',
  'label.effect': '[효과]',
  'label.keyword': '[키워드]',
  'label.noEffect': '특수 효과 없음',

  // ---- 희귀도 / 진영 ----
  'rarity.COMMON': '일반',
  'rarity.UNCOMMON': '고급',
  'rarity.RARE': '희귀',
  'rarity.EPIC': '영웅',
  'rarity.LEGENDARY': '전설',
  'faction.BLUE': '정의',
  'faction.RED': '열의',
  'faction.PURPLE': '혼돈',
  'faction.NEUTRAL': '중립',

  // ---- 듀얼 이벤트 로그 ----
  'event.summon': '{who}이(가) 「{card}」을(를) 소환했습니다.',
  'event.tribute': '{who}이(가) 「{cards}」을(를) 제물로 바쳤습니다.',
  'event.spell': '{who}이(가) 「{card}」을(를) 발동했습니다.',
  'event.set': '{who}이(가) 마법 카드 1장을 세트했습니다.',
  'event.trigger': '「{card}」의 효과가 발동했습니다.',
  'event.fizzle': '「{card}」의 효과가 대상이 없어 불발되었습니다.',
  'event.attack': '「{attacker}」이(가) {target}을(를) 공격했습니다.',
  'event.destroyed': '「{card}」이(가) 파괴되었습니다.',
  'event.undying': '「{card}」이(가) 불굴의 의지로 버텼습니다.',
  'event.heroDamage': '{who}의 LP가 {value} 감소했습니다.',
  'event.heroHeal': '{who}의 LP가 {value} 회복되었습니다.',
  'event.shieldAbsorb': '{who}의 보호막이 피해 {value}을(를) 막았습니다.',
  'event.recoil': '수비 반사 피해! {who}이(가) {value}의 피해를 입었습니다.',
  'event.pierce': '관통! {value}의 초과 피해가 본체에 들어갔습니다.',
  'event.fatigue': '{who}의 덱이 비어 탈진 피해 {value}을(를) 입었습니다.',
  'event.chanceFail': '「{card}」의 운이 따르지 않았습니다.',
  'event.chanceWin': '「{card}」의 도박이 성공했습니다!',
  'event.mood': '{who}: "{line}"',
  'event.turnLimit': '제한 턴에 도달해 LP가 높은 쪽이 승리합니다.',
  'event.suddenDeath': '결전의 시간! {who}이(가) {value}의 피해를 입었습니다.',
  'who.player': '플레이어',
  'who.enemyHero': '상대 본체',
  'who.allyHero': '아군 본체',
};

const STRINGS = { ko };
let currentLocale = 'ko';

export function setLocale(locale) {
  if (STRINGS[locale]) currentLocale = locale;
}

export function getLocale() {
  return currentLocale;
}

/** 다른 언어 사전을 등록한다. (기존 키 위에 덮어쓴다) */
export function registerStrings(locale, dict) {
  STRINGS[locale] = { ...(STRINGS[locale] || {}), ...dict };
}

// 한국어 조사 자동 선택: '을(를)', '이(가)', '은(는)', '와(과)', '으로(로)'
const JOSA = {
  '을(를)': ['을', '를'],
  '이(가)': ['이', '가'],
  '은(는)': ['은', '는'],
  '와(과)': ['과', '와'],
  '으로(로)': ['으로', '로'],
};
const CLOSERS = '」』)]"\' ';

function lastSyllable(text, end) {
  for (let i = end - 1; i >= 0; i--) {
    const ch = text[i];
    if (CLOSERS.includes(ch)) continue;
    return ch;
  }
  return '';
}

function hasBatchim(ch) {
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(ch)) return '013678'.includes(ch);
  return false;
}

function hasRieulBatchim(ch) {
  const code = ch.charCodeAt(0);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 === 8;
}

export function fixJosa(text) {
  return text.replace(/(을\(를\)|이\(가\)|은\(는\)|와\(과\)|으로\(로\))/g, (marker, _m, offset) => {
    const ch = lastSyllable(text, offset);
    if (!ch) return JOSA[marker][1];
    const batchim = hasBatchim(ch);
    if (marker === '으로(로)') return batchim && !hasRieulBatchim(ch) ? '으로' : '로';
    return batchim ? JOSA[marker][0] : JOSA[marker][1];
  });
}

export function t(key, params = null) {
  const dict = STRINGS[currentLocale] || ko;
  let text = dict[key] ?? ko[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return currentLocale === 'ko' ? fixJosa(text) : text;
}
