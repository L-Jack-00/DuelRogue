/**
 * @file sceneArt.js
 * @description Scene backgrounds, NPC cast portraits and product wrapping.
 *
 * Every image here is optional. When a file is missing the game keeps its
 * previous look (gradient background, vector portrait, vector pack art),
 * so art can be dropped in one file at a time without code changes.
 */

// ---------------------------------------------------------------------------
// Scene backgrounds
// ---------------------------------------------------------------------------

/** Background image per view. Night scenes get the "night" tone class. */
const SCENE_BY_VIEW = {
  VIEW_TITLE_LOBBY: { src: 'assets/ui/bg_lobby.webp', tone: 'day' },
  VIEW_FORTUNE_TELLER: { src: 'assets/ui/bg_fortune.webp', tone: 'night' },
  VIEW_CHECKPOINT: { src: 'assets/ui/bg_hub.webp', tone: 'day' },
  VIEW_CHECKPOINT_SHOP: { src: 'assets/ui/bg_shop.webp', tone: 'day' },
  VIEW_PACK_OPENING: { src: 'assets/ui/bg_shop.webp', tone: 'day' },
  VIEW_CHECKPOINT_MERCHANT: { src: 'assets/ui/bg_encounter.webp', tone: 'day' },
  VIEW_MERCHANT_EVENT: { src: 'assets/ui/bg_merchant.webp', tone: 'night' },
  VIEW_CHECKPOINT_DECK_EDITOR: { src: 'assets/ui/bg_deck.webp', tone: 'night' },
  VIEW_DUEL_ARENA: { src: 'assets/ui/bg_duel.webp', tone: 'day' },
};

const SCENE_BOSS = {
  BOSS_BLUE_FORTRESS_CONTROL: 'assets/ui/bg_boss_blue.webp',
  BOSS_RED_UNSTOPPABLE_AGGRO: 'assets/ui/bg_boss_red.webp',
  BOSS_PURPLE_RIGGED_FATE: 'assets/ui/bg_boss_purple.webp',
};

const SCENE_ALLEY_MERCHANT = 'assets/ui/bg_merchant.webp';
const SCENE_VICTORY = 'assets/ui/bg_victory.webp';
const SCENE_DEFEAT = 'assets/ui/bg_defeat.webp';

/** Remembers which files loaded, so a missing file is requested only once. */
const imageStatus = new Map();

function probeImage(src) {
  const known = imageStatus.get(src);
  if (known) return known;
  const pending = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
  imageStatus.set(src, pending);
  return pending;
}

/**
 * Picks the background for a view.
 * @param {string} viewKey
 * @param {{ boss?: string, victory?: boolean, alleyMerchant?: boolean }} ctx
 */
export function sceneFor(viewKey, ctx = {}) {
  if (viewKey === 'VIEW_RUN_SUMMARY') {
    return ctx.victory ? { src: SCENE_VICTORY, tone: 'day' } : { src: SCENE_DEFEAT, tone: 'night' };
  }
  if (viewKey === 'VIEW_DUEL_ARENA' && ctx.boss && SCENE_BOSS[ctx.boss]) {
    return { src: SCENE_BOSS[ctx.boss], tone: 'night' };
  }
  if (viewKey === 'VIEW_CHECKPOINT_MERCHANT' && ctx.alleyMerchant) {
    return { src: SCENE_ALLEY_MERCHANT, tone: 'night' };
  }
  return SCENE_BY_VIEW[viewKey] || { src: null, tone: 'day' };
}

let sceneRequestId = 0;

/**
 * Shows the background of a view in #scene-backdrop.
 * The tone class is applied at once (it drives the fallback gradient);
 * the image fades in only after it has loaded.
 */
