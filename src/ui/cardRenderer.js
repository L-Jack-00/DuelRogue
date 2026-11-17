import { getCardDef as lookupCardDef } from '../cards/catalog.js';
import { t } from '../i18n/strings.js';
import { keywordDesc } from '../duel/keywords.js';
import { svgIcon, keywordIcon } from './vectorIcons.js';
import { normalizeRarityKey } from './raritySystem.js';
import { getMasteryAttrAndStyle, resolveCardMasteryVisual } from './masterySystem.js';
import { resolveBakedAsset } from './vectorBaker.js';

const CUSTOM_ART_MAP = {
  C_BLUE_01: 'assets/cards/abyssal_golem_art.webp',
  C_PURP_02: 'assets/cards/neon_overload_art.webp',
};

let getRarityPreset = () => 'NONE';
let getMasteryVisual = (cardId) => resolveCardMasteryVisual(cardId);

/**
 * 카드 렌더러가 현재 레어도/숙련도 프리셋을 조회할 수 있도록 설정합니다.
 */
export function configureCardRenderer({ rarityPresetResolver, masteryVisualResolver } = {}) {
  if (typeof rarityPresetResolver === 'function') {
    getRarityPreset = rarityPresetResolver;
  }
  if (typeof masteryVisualResolver === 'function') {
    getMasteryVisual = masteryVisualResolver;
  }
}

/**
 * 5진법 발톱자국(탈리 마크) 레벨 HTML을 생성합니다 (우측 -> 좌측 정렬).
 */
export function generateClawLevelHtml(level) {
  if (!level || level <= 0) return '';
  const bundles = Math.ceil(level / 5);
  let remaining = level;
  let html = '';

  for (let b = 0; b < bundles; b++) {
    const strokesInThisBundle = Math.min(remaining, 5);
    const verticalStrokes = Math.min(strokesInThisBundle, 4);

    const clawSingleSrc = 'assets/badges/level_claw_single.svg';
    const clawCrossSrc = 'assets/badges/level_claw_cross.svg';
    let strokesHtml = '';
    for (let s = 0; s < verticalStrokes; s++) {
      strokesHtml += `<img src="${clawSingleSrc}" class="claw-stroke" alt="claw" />`;
    }

    const crossHtml = strokesInThisBundle === 5
      ? `<img src="${clawCrossSrc}" class="claw-cross" alt="claw cross" />`
      : '';

    html += `<div class="claw-tally-bundle">${strokesHtml}${crossHtml}</div>`;
    remaining -= strokesInThisBundle;
  }
  return `<div class="overlay-claw-level" title="레벨 ${level}">${html}</div>`;
}

/**
 * 공용 카드 뒷면 HTML을 생성합니다.
 */
export function generateCardBackHtml(scale = 1.0) {
  const compact = Number(scale) <= 0.72;
  const backSrc = resolveBakedAsset('assets/ui/card_back.svg', { compact });
  return `
    <div class="card-composite-wrapper card-back-wrapper">
      <div class="card-back-inner">
        <img src="${backSrc}" data-compact="${compact ? '1' : '0'}" class="card-back-svg-img" alt="" draggable="false" />
      </div>
    </div>
  `;
}

/**
 * 카드 원화 Layer 1 HTML을 생성합니다.
 */
export function getCardArtHtml(def, { compact = false } = {}) {
  const artSrc = CUSTOM_ART_MAP[def?.id];
  const fallbackSrc = resolveBakedAsset('assets/placeholders/procedural_fallback.svg', { compact });
  if (artSrc) {
    return `<img src="${artSrc}" alt="${def.name}" onerror="this.onerror=null; this.src='${fallbackSrc}';" />`;
  }
  const factionLabel = def?.faction ? t(`faction.${def.faction}`) : def?.archetype || '';
  return `
    <img src="${fallbackSrc}" data-compact="${compact ? '1' : '0'}" alt="${def?.name || ''}" style="width:100%; height:100%; object-fit:cover;" />
    <div class="procedural-art-overlay">
      <span class="procedural-archetype-pill">${factionLabel}</span>
    </div>
  `;
}

/**
 * 긴 카드 이름을 상단 양각 박스 가용 너비(레벨 발톱자국 제외 영역)에 맞게 동적 가로 압축(scaleX)하여 렌더링합니다.
 */
