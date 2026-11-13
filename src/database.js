// Core Game Database
export const CARDS_DATABASE = [
  { id: "c01", name: "빛의 첨병", type: "CREATURE", cost: 1, power: 3, hp: 2, desc: "신속하게 전선에 나서는 정의의 병사.", archetype: "BLUE" },
  { id: "c02", name: "절대 방진", type: "SPELL", cost: 2, block: 5, desc: "상대의 거센 공세를 차단하는 결계.", archetype: "BLUE" },
  { id: "c03", name: "심판의 선고", type: "SPELL", cost: 3, damage: 6, desc: "규율을 어긴 적 카드를 무력화합니다.", archetype: "BLUE" },
  { id: "c04", name: "작열의 돌격대", type: "CREATURE", cost: 1, power: 4, hp: 1, desc: "적 본체만을 노리는 맹렬한 공격수.", archetype: "RED" },
  { id: "c05", name: "핏빛 광란", type: "SPELL", cost: 2, buff: 3, desc: "모든 아군의 공격력을 일시 증폭.", archetype: "RED" },
  { id: "c06", name: "초토화", type: "SPELL", cost: 4, damage: 8, desc: "전장의 모든 것을 불태우는 화염.", archetype: "RED" },
  { id: "c07", name: "주사위 도박사", type: "CREATURE", cost: 1, gamble: true, desc: "1~6 사이의 운명에 기댑니다.", archetype: "PURPLE" },
  { id: "c08", name: "혼돈의 룰렛", type: "SPELL", cost: 2, gamble: true, desc: "아군 혹은 적군에게 무작위 효과를 부여.", archetype: "PURPLE" },
  { id: "c09", name: "기적의 뒤집기", type: "SPELL", cost: 3, gamble: true, desc: "전세를 단숨에 역전시킬 기적을 부릅니다.", archetype: "PURPLE" },
  { id: "c10", name: "태고의 거신", type: "CREATURE", cost: 5, power: 8, hp: 8, desc: "시간이 지나야 강림하는 절대자.", archetype: "NEUTRAL" },
  { id: "c11", name: "차원 수호자", type: "CREATURE", cost: 2, power: 2, hp: 5, desc: "상대의 마법을 받아내는 파수병.", archetype: "NEUTRAL" },
  { id: "c12", name: "시간의 모래시계", type: "ARTIFACT", cost: 2, manaRegen: 1, desc: "턴마다 추가 자원을 축적합니다.", archetype: "NEUTRAL" }
];

export const DESTINIES = {
  BLUE: {
    id: "BLUE",
    name: "정의 (Justice)",
    color: "#2980b9",
    tagline: "절제와 통제, 그리고 확고한 수호",
    description: "컨트롤 계열 덱 구축에 유리합니다. (최종 보스는 어그로/미드레인지 덱을 사용)",
    boss: {
      name: "파괴자 아자젤",
      title: "맹렬한 파괴자",
      avatar: "⚔️",
      hp: 30,
      archetype: "어그로/미드레인지 돌격",
      desc: "큰 견제 한두 번으로 기믹이 멈추지 않는 맹렬한 템포의 상대"
    }
  },
  RED: {
    id: "RED",
    name: "열의 (Zeal)",
    color: "#c0392b",
    tagline: "돌파와 맹공, 쉬지 않는 전진",
    description: "어그로 계열 덱 구축에 유리합니다. (최종 보스는 광역 제거/컨트롤 덱을 사용)",
    boss: {
      name: "대주교 세피로스",
      title: "정화의 집행관",
      avatar: "🛡️",
      hp: 35,
      archetype: "절대 방어 & 고점 컨트롤",
      desc: "광역 제거기와 굳히기 카드로 플레이어를 질식시키는 상대"
    }
  },
  PURPLE: {
    id: "PURPLE",
    name: "혼돈 (Chaos)",
    color: "#8e44ad",
    tagline: "변수와 도박, 요동치는 행운",
    description: "운에 의존하는 카드들이 등장합니다. (최종 보스는 항상 운이 좋습니다...)",
    boss: {
      name: "행운의 신 세렌디피티",
      title: "변칙의 지배자",
      avatar: "🎲",
      hp: 28,
      archetype: "절대 행운 & 갬블",
      desc: "모든 확률 판정을 자신에게 유리하게 조작하는 변칙의 지배자"
    }
  }
};