export function applySceneBackdrop(viewKey, ctx = {}) {
  const host = document.getElementById('scene-backdrop');
  if (!host) return;
  const scene = sceneFor(viewKey, ctx);
  const requestId = ++sceneRequestId;
  host.dataset.tone = scene.tone;
  host.dataset.view = viewKey;
  if (!scene.src) {
    host.classList.remove('has-image');
    return;
  }
  if (host.dataset.src === scene.src && host.classList.contains('has-image')) return;
  probeImage(scene.src).then((ok) => {
    if (requestId !== sceneRequestId) return;
    const layer = host.querySelector('.scene-backdrop-img');
    if (!ok || !layer) {
      host.classList.remove('has-image');
      host.dataset.src = '';
      return;
    }
    host.dataset.src = scene.src;
    layer.style.backgroundImage = `url("${scene.src}")`;
    host.classList.add('has-image');
  });
}

// ---------------------------------------------------------------------------
// NPC cast
// ---------------------------------------------------------------------------

/**
 * Shopkeepers and back-alley dealers. One person is drawn per encounter from
 * the run seed and the round, so a saved run shows the same person again.
 * Mood numbers come from the screens: shop 2 = legend pack in stock,
 * shop 3 = tired reaction on unpurchasable click, merchant 3 = a deal was closed.
 */
export const NPC_CAST = {
  shop: {
    count: 5,
    moods: { 2: 'excited', 3: 'tired' },
    path: (index, mood) => `assets/npc/shop_${index}_${mood}.webp`,
    vector: 'assets/ui/npc_shopkeeper.svg',
  },
  merchant: {
    count: 5,
    moods: { 3: 'deal' },
    path: (index, mood) => `assets/npc/merchant_${index}_${mood}.webp`,
    vector: 'assets/ui/npc_merchant.svg',
  },
};

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 1-based cast index for this run and round. */
export function npcCastIndex(kind, seed, round) {
  const cast = NPC_CAST[kind];
  if (!cast) return 1;
  return (hashString(`${kind}|${seed ?? 0}|${round ?? 0}`) % cast.count) + 1;
}

