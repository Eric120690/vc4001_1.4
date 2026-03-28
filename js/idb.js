const IDB = (() => {
  const DB_NAME = 'lexon_cache_v2', STORE = 'packs';
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = e => rej(e.target.error);
    });
  }

  // Tất cả key đều prefix bằng uid để tránh trộn cache giữa các user
  function _key(id) {
    const uid = (window._currentUser?.uid) || 'guest';
    return uid + '::' + id;
  }

  async function get(id) {
    const db = await open();
    return new Promise((res, rej) => {
      const r = db.transaction(STORE,'readonly').objectStore(STORE).get(_key(id));
      r.onsuccess = e => res(e.target.result || null);
      r.onerror   = e => rej(e.target.error);
    });
  }

  async function set(id, data) {
    const db = await open();
    const key = _key(id);
    return new Promise((res, rej) => {
      const r = db.transaction(STORE,'readwrite').objectStore(STORE)
        .put({ id: key, ...data, cachedAt: Date.now() });
      r.onsuccess = () => res(true);
      r.onerror   = e  => rej(e.target.error);
    });
  }

  async function getAllKeys() {
    const db = await open();
    const uid = (window._currentUser?.uid) || 'guest';
    const prefix = uid + '::';
    return new Promise((res, rej) => {
      const r = db.transaction(STORE,'readonly').objectStore(STORE).getAllKeys();
      r.onsuccess = e => {
        // Chỉ trả về keys của user hiện tại, bỏ prefix
        const keys = (e.target.result || [])
          .filter(k => k.startsWith(prefix))
          .map(k => k.slice(prefix.length));
        res(keys);
      };
      r.onerror = e => rej(e.target.error);
    });
  }

  return { get, set, getAllKeys };
})();
