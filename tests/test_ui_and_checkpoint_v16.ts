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
} from '../src/ui/masterySystem.js';
import {
  VECTOR_BAKE_SPECS,
  normalizeVectorAssetKey,
  injectSvgPixelDimensions,
  resolveBakedAsset,
  bakeAllVectorAssets,
} from '../src/ui/vectorBaker.js';
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

Deno.test('숙련도 비주얼 커스텀: 전역 티어 기본값 + 카드별 개별 오버라이드 영속성', () => {
  const mem = new Map<string, string>();
  const fakeStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
  };

  const cfg = loadMasteryFxConfig(fakeStorage);
  cfg.tierDefaults.ADEPT.preset = 'ARCANE_SPARK';
  cfg.cardOverrides['C_BLUE_01'] = { preset: 'GOLDEN_CROWN', glow: 1.5, foil: 1.4, tint: '#fbbf24' };
  saveMasteryFxConfig(cfg, fakeStorage);

  const reloaded = loadMasteryFxConfig(fakeStorage);
  const normalAdept = resolveCardMasteryVisual('C_RED_01', 60, 2, reloaded);
  assert(normalAdept.tier === 'ADEPT', '60pt는 ADEPT 티어여야 합니다.');
  assert(normalAdept.preset === 'ARCANE_SPARK' && !normalAdept.isOverridden, '전역 티어 커스텀이 적용되어야 합니다.');

  const overridden = resolveCardMasteryVisual('C_BLUE_01', 10, 2, reloaded);
  assert(overridden.preset === 'GOLDEN_CROWN' && overridden.isOverridden, '카드별 개별 오버라이드가 전역 설정보다 우선해야 합니다.');
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
