/**
 * 런 저장·이어 하기 테스트.
 * 실행: deno test --no-check tests/test_run_save.ts
 */
// @ts-nocheck
import { DuelRogueEngine, DEFAULT_CARD_CATALOG, BINDER_CATALOG } from '../src/duelRogueEngine.js';
import { BinderCore, InMemoryBinderStorage } from '../src/binderCore.js';
import { RunSaveStore, MemoryStorage } from '../src/runSave.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`[ASSERTION FAILED] ${msg}`);
}

function newEngine() {
  const binder = new BinderCore({ catalog: BINDER_CATALOG, storage: new InMemoryBinderStorage() });
  return new DuelRogueEngine(binder, DEFAULT_CARD_CATALOG, 1234);
}

Deno.test('듀얼 도중 저장한 런을 새 엔진에서 이어 하면 같은 상태·같은 난수로 진행된다', () => {
  const a = newEngine();
  a.startNewRun('RUN_SAVE', 777);
  a.selectFortuneDestiny('RED_ZEAL', 'CHECKPOINT');
  a.startRandomEncounter();
  a.dispatchDuelCommand({ type: 'END_TURN', seat: a.state.activeDuel.activeSeat === 0 ? 0 : 1 });
  if (a.state.activeDuel.activeSeat === 1) a.executeCpuTurn();

  const store = new RunSaveStore(new MemoryStorage());
  assert(store.save(a.exportSave()), '저장 성공');

  const b = newEngine();
  b.importSave(store.load().data);
  assert(JSON.stringify(b.state.activeDuel.seats) === JSON.stringify(a.state.activeDuel.seats), '좌석 상태 동일');

  // 같은 행동을 하면 같은 결과
  for (const eng of [a, b]) {
    if (eng.state.activeDuel.activeSeat === 0) eng.dispatchDuelCommand({ type: 'END_TURN', seat: 0 });
    eng.executeCpuTurn();
  }
  assert(JSON.stringify(b.state.activeDuel.seats) === JSON.stringify(a.state.activeDuel.seats), '이어 한 뒤에도 결정론적');
});

Deno.test('저장 도중 끊긴 쓰기는 이전 저장본을 망가뜨리지 않는다', () => {
  const storage = new MemoryStorage();
  const store = new RunSaveStore(storage);
  const eng = newEngine();
  eng.startNewRun('RUN_A', 1);
  store.save(eng.exportSave());
  const first = store.load();

  // 다음 저장이 새 슬롯에 반쯤 쓰이다 끊긴 상황 (pointer는 아직 바뀌지 않음)
  const nextSlot = storage.getItem('duel_rogue_run_pointer') === 'b' ? 'a' : 'b';
  storage.setItem(`duel_rogue_run_slot_${nextSlot}`, '{"version":1,"data":{"sta');
  const after = store.load();
  assert(after && after.savedAt === first.savedAt, '이전 저장본 유지');

  // pointer가 깨진 슬롯을 가리켜도 다른 슬롯에서 복구
  storage.setItem('duel_rogue_run_pointer', nextSlot);
  assert(store.load()?.savedAt === first.savedAt, '깨진 슬롯을 건너뛰고 복구');

  store.clear();
  assert(!store.hasSave(), '삭제');
});
