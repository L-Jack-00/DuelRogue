/**
 * 상대 듀얼리스트 성향.
 *
 * 각 성향은 상태 평가 가중치와 행동 습관으로 정의된다.
 *   weights.oppLp     상대 LP를 깎는 데 두는 가치
 *   weights.myLp      내 LP를 지키는 데 두는 가치
 *   weights.myBoard   내 필드 전력 가치
 *   weights.oppBoard  상대 필드 전력을 줄이는 가치
 *   weights.hand      손패를 아끼는 가치
 *   weights.setSpell  세트 마법을 깔아 두는 가치
 *   weights.threat    다음 상대 턴에 받을 피해를 경계하는 정도
 *   caution           상대의 덮인 카드가 있을 때 공격을 망설이는 정도 (0~1)
 *   noise             판단에 섞이는 무작위성 (0~1, 클수록 예측 불가)
 *   optimism          확률 효과를 낙관적으로 보는 정도 (0 = 평균, 1 = 최선만 봄)
 *   baseOnly          true면 상황에 따라서만 나타나는 성향 (기본 성향으로 배정하지 않음)
 *
 * 화면 이름·대사는 i18n 사전의 mood.<ID>.* 키를 쓴다.
 */
import { registerStrings } from '../i18n/strings.js';

export const PERSONALITIES = {
  AGGRESSIVE: {
    id: 'AGGRESSIVE',
    weights: { oppLp: 1.7, myLp: 0.55, myBoard: 0.8, oppBoard: 0.75, hand: 0.4, setSpell: 0.5, threat: 0.35 },
    caution: 0.15,
    noise: 0.04,
    optimism: 0.3,
  },
  DEFENSIVE: {
    id: 'DEFENSIVE',
    weights: { oppLp: 0.8, myLp: 1.5, myBoard: 1.1, oppBoard: 1.0, hand: 0.7, setSpell: 1.1, threat: 1.3 },
    caution: 0.7,
    noise: 0.03,
    optimism: 0.0,
  },
  CALCULATING: {
    id: 'CALCULATING',
    weights: { oppLp: 1.15, myLp: 1.0, myBoard: 1.0, oppBoard: 1.05, hand: 0.9, setSpell: 0.8, threat: 0.9 },
    caution: 0.5,
    noise: 0.0,
    optimism: 0.0,
  },
  GAMBLER: {
    id: 'GAMBLER',
    weights: { oppLp: 1.35, myLp: 0.7, myBoard: 0.9, oppBoard: 0.8, hand: 0.5, setSpell: 0.6, threat: 0.4 },
    caution: 0.1,
    noise: 0.22,
    optimism: 0.85,
  },
  TRICKSTER: {
    id: 'TRICKSTER',
    weights: { oppLp: 1.0, myLp: 0.9, myBoard: 0.9, oppBoard: 1.35, hand: 1.0, setSpell: 1.6, threat: 0.8 },
    caution: 0.45,
    noise: 0.08,
    optimism: 0.2,
  },
  BERSERK: {
    id: 'BERSERK',
    weights: { oppLp: 2.6, myLp: 0.15, myBoard: 0.6, oppBoard: 0.5, hand: 0.2, setSpell: 0.2, threat: 0.0 },
    caution: 0.0,
    noise: 0.06,
    optimism: 0.6,
    baseOnly: true,
  },
  PANIC: {
    id: 'PANIC',
    weights: { oppLp: 0.6, myLp: 1.9, myBoard: 1.3, oppBoard: 1.1, hand: 0.3, setSpell: 1.4, threat: 1.8 },
    caution: 0.9,
    noise: 0.18,
    optimism: 0.1,
    baseOnly: true,
  },
};

export const BASE_PERSONALITY_IDS = Object.values(PERSONALITIES).filter((p) => !p.baseOnly).map((p) => p.id);

registerStrings('ko', {
  'mood.AGGRESSIVE.name': '맹공',
  'mood.AGGRESSIVE.desc': '상대 LP를 깎는 데 집중하고 위험을 감수한다.',
  'mood.AGGRESSIVE.line': '몰아붙인다! 쉴 틈을 주지 마라!|끝장을 내주지!|공격이 최선의 방어다.',
  'mood.DEFENSIVE.name': '철벽',
  'mood.DEFENSIVE.desc': '필드와 LP를 지키며 반격의 기회를 노린다.',
  'mood.DEFENSIVE.line': '서두를 필요는 없지. 진형을 굳힌다.|한 발짝도 들이지 않겠다.|버티는 자가 이긴다.',
  'mood.CALCULATING.name': '계산',
  'mood.CALCULATING.desc': '손익을 따져 가장 효율적인 수만 둔다.',
  'mood.CALCULATING.line': '흥미롭군. 다음 수는 이미 정해져 있다.|확률은 거짓말을 하지 않지.|계산대로다.',
  'mood.GAMBLER.name': '도박',
  'mood.GAMBLER.desc': '운에 기대는 수를 즐기고 판단이 들쭉날쭉하다.',
  'mood.GAMBLER.line': '자, 한 판 크게 걸어볼까!|운명의 주사위는 굴러간다!|이번엔 될 것 같은데?',
  'mood.TRICKSTER.name': '교활',
  'mood.TRICKSTER.desc': '함정을 깔고 상대의 핵심 몬스터를 노린다.',
  'mood.TRICKSTER.line': '후후, 발밑을 조심하는 게 좋을 거야.|덫은 이미 놓여 있다.|네가 무엇을 꺼낼지 다 보인다.',
  'mood.BERSERK.name': '광폭',
  'mood.BERSERK.desc': '물러설 곳이 없어 수비를 버리고 전부 공격한다.',
  'mood.BERSERK.line': '더는 물러설 곳이 없다! 전부 쏟아붓는다!|크하하! 같이 무너지자!|이 정도로 끝날 것 같으냐!',
  'mood.PANIC.name': '동요',
  'mood.PANIC.desc': '수세에 몰려 허둥지둥 방어에만 매달린다.',
  'mood.PANIC.line': '이, 이럴 리가 없어…!|잠깐, 진정하자… 막아야 해!|큭… 계산이 틀렸나?',
});
