/**
 * 런 진행 저장소.
 *
 * 불변식: 저장 도중 창이 닫혀도 직전의 정상 저장본은 항상 남는다.
 * 방법: 슬롯 A/B를 번갈아 쓴다. 새 저장본을 '현재 가리키지 않는 슬롯'에 먼저 다 쓰고,
 *       그 다음에 가리키는 슬롯 번호(pointer)를 바꾼다. 쓰기가 중간에 끊기면 pointer는
 *       여전히 이전 슬롯을 가리키므로 이전 저장본으로 이어 할 수 있다.
 *
 * storage는 getItem/setItem/removeItem을 가진 객체 (브라우저 localStorage 또는 테스트용 메모리 저장소).
 */
const SAVE_VERSION = 1;

export class RunSaveStore {
  constructor(storage, prefix = 'duel_rogue_run') {
    this.storage = storage;
    this.keys = { a: `${prefix}_slot_a`, b: `${prefix}_slot_b`, pointer: `${prefix}_pointer` };
  }

  safeGet(key) {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  /** @param {object} data engine.exportSave() 결과 */
  save(data) {
    try {
      const current = this.safeGet(this.keys.pointer) === 'b' ? 'b' : 'a';
      const next = current === 'a' ? 'b' : 'a';
      const payload = JSON.stringify({ version: SAVE_VERSION, savedAt: Date.now(), data });
      this.storage.setItem(this.keys[next], payload);
      this.storage.setItem(this.keys.pointer, next);
      return true;
    } catch {
      return false;
    }
  }

  /** 가장 최근의 정상 저장본. 없거나 깨졌으면 다른 슬롯, 그것도 없으면 null */
  load() {
    const pointer = this.safeGet(this.keys.pointer) === 'b' ? 'b' : 'a';
    for (const slot of [pointer, pointer === 'a' ? 'b' : 'a']) {
      const raw = this.safeGet(this.keys[slot]);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version === SAVE_VERSION && parsed.data?.state) return parsed;
      } catch {
        /* 깨진 슬롯은 건너뛴다 */
      }
    }
    return null;
  }

  hasSave() {
    return this.load() !== null;
  }

  clear() {
    for (const key of Object.values(this.keys)) {
      try {
        this.storage.removeItem(key);
      } catch {
        /* 저장소 접근 불가 시 무시 */
      }
    }
  }
}

/** 테스트·헤드리스용 메모리 저장소 */
export class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}
