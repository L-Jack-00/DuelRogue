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
