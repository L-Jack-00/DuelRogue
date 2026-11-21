/**
 * [DUEL ROGUE] 레어도 명칭 개편, 체크포인트 랜덤 이벤트/변동성, 숙련도 비주얼 커스텀 테스트
 */
import { DuelRogueEngine, DEFAULT_CARD_CATALOG } from '../src/duelRogueEngine.js';
import { BinderCore, InMemoryBinderStorage } from '../src/binderCore.js';
import { t } from '../src/i18n/strings.js';
import { rarityLabel } from '../src/run/content.js';
import { RARITY_LABELS_KO } from '../src/ui/raritySystem.js';
import {
  loadMasteryFxConfig,
  saveMasteryFxConfig,
  resolveCardMasteryVisual,
  getMasteryTierFromPoints,
  isMasteryPresetUnlocked,
  getNextMasteryUnlockInfo,
} from '../src/ui/masterySystem.js';
import {
  matchesBagSearchQuery,
  filterAndSortBagCardIds,
} from '../src/ui/deckEditorFilter.js';
import {
  VECTOR_BAKE_SPECS,
  normalizeVectorAssetKey,
  injectSvgPixelDimensions,
  resolveBakedAsset,
  bakeAllVectorAssets,
  bakeDynamicSvgAsset,
  resolveBakedDynamicAsset,
} from '../src/ui/vectorBaker.js';
import {
  getSleeveBakeKey,
  getSleeveBakeSource,
  resolvePlayerSleeveSpec,
} from '../src/ui/cosmeticsSystem.js';
import { npcDialogue, npcPortraitChain } from '../src/ui/sceneArt.js';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[ASSERTION FAILED] ${msg}`);
}

Deno.test('레어도 명칭 통일: 노말 / 레어 / 에픽 / 유니크 / 레전드', () => {
  const expected: Record<string, string> = {
    COMMON: '노말',
    UNCOMMON: '레어',
    RARE: '에픽',
    EPIC: '유니크',
    LEGENDARY: '레전드',
  };
  for (const [k, label] of Object.entries(expected)) {
    assert(t(`rarity.${k}`) === label, `strings t(rarity.${k}) === ${label}`);
    assert(rarityLabel(k) === label, `rarityLabel(${k}) === ${label}`);
    assert(RARITY_LABELS_KO[k].startsWith(label), `RARITY_LABELS_KO[${k}] starts with ${label}`);
  }
});

Deno.test('체크포인트 랜덤성 & 돌발 이벤트: 시드별 상점/이벤트/상대 변동 및 라운드1 자금 보존', () => {
  const signatures = new Set<string>();
  const eventIds = new Set<string>();
  for (let s = 1001; s <= 1020; s++) {
    const storage = new InMemoryBinderStorage();
    const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage });
    const engine: any = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, s);
    engine.startNewRun(`RUN_RAND_${s}`, s);
    const snap = engine.selectFortuneDestiny('BLUE_JUSTICE', 'CHECKPOINT');
    assert(snap.gold === 1000, `시드 ${s}: 라운드 1 시작 골드는 1000이어야 합니다.`);
    assert(snap.checkpointEvent && snap.checkpointEvent.id, `시드 ${s}: checkpointEvent가 생성되어야 합니다.`);
    eventIds.add(snap.checkpointEvent.id);
    const packIds = (snap.checkpointShopStock || []).map((p: any) => p.id).join(',');
    const encName = snap.nextEncounterInfo?.opponentName || '';
    assert(encName === 'ROUND 1', `라운드 1 상대 이름은 'ROUND 1'이어야 합니다 (실제: ${encName})`);
    signatures.add(`${snap.checkpointEvent.id}|${packIds}|${encName}`);
  }
  assert(eventIds.size >= 3, `여러 시드에서 다양한 돌발 이벤트가 등장해야 합니다 (실제: ${eventIds.size})`);
  assert(signatures.size >= 6, `여러 시드에서 상점/이벤트/인카운터 조합이 다양해야 합니다 (실제: ${signatures.size})`);
});

Deno.test('숙련도 비주얼 커스텀: 4단계 티어(0/30/60/100) 해금 게이트 + 전역/개별 영속성', () => {
  const mem = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
  };

  const cfg = loadMasteryFxConfig(fakeStorage);
  cfg.tierDefaults.VETERAN.preset = 'ARCANE_SPARK';
  cfg.tierDefaults.ADEPT.preset = 'SUBTLE_EDGE';
  cfg.cardOverrides['C_BLUE_01'] = { preset: 'GOLDEN_CROWN', glow: 1.5, foil: 1.4, tint: '#fbbf24' };
  saveMasteryFxConfig(cfg, fakeStorage);

  const reloaded = loadMasteryFxConfig(fakeStorage);
  assert(getMasteryTierFromPoints(0, 2) === 'UNMASTERED', '0pt는 UNMASTERED 티어여야 합니다.');
  assert(getMasteryTierFromPoints(30, 2) === 'ADEPT', '30pt는 ADEPT 티어여야 합니다.');

  const normalVeteran = resolveCardMasteryVisual('C_RED_01', 60, 2, reloaded);
  assert(normalVeteran.tier === 'VETERAN', '60pt는 VETERAN 티어여야 합니다.');
  assert(normalVeteran.preset === 'ARCANE_SPARK' && !normalVeteran.isOverridden, '60pt에서 ARCANE_SPARK 해금 및 전역 티어 커스텀이 적용되어야 합니다.');

  const lockedOverride = resolveCardMasteryVisual('C_BLUE_01', 10, 2, reloaded);
  assert(lockedOverride.preset === 'NONE', '10pt 미해금 상태에서는 GOLDEN_CROWN 오버라이드가 차단되어 NONE이어야 합니다.');

  const unlockedMaster = resolveCardMasteryVisual('C_BLUE_01', 100, 3, reloaded);
  assert(unlockedMaster.tier === 'MASTERED', '100pt는 MASTERED 티어여야 합니다.');
  assert(unlockedMaster.preset === 'GOLDEN_CROWN' && unlockedMaster.isOverridden, '100pt 달성 시 GOLDEN_CROWN 개별 오버라이드가 우선 적용되어야 합니다.');
});

Deno.test('벡터 그래픽 베이킹 시스템: 주요 SVG 스펙, 크기 주입, 헤드리스 안전 폴백', async () => {
  const paths = new Set(VECTOR_BAKE_SPECS.map((s) => s.path));
  assert(paths.has('assets/frames/card_frame_unit_blank.svg'), '유닛 카드 프레임 SVG가 베이킹 대상이어야 합니다.');
  assert(paths.has('assets/ui/card_back.svg'), '카드 뒷면 SVG가 베이킹 대상이어야 합니다.');
  assert(paths.has('assets/ui/app_icon.svg'), '앱 아이콘 SVG가 베이킹 대상이어야 합니다.');

  assert(normalizeVectorAssetKey('./assets/ui/app_icon.svg?v=1') === 'assets/ui/app_icon.svg', '에셋 경로 정규화 동작');

  const sampleSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 560" width="100%" height="100%"><rect/></svg>';
  const injected = injectSvgPixelDimensions(sampleSvg, 800, 1120);
  assert(injected.includes('width="800"') && injected.includes('height="1120"'), 'SVG 루트에 픽셀 width/height가 주입되어야 합니다.');

  const stats = await bakeAllVectorAssets();
  assert(stats.ready === true && stats.totalCount === VECTOR_BAKE_SPECS.length, '헤드리스 환경에서도 안전하게 ready 상태가 반환되어야 합니다.');
  assert(resolveBakedAsset('assets/ui/app_icon.svg') === 'assets/ui/app_icon.svg', '미베이킹 상태에서는 원본 경로로 폴백해야 합니다.');
  assert(resolveBakedAsset('assets/frames/card_frame_unit_blank.svg', { compact: true }) === 'assets/frames/card_frame_unit_blank.svg', 'compact 조회도 미베이킹 상태에서는 원본 경로로 폴백해야 합니다.');
  const frameSpec = VECTOR_BAKE_SPECS.find((s) => s.path === 'assets/frames/card_frame_unit_blank.svg');
  assert(Boolean(frameSpec?.thumbWidth && frameSpec?.thumbHeight), '카드 프레임 스펙에는 축소 썸네일용 2단계 밉맵 해상도가 정의되어야 합니다.');
});

Deno.test('상점 신규 생성 팩 재고 >= 1 보장 및 구매 불가 반응(tired/cantBuyReason) 동작', () => {
  const seeds = [101, 202, 303, 777, 9999, 424242];
  for (const seed of seeds) {
    for (let round = 1; round <= 5; round += 1) {
      const storage = new InMemoryBinderStorage();
      const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage });
      const eng: any = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, seed);
      eng.startNewRun(`RUN_SHOP_${seed}_${round}`, seed);
      eng.selectFortuneDestiny('BLUE_JUSTICE', 'CHECKPOINT');
      eng.state.phase = 'STAGE_CHECKPOINT';
      eng.state.roundNumber = round;
      eng.generateCheckpointState();
      const stockList = eng.state.checkpointShopStock || [];
      assert(stockList.length >= 2, `시드 ${seed} 라운드 ${round} 상점에 2종 이상 팩 진열 필요`);
      for (const pack of stockList) {
        assert(Number.isInteger(pack.stock) && pack.stock >= 1, `시드 ${seed} 라운드 ${round} 팩(${pack.id}) 재고가 0 이하임: ${pack.stock}`);
      }
    }
  }

  for (let round = 1; round <= 5; round += 1) {
    const tiredChain = npcPortraitChain('shop', 101, round, 3);
    assert(tiredChain[0].includes('_tired.webp'), `mood 3은 tired 표정이어야 함: ${tiredChain[0]}`);
    for (const reason of ['noGold', 'soldOut', 'purchased']) {
      const line = npcDialogue('shop', 101, round, { cantBuyReason: reason, allSold: false, hasLegend: true });
      assert(typeof line === 'string' && line.length > 0, `cantBuyReason=${reason} 대사가 비어 있음`);
    }
  }
});

Deno.test('런당 3회 기회(하트) 감소, 패배 시 다음 라운드 이동(골드 미지급·상점/골목길 갱신) 및 0회 시 RUN_FAILED 전이 검증', () => {
  const storage = new InMemoryBinderStorage();
  const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage });
  const eng: any = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, 20261118);
  eng.startNewRun('RUN_CHANCES_TEST', 20261118);
  let snap = eng.selectFortuneDestiny('RED_ZEAL', 'CHECKPOINT');
  assert(snap.maxChances === 3 && snap.remainingChances === 3, '초기 CHECKPOINT 런 기회는 3이어야 합니다.');
  const goldBefore = snap.gold;
  const encBeforeKey = `${snap.nextEncounterInfo?.duelistId}_${snap.nextEncounterInfo?.round}`;

  // 1패: 남은 기회 3 -> 2, 승리 골드 미지급, 라운드 2로 이동 및 체크포인트 갱신
  snap = eng.startRandomEncounter();
  snap.activeDuel.seats[0].lp = 0;
  snap = eng.evaluateDuelOutcome(snap.activeDuel);
  assert(snap.remainingChances === 2, `1패 후 남은 기회는 2여야 합니다 (실제: ${snap.remainingChances})`);
  assert(snap.phase === 'STAGE_CHECKPOINT' && snap.roundNumber === 2, '기회가 남아있으면 다음 라운드 체크포인트로 이동해야 합니다.');
  assert(snap.gold === goldBefore && snap.lastEncounterReward === 0, '패배 시에는 승리 골드가 지급되지 않아야 합니다.');
  assert(`${snap.nextEncounterInfo?.duelistId}_${snap.nextEncounterInfo?.round}` !== encBeforeKey, '패배 후 다음 라운드 골목길 도전자/체크포인트가 새로 생성되어야 합니다.');

  // 2패: 남은 기회 2 -> 1, 라운드 3 이동, 세이브/복원 후에도 1 유지
  snap = eng.startRandomEncounter();
  snap.activeDuel.seats[0].lp = 0;
  snap = eng.evaluateDuelOutcome(snap.activeDuel);
  assert(snap.remainingChances === 1 && snap.phase === 'STAGE_CHECKPOINT' && snap.roundNumber === 3, '2패 후 남은 기회 1 및 라운드 3 체크포인트 이동');
  assert(snap.gold === goldBefore, '2패 후에도 승리 골드가 증가하면 안 됩니다.');

  const saved = eng.exportSave();
  const restored: any = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, 1);
  const restoredSnap = restored.importSave(saved);
  assert(restoredSnap.remainingChances === 1 && restoredSnap.maxChances === 3 && restoredSnap.roundNumber === 3, '저장/복원 시 남은 기회와 라운드가 보존되어야 합니다.');

  // 3패 (일반 인카운터): 남은 기회 1 -> 0, RUN_FAILED 전이
  snap = restored.startRandomEncounter();
  snap.activeDuel.seats[0].lp = 0;
  snap = restored.evaluateDuelOutcome(snap.activeDuel);
  assert(snap.remainingChances === 0, `3패 후 남은 기회는 0이어야 합니다 (실제: ${snap.remainingChances})`);
  assert(snap.phase === 'RUN_FAILED', '일반 도전 기회 3회 소진 시 RUN_FAILED로 전이해야 합니다.');
});

Deno.test('최종 보스 패배 시 남은 기회와 무관하게 즉시 RUN_FAILED 탈락 검증', () => {
  const storage = new InMemoryBinderStorage();
  const binder = new BinderCore({ catalog: DEFAULT_CARD_CATALOG, storage });
  const eng: any = new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, 20261119);
  eng.startNewRun('RUN_BOSS_INSTANT_FAIL', 20261119);
  let snap = eng.selectFortuneDestiny('BLUE_JUSTICE', 'CHECKPOINT');
  assert(snap.remainingChances === 3, '초기 남은 기회는 3이어야 합니다.');

  snap = eng.challengeFinalBoss();
  snap.activeDuel.seats[0].lp = 0;
  snap = eng.evaluateDuelOutcome(snap.activeDuel);
  assert(snap.phase === 'RUN_FAILED', '최종 보스 패배 시 남은 기회가 있어도 즉시 RUN_FAILED가 되어야 합니다.');
  assert(snap.remainingChances === 0 && snap.lastDefeatInfo?.wasBoss === true, '보스 패배 시 남은 기회 0 및 보스 패배 기록이 남아야 합니다.');
});

Deno.test('플레이매트 불투명·드래그 클리핑 해제, 백색 세트 오오라, 자물쇠? 통일, 시드 선택 가능 검증', () => {
  const html = Deno.readTextFileSync('index.html');
  const styleCss = Deno.readTextFileSync('style.css');
  const alleyCss = Deno.readTextFileSync('theme-alley.css');
  const mainJs = Deno.readTextFileSync('main.js');

  assert(html.includes('id="checkpoint-chances-hearts"'), '체크포인트 허브 하트 UI 요소가 있어야 합니다.');
  assert(html.includes('id="duel-player-chances"'), '듀얼 전장 플레이어 하트 UI 요소가 있어야 합니다.');
  assert(html.includes('id="duel-defeat-chances"'), '패배 오버레이 하트 UI 요소가 있어야 합니다.');
  assert(html.includes('id="summary-chances-badge"'), '결과 요약 하트 UI 요소가 있어야 합니다.');
  assert(html.includes('id="encounter-defeat-rule-text"'), '도전 패배 시 안내 요소가 있어야 합니다.');

  assert(!alleyCss.includes('rgba(212, 208, 200, 0.50)'), '상대 플레이매트는 반투명(0.50)이 아니어야 합니다.');
  assert(!alleyCss.includes('rgba(212, 208, 200, 0.48)'), '공통 보드 존은 반투명(0.48)이 아니어야 합니다.');
  assert(alleyCss.includes('body.theme-alley #game-fx-canvas { z-index: 25000 !important; }'), '파괴 이펙트 캔버스가 매트 위 최상단에 위치해야 합니다.');
  assert(styleCss.includes('rgba(255, 255, 255, 0.65)') && styleCss.includes('user-select: text !important'), '백색 세트 오오라 및 시드 드래그 선택 스타일이 존재해야 합니다.');
  assert(styleCss.includes('.board-zone.has-dragging-attacker') && alleyCss.includes('body.theme-alley .board-zone.has-dragging-attacker'), '상대/내 보드 모두 공격·드래그 시 매트 위로 z-index 상승 및 preserve-3d 해제가 적용되어야 합니다.');
  assert(!mainJs.includes("'<span class=\"front-set-pill\">세트</span>'") && mainJs.includes("${isMine ? frontSpell.name : `${svgIcon('lock')} ?`}"), '몬스터 세트 표시도 자물쇠 ?로 통일되어야 합니다.');
});

Deno.test('낱장 진열대·수상한 거래상 거래품 호버 프리뷰 및 키워드·태그 효과 상단 배치 검증', () => {
  const mainJs = Deno.readTextFileSync('main.js');
  const styleCss = Deno.readTextFileSync('style.css');
  const alleyCss = Deno.readTextFileSync('theme-alley.css');

  assert(mainJs.includes('itemEl.dataset.cardId = item.cardId;'), '상점 낱장 진열대 아이템에 data-card-id가 부여되어야 합니다.');
  assert(mainJs.includes('<div class="deal-offer-side" data-card-id="${cardDef.id}">'), '수상한 거래상 거래품(.deal-offer-side)에 data-card-id가 부여되어야 합니다.');
  assert(mainJs.includes('itemCardEl.dataset.cardId = item.cardId;'), '수상한 거래상 낱장 카드에도 data-card-id가 부여되어야 합니다.');
  assert(
    mainJs.includes('.wanted-chip[data-card-id], .deal-offer-side[data-card-id], .merchant-item-card[data-card-id]') &&
    mainJs.includes("attachHover(document.getElementById('checkpoint-shop-singles-container'), '.shop-single-card-item[data-card-id]');"),
    '요구 카드와 동일한 attachHover/showLogCardHoverPreview 메커니즘으로 상점 진열대와 거래품 호버가 연결되어야 합니다.'
  );
  assert(
    mainJs.includes('<div class="log-hover-tags">${pills.join(\'\')}</div>') &&
    mainJs.includes('${cardHtml}${tagsHtml}${effectHtml}'),
    '호버 프리뷰에서 키워드와 태그(.log-hover-tags)가 효과 텍스트(.log-hover-effect) 위쪽에 배치되어야 합니다.'
  );
  assert(styleCss.includes('.log-hover-tags') && alleyCss.includes('body.theme-alley .log-hover-effect'), '호버 태그 및 테마 대비 스타일이 존재해야 합니다.');
});

Deno.test('모든 간략화 카드(.battlefield-view) 3D 기울임 제거(평소/호버) 및 시안 B(양피지+고딕 21.8배율) + 동적 텍스트박스 압축 검증', async () => {
  const mainJs = Deno.readTextFileSync('main.js');
  const styleCss = Deno.readTextFileSync('style.css');
  const harnessJs = Deno.readTextFileSync('src/desktopHarness.js');
  const { formatCardNameHtml, fitCardNameTextBoxes } = await import('../src/ui/cardRenderer.js');

  assert(mainJs.includes('const fanTiltX = 0;') && mainJs.includes('const fanDepthZ = 0;'), '패 카드 평소 X축 3D 기울임과 Z깊이가 0이어야 합니다.');
  assert(harnessJs.includes("this.element.style.setProperty('--card-rx', '0deg');"), '호버 및 비드래그 상태에서는 3D 틸트가 0deg여야 합니다.');
  assert(
    styleCss.includes('.card-composite-wrapper.battlefield-view .overlay-name') &&
    styleCss.includes('font-size: calc(var(--card-unit, 0.5cqw) * 21.8);') &&
    styleCss.includes('transform: translateY(-36px) scale(1.15) !important;'),
    '모든 간략화 카드(.battlefield-view)에 21.8배율 고딕 이름 스타일 및 2D 평면 호버가 적용되어야 합니다.'
  );
  assert(typeof fitCardNameTextBoxes === 'function', '동적 텍스트박스 압축 헬퍼가 export 되어야 합니다.');
  assert(
    mainJs.includes('fitCardNameTextBoxes(document.getElementById(\'view-duel-arena\'));') &&
    mainJs.includes('fitCardNameTextBoxes(modalEl);') &&
    mainJs.includes('fitCardNameTextBoxes(targetView);') &&
    mainJs.includes("targetView.classList.remove('screen-entering');") &&
    mainJs.includes('bindDynamicCardNameFitter()'),
    '듀얼·모달·뷰 전환 및 CRT 진입 애니메이션 해제 후 동적 텍스트박스 압축이 연동되어야 합니다.'
  );
  const scaledHtml = formatCardNameHtml('천상의 대천사 미카엘', true, 6, 21.8 / 15.8);
  assert(scaledHtml.includes('data-fit-name="1"') && scaledHtml.includes('scaleX('), '21.8배율 기준 초기 이름 압축 style이 적용되어야 합니다.');
});

Deno.test('모든 뷰(전장·패·인스펙터·바인더·덱요약 캔버스)의 카드 비주얼 튜너 연동 및 글꼴 테스트 환경 검증', async () => {
  const styleCss = Deno.readTextFileSync('style.css');
  const mainJs = Deno.readTextFileSync('main.js');
  const html = Deno.readTextFileSync('index.html');
  const {
    CARD_NAME_FONT_PRESETS,
    DEFAULT_CARD_NAME_FONT_SETTINGS,
    resolveCardNameFontStack,
  } = await import('../src/ui/raritySystem.js');

  assert(
    styleCss.includes(':where(#inspector-card-preview, #editor-inspector-card-preview) .card-composite-wrapper') &&
    styleCss.includes(':where(.binder-slot) .card-composite-wrapper') &&
    styleCss.includes(':where(#binder-dossier-card-preview) .card-composite-wrapper'),
    '인스펙터·바인더·도시에 카드가 비주얼 튜너 외곽 발광(--r-glow)을 가리거나 차단하지 않아야 합니다.'
  );
  assert(
    styleCss.includes('.card-composite-wrapper.battlefield-view .overlay-name') &&
    styleCss.includes('font-weight: var(--card-name-font-weight, 400);') &&
    styleCss.includes('font-family: var(--card-name-font-stack,') &&
    styleCss.includes('color: #000000;'),
    '모든 간략화 카드(.battlefield-view)의 이름 텍스트가 기본 비볼드 순수 검정색 + CSS 변수 기반 글꼴 전환을 지원해야 합니다.'
  );
  assert(
    DEFAULT_CARD_NAME_FONT_SETTINGS.fontWeight === '400' &&
    Boolean(CARD_NAME_FONT_PRESETS.DUNGGEUNMO) &&
    Boolean(CARD_NAME_FONT_PRESETS.GOWUN_BATANG) &&
    resolveCardNameFontStack({ fontPreset: 'CUSTOM', customFont: 'MaruBuri' }).includes("'MaruBuri'"),
    '글꼴 프리셋 및 사용자 지정 시스템 폰트 해석이 정상 동작해야 합니다.'
  );
  assert(
    html.includes('id="sel-card-name-font"') &&
    html.includes('id="sel-card-name-weight"') &&
    html.includes('id="input-card-name-custom"') &&
    html.includes('id="btn-rarity-preview-compact"') &&
    mainJs.includes('populateCardNameFontSelect()'),
    '[F4] 비주얼 튜너 모달에 실시간 글꼴 테스트 컨트롤이 연동되어야 합니다.'
  );
  assert(
    mainJs.includes('rCfg?.nameGlow') &&
    mainJs.includes('rCfg?.nameColor') &&
    !styleCss.includes('0 0 calc(var(--r-glow, 0.8) * 10px)') &&
    styleCss.includes('box-shadow: 0 0 20px rgba(251, 191, 36, 0.78);'),
    '평소 레어도 외곽 오오라는 제거하되, 숙련도 외곽 오오라는 유지되어야 합니다.'
  );
  assert(
    styleCss.includes('.sinister-dark-aura') &&
    styleCss.includes('rgba(255, 255, 255, 0.65)'),
    '세트 시 백색 오오라(.sinister-dark-aura)는 그대로 유지되어야 합니다.'
  );
});

Deno.test('덱 편집 검색/정렬: 통합 검색(이름+태그+키워드+효과 AND) 및 6종 정렬', () => {
  const defs: Record<string, any> = {
    C1: { id: 'C1', name: '불꽃 기사', type: 'MONSTER', tags: ['화염', '기사'], keywords: ['관통'], effect: '적 1체에 200 피해', level: 4, attack: 1600, defense: 1200, rarity: 'RARE' },
    C2: { id: 'C2', name: '강철 방패병', type: 'MONSTER', tags: ['수비', '병사'], keywords: ['도발'], effect: '수비 표시로 소환된다', level: 3, attack: 900, defense: 2100, rarity: 'COMMON' },
    C3: { id: 'C3', name: '마력 폭발', type: 'SPELL', tags: ['화염', '주문'], keywords: [], effect: '상대 필드에 관통 데미지', rarity: 'EPIC' },
  };
  const lookup = (id: string) => defs[id];
  const bag = ['C1', 'C2', 'C3'];

  assert(matchesBagSearchQuery(defs.C1, '#화염 기사'), '#화염 태그와 이름 공백 AND 검색이 매칭되어야 합니다.');
  assert(!matchesBagSearchQuery(defs.C3, '#화염 기사'), '공백 구분 AND 조건에서 모든 토큰을 만족하지 않으면 제외되어야 합니다.');
  assert(matchesBagSearchQuery(defs.C2, '도발 수비'), '키워드와 효과 텍스트 공백 AND 검색이 매칭되어야 합니다.');

  const fireFiltered = filterAndSortBagCardIds(bag, { query: '#화염', sortBy: 'DEFAULT' }, lookup);
  assert(fireFiltered.length === 2 && fireFiltered.includes('C1') && fireFiltered.includes('C3'), '#화염 검색 시 일치하는 카드만 가방에서 압축 표시되어야 합니다.');

  const byAtk = filterAndSortBagCardIds(bag, { query: '', sortBy: 'ATTACK' }, lookup);
  assert(byAtk[0] === 'C1' && byAtk[1] === 'C2' && byAtk[2] === 'C3', '공격력순 정렬이 내림차순으로 동작해야 합니다.');

  const byDef = filterAndSortBagCardIds(bag, { query: '', sortBy: 'DEFENSE' }, lookup);
  assert(byDef[0] === 'C2' && byDef[1] === 'C1', '수비력순 정렬이 내림차순으로 동작해야 합니다.');

  const byLv = filterAndSortBagCardIds(bag, { query: '', sortBy: 'LEVEL' }, lookup);
  assert(byLv[0] === 'C3' && byLv[1] === 'C2' && byLv[2] === 'C1', '레벨순 정렬이 낮은 레벨(마법/Lv1 → 고레벨) 커브 순으로 동작해야 합니다.');

  const byRarity = filterAndSortBagCardIds(bag, { query: '', sortBy: 'RARITY' }, lookup);
  assert(byRarity[0] === 'C3' && byRarity[2] === 'C2', '레어도순 정렬이 상위 등급 우선이어야 합니다.');

  const byName = filterAndSortBagCardIds(bag, { query: '', sortBy: 'NAME' }, lookup);
  assert(byName[0] === 'C2' && byName[1] === 'C3' && byName[2] === 'C1', '이름순 정렬이 가나다순으로 동작해야 합니다.');
});

Deno.test('숙련도 해금 카운트다운 및 덱 편집 조작/오버레이/전투 VFX 회귀 검증', async () => {
  assert(!isMasteryPresetUnlocked('SUBTLE_EDGE', 29, 2), '29pt에서는 SUBTLE_EDGE가 잠겨 있어야 합니다.');
  assert(isMasteryPresetUnlocked('SUBTLE_EDGE', 30, 2), '30pt에서 SUBTLE_EDGE가 해금되어야 합니다.');
  assert(!isMasteryPresetUnlocked('ARCANE_SPARK', 59, 2), '59pt에서는 ARCANE_SPARK가 잠겨 있어야 합니다.');
  assert(isMasteryPresetUnlocked('ARCANE_SPARK', 60, 2), '60pt에서 ARCANE_SPARK가 해금되어야 합니다.');
  assert(!isMasteryPresetUnlocked('HOLO_FOIL', 99, 2), '99pt에서는 HOLO_FOIL이 잠겨 있어야 합니다.');
  assert(isMasteryPresetUnlocked('GOLDEN_CROWN', 100, 3), '100pt에서 GOLDEN_CROWN이 해금되어야 합니다.');

  const nextFrom0 = getNextMasteryUnlockInfo(10, 2);
  assert(nextFrom0.remainingPoints === 20 && nextFrom0.nextMilestone === 30, '10pt 기준 다음 해금은 30pt(20pt 남음)여야 합니다.');
  const nextFromMaster = getNextMasteryUnlockInfo(100, 3);
  assert(nextFromMaster.nextMilestone === null && nextFromMaster.remainingPoints === 0, '100pt 이상 마스터 상태에서는 다음 마일스톤이 null이어야 합니다.');

  const mainJs = await Deno.readTextFile('./main.js');
  const html = await Deno.readTextFile('./index.html');
  const styleCss = await Deno.readTextFile('./style.css');
  const cardRenderer = await Deno.readTextFile('./src/ui/cardRenderer.js');

  assert(
    html.includes('id="input-editor-bag-search"') &&
    html.includes('id="sel-editor-bag-sort"') &&
    html.includes('id="editor-mastery-progress-info"'),
    '덱 편집 화면에 가방 검색/정렬 툴바와 숙련도 해금 안내 요소가 존재해야 합니다.'
  );
  assert(
    mainJs.includes("selectEditorTile(tileEl, tileKey, def, isDeckMaster)") &&
    mainJs.includes("tileEl.addEventListener('contextmenu', (e) => {") &&
    mainJs.includes("selectEditorTile(tileEl, tileKey, def, false)") &&
    mainJs.includes('openDeckMasterPickerModal()'),
    '덱 편집 화면에서 좌클릭=선택, 우클릭=이동/덱마스터 교체 모달 조작이 바인딩되어야 합니다.'
  );
  assert(
    !cardRenderer.includes('mastery-crown-seal') &&
    styleCss.includes('.layer-1-art .mastery-fx-overlay'),
    '숙련도 뱃지(.mastery-crown-seal)는 제거되고 일러스트 오버레이(.layer-1-art .mastery-fx-overlay)만 유지되어야 합니다.'
  );
  assert(
    mainJs.includes('function getCardMasteryVisualFx(cardId, ownerSeat = 0)') &&
    mainJs.includes('function spawnCardMasteryEntranceVfx(x, y, mFx') &&
    mainJs.includes('triggerUnitSummonEntrance('),
    '전투 등장/공격 VFX가 설정된 숙련도 이펙트 프리셋에 맞춰 동적으로 출력되어야 합니다.'
  );
  assert(
    html.includes('id="sel-binder-card-mastery-preset"') &&
    html.includes('id="loading-blank-screen"') &&
    mainJs.includes('populateMasteryPresetSelect(') &&
    mainJs.includes('bakePlayerAndPresetSleeves(') &&
    mainJs.includes('needsViewResourceLoad('),
    '바인더 개별/등급 이펙트 해금 제어, 슬리브 PNG 베이킹, 빈 CRT 로딩 창 전환 파이프라인이 연동되어야 합니다.'
  );

  // 슬리브 베이킹 키 생성 · 소스 생성 · 구워진 URL 우선 반환 및 헤드리스 안전 폴백 검증
  const customCfg = {
    sleevePreset: 'CUSTOM',
    customSleeve: {
      bgPattern: 'DIAMOND',
      borderStyle: 'W2K_BEVEL',
      emblem1: 'COMPASS_8',
      emblem2: 'CROWN_SEAL',
      c1: { h: 210, s: 50, l: 25 },
      c2: { h: 45, s: 80, l: 55 },
      c3: { h: 180, s: 70, l: 60 },
      c4: { h: 0, s: 75, l: 55 },
    },
  };
  const srcInfo = getSleeveBakeSource(customCfg);
  assert(srcInfo.isCustom && srcInfo.bakeKey === getSleeveBakeKey(customCfg), '커스텀 슬리브의 베이킹 키와 소스가 일치해야 합니다.');
  assert(srcInfo.svgDataUri.startsWith('data:image/svg+xml'), '커스텀 슬리브 소스는 SVG data URI여야 합니다.');
  assert((await bakeDynamicSvgAsset(srcInfo.bakeKey, srcInfo.svgDataUri)) === null, '헤드리스 환경 동적 SVG 베이킹은 예외 없이 null로 안전 폴백해야 합니다.');
  assert(resolveBakedDynamicAsset(srcInfo.bakeKey) === null, '미베이킹 상태의 동적 에셋 조회는 null이어야 합니다.');

  const unbakedSpec = resolvePlayerSleeveSpec(customCfg, { compact: true, bakedUrlResolver: () => null });
  assert(!unbakedSpec.isBaked && unbakedSpec.src.startsWith('data:image/svg+xml'), '베이킹 전에는 커스텀 SVG data URI로 즉시 미리보기가 가능해야 합니다.');
  const bakedSpec = resolvePlayerSleeveSpec(customCfg, {
    compact: true,
    bakedUrlResolver: (k, isCompact) => (k === srcInfo.bakeKey && isCompact ? 'blob:baked-custom-thumb' : null),
  });
  assert(bakedSpec.isBaked && bakedSpec.src === 'blob:baked-custom-thumb', '베이킹 완료 후에는 구워진 래스터 이미지 URL을 우선 반환해야 합니다.');

  const canvasEngine = await Deno.readTextFile('./src/canvasJuiceEngine.js');
  const alleyCss = await Deno.readTextFile('./theme-alley.css');
  assert(
    !canvasEngine.includes('ambientMotes') &&
    canvasEngine.includes('hasActiveVisuals()') &&
    canvasEngine.includes('this.wake()'),
    '전 화면 60fps 대기 입자(ambientMotes)는 제거되고 유휴 캔버스 슬립 최적화가 적용되어야 합니다.'
  );
  assert(
    !html.includes('scene-backdrop-shade') &&
    !html.includes('vector-bake-badge') &&
    !html.includes('slider-ambient-fx') &&
    !html.includes('view-transition-veil') &&
    !styleCss.includes('view-checkpoint-encounter') &&
    !styleCss.includes('backdrop-filter: blur') &&
    !alleyCss.includes('scene-backdrop-shade') &&
    !alleyCss.includes('view-transition-veil'),
    '배경 도입 이전 비네팅·전환 플래시·숨김 배지·불필요한 blur 필터 레거시가 모두 제거되어야 합니다.'
  );
  assert(
    mainJs.includes("modal.className = 'tribute-select-popover'") &&
    mainJs.includes('window.__activeTributeModalCleanup || activeFieldTargetCleanup') &&
    mainJs.includes("!e.target.closest('#player-board .unit-field-card')") &&
    /function handlePlayCard\([^)]*\) \{\s*try \{\s*closeTributeModal\(\);\s*closeFieldTargetMode\(\);/.test(mainJs),
    '제물 선택이 클래식 팝업(.tribute-select-popover)으로 열리고 필드 클릭/드래그 소환 시 즉시 닫혀야 합니다.'
  );
  assert(
    mainJs.includes('function getCardMasteryVisualFx(cardId, ownerSeat = 0)') &&
    mainJs.includes('ownerSeat === 1') &&
    mainJs.includes('function triggerUnitSummonEntrance(unitEl, mFx)') &&
    cardRenderer.includes('getMasteryVisual(def.id, cardOrDef)'),
    '소환 등장 이펙트가 카드 소유자(ownerSeat) 설정을 따르고 배열 배치 확정(rAF) 후 카드 위치에 맞춰 출력되어야 합니다.'
  );
  assert(
    canvasEngine.includes('spawnGuardBlockEffect(') &&
    canvasEngine.includes('spawnCardCrackEffect(') &&
    mainJs.includes('function triggerUnitCrackThenShatter(') &&
    mainJs.includes('function animateRollingDigits(') &&
    mainJs.includes('function applyUnitStatRolling(') &&
    styleCss.includes('slam-blocked-guard') &&
    styleCss.includes('card-cracking') &&
    styleCss.includes('lp-rolling-up') &&
    styleCss.includes('stat-rolling-down') &&
    /const revealTargetView[\s\S]*?refreshSceneBackdrop\(viewKey\);/.test(mainJs),
    '공격 실패 방어 막힘, 파괴 전 균열(금) 이펙트, 마스터 듀얼식 LP/수비력 순차 롤링 숫자 및 진입 시점 배경 교체가 연동되어야 합니다.'
  );
});