const NPC_DIALOGUES = {
  shop: {
    1: {
      default: '"어서 오게! 오늘 막 입고된 따끈따끈한 부스터 팩과 낱장 카드를 살펴보게나."',
      hasLegend: '"허허, 마침 진귀한 레전드 팩이 입고됐다네! 놓치기 전에 얼른 확인해 보게나."',
      allSold: '"오늘 들어온 물건은 전부 다 팔렸네. 다음 라운드에 새 물건을 들여서 기다리겠네!"',
      cantBuy: {
        noGold: '"허허, 그건 지금 주머니 사정이 안 되네만. 골드를 더 모아서 다시 오게나."',
        soldOut: '"미안하구먼, 그 팩은 이미 마지막 팩까지 다 팔렸네."',
        purchased: '"그 카드는 방금 자네 가방에 들어갔네. 진열대엔 더 이상 없다네."',
      },
    },
    2: {
      default: '"어서 오세요~! 방금 따끈한 신상 팩이랑 낱장 카드 진열 끝냈어요! 골라 보세요!"',
      hasLegend: '"우와, 대박! 오늘 레전드 팩까지 들어왔어요! 이거 금방 품절될지도 몰라요!"',
      allSold: '"헤헤, 오늘은 완전 매진이에요! 다음 라운드에 더 좋은 팩 잔뜩 가져올게요!"',
      cantBuy: {
        noGold: '"으음, 손님 지금 골드가 모자라요~! 다음 듀얼에서 상금 좀 타 오셔야겠어요!"',
        soldOut: '"아쉽지만 그 팩은 품절이에요~! 다른 팩이나 낱장 카드는 어때요?"',
        purchased: '"헤헤, 그건 아까 사 가신 카드예요~! 빈 진열대만 만지시면 곤란해요~"',
      },
    },
    3: {
      default: '"흥, 약한 덱으론 골목 끝까지 못 가. 쓸 만한 팩과 카드를 지금 챙겨두라고."',
      hasLegend: '"이봐, 보기 드문 레전드 팩이 굴러들어왔다. 감당할 수 있으면 가져가 봐."',
      allSold: '"매대는 싹 비었다. 빈손으로 어슬렁거리지 말고 다음 라운드에 다시 와."',
      cantBuy: {
        noGold: '"돈도 없으면서 물건만 집어 들면 어쩌자는 거야. 가격표 보고 다시 와."',
        soldOut: '"품절이라고 써 붙였잖아. 재고 없는 건 내어줄 수 없어."',
        purchased: '"이미 네 손에 넘어간 카드야. 없는 걸 또 달라고 하지 마."',
      },
    },
    4: {
      default: '"어서 오십시오. 귀하의 전술에 어울릴 팩과 낱장 카드를 정갈히 분류해 두었습니다."',
      hasLegend: '"흥미롭군요. 희귀한 레전드 팩이 한 점 입고되었습니다. 감식안이 있다면 알아보실 겁니다."',
      allSold: '"금일 준비한 목록은 모두 소진되었습니다. 다음 라운드에 새로운 사료를 입고하겠습니다."',
      cantBuy: {
        noGold: '"송구합니다만, 보유 자금이 가격에 미치지 못하는군요. 자금을 확인해 주십시오."',
        soldOut: '"해당 상품은 재고가 소진되었습니다. 다른 진열품을 살펴보시는 편이 좋겠습니다."',
        purchased: '"이미 구매 완료 처리된 카드입니다. 중복 출고는 어렵습니다."',
      },
    },
    5: {
      default: '"...어, 왔어요? 필요한 팩이나 카드 있으면 계산대에 올려두세요."',
      hasLegend: '"...아, 맞다. 저기 레전드 팩 하나 들어와 있는데. 관심 있으면 보든가요."',
      allSold: '"...다 나갔네요. 저도 좀 쉬어야겠으니 다음 라운드에 다시 오세요."',
      cantBuy: {
        noGold: '"...저기, 잔액 부족 떠 있는데요. 돈 더 모아서 와 주세요..."',
        soldOut: '"...품절이에요. 없는 재고를 찍어낼 순 없으니까요..."',
        purchased: '"...그거 방금 사 가셨잖아요. 빈 칸만 누르지 말아 주세요..."',
      },
    },
  },
  merchant: {
    1: {
      default: (card) => `"형씨! 방금 빼돌린 특급 물건인데, 「${card}」 갖고 있으면 바로 바꿔 드릴게요!"`,
      deal: () => '"오, 깔끔한 거래네요! 다른 카드도 구해오면 언제든 또 맞춰 드릴게요!"',
      allDone: () => '"오늘 준비한 물량은 끝! 다음 골목에서도 형씨 몫 챙겨둘게요!"',
    },
    2: {
      default: (card) => `"Yo, 푼돈은 집어치워. 「${card}」... 그 카드만 넘기면 내 금고의 진짜 레어를 내주지."`,
      deal: () => '"제법 통이 크군. 자네 같은 손님이라면 VIP 리스트에 올려두겠어."',
      allDone: () => '"오늘 밤 거래는 여기까지다. 헛걸음 말고 다음 라운드에 다시 보자고."',
    },
    3: {
      default: (card) => `"어이, 시간 없어. 내가 찾는 「${card}」 갖고 있어? 있으면 내 카드랑 맞바꾸자고."`,
      deal: () => '"흥, 생각보다 눈치가 빠르네. 마음에 드는 거 있으면 하나 더 찔러봐."',
      allDone: () => '"볼일 끝났으면 비켜. 나도 다음 판 뛰러 가야 하니까."',
    },
    4: {
      default: (card) => `"쉿... 골드 따윈 돌멩이일 뿐이지. 자네가 가진 「${card}」을 건네준다면 내 비밀 컬렉션과 바꿔주겠네."`,
      deal: () => '"좋아, 군말 없는 거래로군. 이 뒷골목의 규칙을 잘 알고 있구려."',
      allDone: () => '"내 가방은 이미 비었네. 그 카드로 골목의 시련을 잘 헤쳐나가 보게나."',
    },
    5: {
      default: (card) => `"...소문 듣고 오셨나요? 저는 「${card}」을 찾고 있어요. 조건이 맞으면 제 카드를 양보하죠."`,
      deal: () => '"만족스러운 교환이네요. 아직 남은 카드가 있으니 천천히 보셔도 됩니다."',
      allDone: () => '"원하던 카드는 전부 모았어요. 그럼, 결투장에서 살아남길 바랄게요."',
    },
  },
};