export function formatCardNameHtml(name, isMonster, level = 1) {
  if (!name) return '';
  const charUnits = Array.from(name).reduce((acc, ch) => {
    if (ch === ' ') return acc + 0.28;
    return acc + (ch.charCodeAt(0) > 255 ? 0.96 : 0.55);
  }, 0);

  const lv = Math.max(1, Number(level) || 1);
  const unitsByLevel = { 1: 9.8, 2: 9.1, 3: 8.4, 4: 7.8, 5: 7.7, 6: 6.7 };
  const monsterUnits = unitsByLevel[lv] ?? Math.max(4.5, 6.7 - (lv - 6) * 0.7);
  const baseUnits = isMonster ? monsterUnits : 10.8;
  let scaleX = 1.0;
  let letterSpacing = -0.02; // em 단위 소폭 자간
  if (charUnits > baseUnits) {
    scaleX = Math.max(0.55, baseUnits / charUnits);
    letterSpacing = Math.max(-0.06, -0.02 - (charUnits - baseUnits) * 0.012);
  }

  const squeezerStyle = scaleX < 0.999
    ? `transform:scaleX(${scaleX.toFixed(3)}); letter-spacing:${letterSpacing.toFixed(3)}em;`
    : `letter-spacing:${letterSpacing.toFixed(3)}em;`;

  const levelClass = isMonster ? `has-level has-lv-${Math.min(6, lv)}` : 'spell';
  const safeTitle = String(name).replace(/"/g, '&quot;');
  return `
    <div class="overlay-name ${levelClass}" title="${safeTitle}">
      <span class="card-name-text" style="${squeezerStyle}">${name}</span>
    </div>
  `;
}

/**
 * 3계층 카드 컴포지트 HTML을 생성합니다 (CSS Container Queries 기반 자동 400:560 비례 스케일).
 */
export function generateCompositeCardHtml(cardOrDef, dynamicAtk = null, dynamicDef = null, _scaleFont = 1.0, isBattlefield = false) {
  if (!cardOrDef) {
    return '<div class="card-idle-placeholder" style="color:#64748b; font-size:0.85rem; padding:20px; text-align:center;">카드를 선택하세요</div>';
  }
  const def = cardOrDef.cardId ? lookupCardDef(cardOrDef.cardId) || cardOrDef : cardOrDef;
  const isMonster = def.type === 'MONSTER' || (def.attack > 0 && def.type !== 'SPELL');
  const isToken = Boolean(def.isToken || cardOrDef.isToken);
  const atk = dynamicAtk ?? cardOrDef.currentAttack ?? def.attack ?? 0;
  const defense = dynamicDef ?? cardOrDef.currentDefense ?? def.defense ?? (def.health ?? 0);
  const level = cardOrDef.level ?? def.level ?? def.cost ?? 1;
  const rarityKey = normalizeRarityKey(def.rarity);
  const rarityPreset = getRarityPreset(rarityKey) || 'NONE';
  const masteryResolved = typeof getMasteryVisual === 'function' ? getMasteryVisual(def.id) : null;
  const { attrs: masteryAttrs, style: masteryStyle } = getMasteryAttrAndStyle(masteryResolved);

  const compact = Boolean(isBattlefield || Number(_scaleFont) <= 0.72);
  const frameSvg = resolveBakedAsset(
    isToken
      ? 'assets/frames/card_frame_token_blank.svg'
      : (isMonster ? 'assets/frames/card_frame_unit_blank.svg' : 'assets/frames/card_frame_spell_blank.svg'),
    { compact }
  );

  let bottomContentHtml = '';
  if (isBattlefield) {
    if (isMonster) {
      bottomContentHtml = `
        <div class="overlay-stat-badge atk-badge" title="공격력 ${atk}">
          <span class="stat-badge-num">${atk}</span>
        </div>
        <div class="overlay-stat-badge def-badge" title="수비력 ${defense}">
          <span class="stat-badge-num">${defense}</span>
        </div>
      `;
    }
  } else if (isMonster) {
    const kwIds = def.kw || [];
    const allLabels = [
      ...(def.keywords || []).map((k, i) => `<span class="frame-tag-pill keyword-pill">${keywordIcon(kwIds[i] || k)}${k}</span>`),
      ...(def.tags || []).map((tag) => {
        const formatted = `#${String(tag).replace(/^#+/, '')}`;
        return `<span class="frame-tag-pill tag-pill tag-tier-1">${formatted}</span>`;
      }),
    ];
    const formattedTagsHtml = allLabels.length > 0
      ? allLabels.join(' ')
      : '<span class="frame-tag-pill tag-pill">#몬스터</span>';
    bottomContentHtml = `
      <div class="overlay-tags" title="${[...(def.keywords || []), ...(def.tags || [])].join(', ')}">${formattedTagsHtml}</div>
      <div class="overlay-attack-group" title="공격력">
        <span class="stat-label-atk">공 / </span><span>${atk}</span>
      </div>
      <div class="overlay-defense-group" title="수비력">
        <span class="stat-label-def">수 / </span><span>${defense}</span>
      </div>
    `;
  } else {
    const triggerLabel = def.spellTriggerType ? t(`trigger.${def.spellTriggerType}`) : '';
    const triggerHtml = (!def.condition && triggerLabel)
      ? `<div class="spell-trigger-line">[${triggerLabel}]</div>`
      : '';
    const condLine = def.condition
      ? `<div class="spell-clause-line"><strong>조건:</strong> ${def.condition}</div>`
      : '';
    const effectBody = def.effect || def.description || def.effectType || '';
    const targetPrefix = def.target && !effectBody.includes(def.target) ? `[대상: ${def.target}] ` : '';
    const effectLine = `<div class="spell-clause-line">${condLine ? '<strong>효과:</strong> ' : ''}${targetPrefix}${effectBody}</div>`;
    bottomContentHtml = `
      <div class="overlay-spell-effect" title="${def.description || def.effectType}">
        ${triggerHtml}
        ${condLine}
        ${effectLine}
      </div>
    `;
  }

  const wrapperClass = [
    'card-composite-wrapper',
    isBattlefield ? 'battlefield-view' : '',
    isToken ? 'is-token-card' : '',
  ].filter(Boolean).join(' ');

  return `
    <div class="${wrapperClass}" data-card-id="${def.id || ''}" data-rarity="${rarityKey}" data-rarity-preset="${rarityPreset}" ${masteryAttrs} ${masteryStyle ? `style="${masteryStyle}"` : ''}>
      <div class="mastery-fx-overlay"></div>
      <div class="layer-1-art">
        ${getCardArtHtml(def, { compact })}
        <div class="rarity-art-fx-layer"></div>
      </div>
      <div class="layer-2-frame">
        <img src="${frameSvg}" data-compact="${compact ? '1' : '0'}" alt="${isMonster ? 'Monster Frame' : 'Spell Frame'}" />
      </div>
      <div class="layer-3-dynamic-labels">
        <div class="overlay-header-bar ${isMonster ? 'is-monster' : 'is-spell'}">
          ${formatCardNameHtml(def.name, isMonster, level)}
          ${isMonster ? generateClawLevelHtml(level) : ''}
        </div>
        ${bottomContentHtml}
      </div>
    </div>
  `;
}

export function generateIdleCardHtml(cardOrDef, dynamicAtk = null, dynamicDef = null) {
  return generateCompositeCardHtml(cardOrDef, dynamicAtk, dynamicDef, 1.0, false);
}

/**
 * 듀얼 인게임과 덱 편집기의 좌측 카드 상세 인스펙터 패널을 일괄 동기화합니다.
 */
export function updateCardInspector(cardOrDef, dynamicAtk = null, dynamicDef = null, options = {}) {
  if (!cardOrDef) return;
  const previewTargets = document.querySelectorAll('[data-inspector-preview]');
  const tagsTargets = document.querySelectorAll('[data-inspector-tags]');
  const effectTargets = document.querySelectorAll('[data-inspector-effect]');

  if (cardOrDef.isOpponentSecret || cardOrDef.isFacedown) {
    const backHtml = generateCardBackHtml();
    previewTargets.forEach((el) => { el.innerHTML = backHtml; });
    const secretEffectHtml = `
      <div class="rule-block secret-block">
        <span class="rule-badge-condition">[비공개 세트 카드]</span>
        <div class="rule-content-condition" style="margin-top: 4px;">상대 듀얼리스트가 전장에 뒤집어 세트한 비밀 카드입니다. 조건 충족 시 앞면으로 뒤집히며 효과가 발동됩니다.</div>
      </div>
    `;
    effectTargets.forEach((el) => { el.innerHTML = secretEffectHtml; });
    const secretTagsHtml = '<span class="badge-keyword">비공개</span> <span class="badge-race-tag">#세트카드</span>';
    tagsTargets.forEach((el) => { el.innerHTML = secretTagsHtml; });
    return;
  }

  const def = cardOrDef.cardId ? lookupCardDef(cardOrDef.cardId) || cardOrDef : cardOrDef;
  const atk = dynamicAtk ?? cardOrDef.currentAttack ?? def.attack ?? 0;
  const defense = dynamicDef ?? cardOrDef.currentDefense ?? def.defense ?? (def.health ?? 0);
  const keywords = def.keywords || [];
  const tags = def.tags || [];
  const isGod = def.isGod || def.level === 6;

  const idleCardHtml = generateIdleCardHtml(def, atk, defense);
  previewTargets.forEach((el) => {
    el.innerHTML = idleCardHtml;
  });

  let pillsHtml = '';
  if (options.isDeckMaster || cardOrDef.isDeckMaster) {
    pillsHtml += `<span class="badge-god-tier">${svgIcon('crown')} 덱 마스터</span> `;
  }
  if (isGod) {
    pillsHtml += `<span class="badge-god-tier">${svgIcon('crown')} 신(神)</span> `;
  }

  const kwIds = cardOrDef.kw || def.kw || [];
  if (keywords.length > 0) {
    pillsHtml += keywords
      .map((kw, i) => `<span class="badge-keyword" title="${kwIds[i] ? keywordDesc(kwIds[i]) : '핵심 기능 키워드'}">${keywordIcon(kwIds[i] || kw)}${kw}</span>`)
      .join(' ') + ' ';
  }
  if (def.rarity) {
    pillsHtml += `<span class="badge-rarity rarity-${def.rarity}">${t(`rarity.${def.rarity}`)}</span> `;
  }
  if (tags.length > 0) {
    pillsHtml += tags
      .map((tag) => {
        const formatted = `#${String(tag).replace(/^#+/, '')}`;
        return `<span class="badge-race-tag tag-tier-1" title="태그 (${formatted})">${formatted}</span>`;
      })
      .join(' ');
  }
  if (!pillsHtml.trim()) {
    pillsHtml = '<span class="badge-keyword">기본</span>';
  }
  tagsTargets.forEach((el) => { el.innerHTML = pillsHtml; });

  let contentHtml = '';
  if (def.target) {
    contentHtml += `
      <div class="rule-block target-block">
        <span class="rule-badge-target">[대상]</span>
        <span class="rule-content-target">${def.target}</span>
      </div>
    `;
  }

  const kwList = cardOrDef.kw || def.kw || [];
  if (kwList.length > 0) {
    contentHtml += `
      <div class="rule-block keyword-block">
        <span class="rule-badge-condition">[키워드]</span>
        <span class="rule-content-condition">${kwList.map((id) => `${keywordIcon(id)}<strong>${t(`kw.${id}`)}</strong> — ${keywordDesc(id)}`).join('<br>')}</span>
      </div>
    `;
  }
  if (cardOrDef.silenced) {
    contentHtml += '<div class="rule-block"><span class="rule-badge-condition">[침묵]</span> <span class="rule-content-condition">키워드와 효과가 지워진 상태입니다.</span></div>';
  }

  if (def.condition || def.effect) {
    if (def.condition) {
      contentHtml += `
        <div class="rule-block condition-block">
          <span class="rule-badge-condition">[조건]</span>
          <span class="rule-content-condition">${def.condition}</span>
        </div>
      `;
    }
    if (def.effect) {
      contentHtml += `
        <div class="rule-block effect-block">
          <span class="rule-badge-effect">[효과]</span>
          <span class="rule-content-effect">${def.effect}</span>
        </div>
      `;
    }
  } else if (kwList.length === 0) {
    contentHtml += '<div class="rule-block effect-block"><span class="rule-content-effect">특수 효과가 없는 몬스터입니다.</span></div>';
  }

  effectTargets.forEach((el) => { el.innerHTML = contentHtml; });
}
