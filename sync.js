(() => {
  const STATE_KEY = 'museumStudyState_v1';
  const OLD_TOKEN_KEY = 'jsstudy_sync_token_v1';
  let timer = null;
  let ready = false;
  let applyingRemote = false;
  let dirty = false;

  // Token-based sync is retired. Keep only the single shared DB state.
  localStorage.removeItem(OLD_TOKEN_KEY);

  async function rpc(name, body = {}) {
    const response = await fetch('/api/rpc/' + name, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(await response.text());
    return response.status === 204 ? null : response.json();
  }

  function localRaw() {
    return localStorage.getItem(STATE_KEY);
  }

  async function pushNow() {
    const raw = localRaw();
    if (!raw) return false;
    const state = JSON.parse(raw);
    await rpc('shared_put', { p_state: state });
    dirty = false;
    return true;
  }

  function queuePush() {
    if (!ready || applyingRemote) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(() => {
      pushNow().catch(err => console.warn('DB save failed; local copy kept', err));
    }, 250);
  }

  async function loadFromServer() {
    try {
      const rows = await rpc('shared_get');
      const remote = rows && rows[0] && rows[0].state;

      if (remote) {
        const remoteRaw = JSON.stringify(remote);
        const currentRaw = localRaw();
        if (currentRaw !== remoteRaw) {
          applyingRemote = true;
          localStorage.setItem(STATE_KEY, remoteRaw);
          applyingRemote = false;
          location.reload();
          return;
        }
        ready = true;
        dirty = false;
        return;
      }

      // First migration to the singleton DB: seed it from the browser that
      // already has study progress. A fresh browser with no local state does
      // not create an empty server record.
      ready = true;
      if (localRaw()) await pushNow();
    } catch (err) {
      // The site remains usable from its local cache if the DB is temporarily
      // unavailable. New changes will retry through the normal save path.
      console.warn('DB load failed; using local copy', err);
      ready = true;
    }
  }

  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    nativeSetItem.call(this, key, value);
    if (this === localStorage && key === STATE_KEY) queuePush();
  };

  window.JSStudyDB = {
    load: loadFromServer,
    push: pushNow
  };

  window.addEventListener('online', () => {
    const action = dirty ? pushNow() : loadFromServer();
    Promise.resolve(action).catch(err => console.warn('DB reconnect failed', err));
  });

  window.addEventListener('pagehide', () => {
    if (!ready || applyingRemote || !dirty) return;
    const raw = localRaw();
    if (!raw) return;
    try {
      fetch('/api/rpc/shared_put', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ p_state: JSON.parse(raw) }),
        keepalive: true
      }).catch(() => {});
    } catch (_) {}
  });

  // Every page open starts by loading the one shared DB state.
  loadFromServer();
})();