/**
 * Character-specific dialogue matching the selected shopkeeper or back-alley dealer.
 */
export function npcDialogue(kind, seed, round, { allSold = false, hasLegend = false, cantBuyReason = null, sampleCardName = '카드', doneCount = 0, totalCount = 0 } = {}) {
  const index = npcCastIndex(kind, seed, round);
  const table = NPC_DIALOGUES[kind];
  if (!table || !table[index]) return '';
  const persona = table[index];
  if (kind === 'shop') {
    if (cantBuyReason && persona.cantBuy) {
      return persona.cantBuy[cantBuyReason] || persona.cantBuy.noGold || persona.default;
    }
    if (allSold) return persona.allSold;
    if (hasLegend) return persona.hasLegend;
    return persona.default;
  }
  const stateKey = totalCount > 0 && doneCount >= totalCount ? 'allDone' : doneCount > 0 ? 'deal' : 'default';
  return persona[stateKey](sampleCardName || '카드');
}

/**
 * Image chain for a portrait: mood picture, then the person's base picture,
 * then the old vector portrait.
 * @returns {string[]}
 */
export function npcPortraitChain(kind, seed, round, mood = null) {
  const cast = NPC_CAST[kind];
  if (!cast) return [];
  const index = npcCastIndex(kind, seed, round);
  const chain = [];
  const moodName = mood != null ? cast.moods[mood] : null;
  if (moodName) chain.push(cast.path(index, moodName));
  chain.push(cast.path(index, 'base'));
  chain.push(cast.vector);
  return chain;
}

// ---------------------------------------------------------------------------
// Products (booster packs, specials, structure decks)
// ---------------------------------------------------------------------------

/** Where a product's key art goes. Only the picture: the wrap is drawn in CSS. */
export function productArtPath(productId) {
  return `assets/products/${productId}.webp`;
}

/**
 * Wrap style of a product: an explicit `wrap` field wins, then the type.
 * @returns {'booster' | 'special' | 'structure'}
 */
export function productKindOf(product) {
  if (product?.wrap) return product.wrap;
  if (product?.type === 'STRUCTURE') return 'structure';
  if (product?.type === 'LEGEND' || product?.faction === 'ALL') return 'special';
  return 'booster';
}

function escapeAttr(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * Product picture with its wrap. Until the key art file exists the old
 * vector pack art is shown unwrapped, exactly as before.
 * @param {{ id: string, name: string, color?: string, faction?: string }} product
 * @param {string} fallbackHtml markup shown when there is no key art
 */
export function productWrapHtml(product, fallbackHtml) {
  const kind = productKindOf(product);
  const src = productArtPath(product.id);
  return `
    <div class="product-wrap product-${kind}" data-faction="${escapeAttr(product.faction || '')}" style="--product-color:${escapeAttr(product.color || '#94a3b8')}">
      <div class="product-body">
        <div class="product-art">
          <img class="product-art-img" src="${src}" alt="" draggable="false"
            onload="this.closest('.product-wrap').classList.add('has-art')"
            onerror="this.remove()" />
        </div>
        <div class="product-foil"></div>
        <div class="product-band"><span class="product-name">${escapeAttr(product.name)}</span></div>
        <div class="product-side"></div>
      </div>
      <div class="product-crimp product-crimp-top"></div>
      <div class="product-crimp product-crimp-bottom"></div>
      <div class="product-fallback">${fallbackHtml}</div>
    </div>
  `;
}
