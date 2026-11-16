/* Fragments v6.0 — cloud sync for localStorage data */
(() => {
  const TABLE = 'site_sync';
  const META_KEY = 'site:cloudSyncMeta:v1';
  const IGNORE = new Set([META_KEY]);
  let client = null, user = null, syncing = false;
  const pushTimers = new Map();

  const state = () => {
    try { return JSON.parse(localStorage.getItem(META_KEY) || '{}'); } catch { return {}; }
  };
  const saveState = (v) => localStorage.setItem(META_KEY, JSON.stringify(v));
  const now = () => new Date().toISOString();

  function configured() {
    const k = window.FRAGMENTS_SUPABASE_ANON_KEY || '';
    return window.FRAGMENTS_SUPABASE_URL && k && !k.includes('PASTE_YOUR');
  }

  function setStatus(text, kind='') {
    const el = document.getElementById('cloudSyncStatus');
    if (el) { el.textContent = text; el.dataset.kind = kind; }
  }

  function trackedKeys() {
    return Object.keys(localStorage).filter(k => k.startsWith('site:') && !IGNORE.has(k));
  }

  async function pushKey(key) {
    // `syncing` blocks write hooks from echoing remote changes, but must not
    // block an explicit initial migration/upload.
    if (!client || !user || IGNORE.has(key)) return;
    const raw = localStorage.getItem(key);
    if (raw === null) return;
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    const { error } = await client.from(TABLE).upsert({
      user_id: user.id, key, data, updated_at: now()
    }, { onConflict: 'user_id,key' });
    if (error) throw error;
    const s = state(); s[key] = Date.now(); saveState(s);
  }

  async function pushAll() {
    for (const key of trackedKeys()) await pushKey(key);
  }

  async function pullOrMigrate() {
    setStatus('Syncing…');
    const { data: rows, error } = await client.from(TABLE)
      .select('key,data,updated_at').eq('user_id', user.id);
    if (error) throw error;

    syncing = true;
    try {
      if (!rows || rows.length === 0) {
        // First migration: this device is intentionally treated as the source.
        await pushAll();
        setStatus('Cloud backup created ✓', 'ok');
      } else {
        for (const row of rows) {
          localStorage.setItem(row.key, JSON.stringify(row.data));
        }
        const s = state();
        rows.forEach(r => { s[r.key] = Date.parse(r.updated_at || '') || Date.now(); });
        saveState(s);
        setStatus('Synced ✓', 'ok');
      }
    } finally {
      syncing = false;
    }
  }

  // Called explicitly by Store.set() after a successful local write.
  // This avoids relying on monkey-patching the browser's Storage object,
  // which is not a dependable interception point across mobile browsers.
  function queuePush(key) {
    if (syncing || !user || !client || !key?.startsWith('site:') || IGNORE.has(key)) return;
    setStatus('Saving…');
    const oldTimer = pushTimers.get(key);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(async () => {
      pushTimers.delete(key);
      try {
        await pushKey(key);
        setStatus('Synced ✓', 'ok');
      } catch (e) {
        console.error('Cloud sync failed for ' + key, e);
        setStatus('Sync failed — retry later', 'warn');
      }
    }, 350);
    pushTimers.set(key, timer);
  }

  async function login(email, password, mode='login') {
    if (!configured()) throw new Error('Supabase API key has not been added to cloud-config.js yet.');
    const fn = mode === 'signup' ? client.auth.signUp.bind(client.auth) : client.auth.signInWithPassword.bind(client.auth);
    const { data, error } = await fn({ email, password });
    if (error) throw error;
    if (!data.session && mode === 'signup') throw new Error('Check your email to confirm the new account, then log in.');
    await startSession();
  }

  async function logout() {
    if (client) await client.auth.signOut();
    user = null;
    setStatus('Local mode');
    renderCloudUI();
  }

  async function startSession() {
    const { data } = await client.auth.getUser();
    user = data.user || null;
    renderCloudUI();
    if (user) {
      await pullOrMigrate();
      client.channel('site-sync-' + user.id)
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: 'user_id=eq.' + user.id }, payload => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const r = payload.new;
            if (r?.key && r.key !== META_KEY) {
              syncing = true;
              try { localStorage.setItem(r.key, JSON.stringify(r.data)); } finally { syncing = false; }
              setStatus('Updated from another device ✓', 'ok');
              // Existing page modules are local-state based; refresh to redraw safely.
              setTimeout(() => location.reload(), 700);
            }
          }
        }).subscribe();
    }
  }

  function renderCloudUI() {
    const old = document.getElementById('cloudSyncPanel');
    if (old) old.remove();
    const panel = document.createElement('div');
    panel.id = 'cloudSyncPanel';
    panel.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99999;font:12px Inter,system-ui,sans-serif;background:rgba(20,20,20,.88);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:10px 12px;backdrop-filter:blur(10px);max-width:min(320px,calc(100vw - 28px))';
    if (user) {
      panel.innerHTML = `<div style="display:flex;gap:8px;align-items:center"><span id="cloudSyncStatus">Checking…</span><button id="cloudLogout" style="margin-left:auto;background:none;border:0;color:#ddd;cursor:pointer">Sign out</button></div><div style="opacity:.6;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">☁ ${user.email || 'Cloud account'}</div>`;
      document.body.appendChild(panel);
      panel.querySelector('#cloudLogout').onclick = logout;
    } else {
      panel.innerHTML = `<div style="font-weight:600;margin-bottom:7px">☁ Fragments Cloud</div><div id="cloudSyncStatus" style="opacity:.75;margin-bottom:7px">Local mode</div><button id="cloudOpenLogin" style="border:0;border-radius:7px;padding:6px 9px;cursor:pointer">Connect & Sync</button>`;
      document.body.appendChild(panel);
      panel.querySelector('#cloudOpenLogin').onclick = openLogin;
    }
  }

  function openLogin() {
    const d = document.createElement('dialog');
    d.style.cssText='border:1px solid #ddd;border-radius:14px;padding:20px;max-width:360px;width:calc(100vw - 40px)';
    d.innerHTML = `<form method="dialog"><h3 style="margin-top:0">Connect Fragments Cloud</h3><p style="font-size:13px;color:#666">Sign in with the same account on your computer and phone.</p><input id="cloudEmail" type="email" placeholder="Email" required style="width:100%;box-sizing:border-box;padding:10px;margin:5px 0"><input id="cloudPassword" type="password" placeholder="Password" required minlength="6" style="width:100%;box-sizing:border-box;padding:10px;margin:5px 0"><div id="cloudLoginMsg" style="font-size:12px;color:#b33;min-height:18px"></div><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button value="cancel">Cancel</button><button type="button" id="cloudSignup">Create account</button><button type="button" id="cloudLogin">Sign in</button></div></form>`;
    document.body.appendChild(d); d.showModal();
    const run = async (mode) => {
      const msg = d.querySelector('#cloudLoginMsg'); msg.textContent='Working…';
      try { await login(d.querySelector('#cloudEmail').value.trim(), d.querySelector('#cloudPassword').value, mode); d.close(); d.remove(); }
      catch(e) { msg.textContent = e.message || String(e); }
    };
    d.querySelector('#cloudLogin').onclick = () => run('login');
    d.querySelector('#cloudSignup').onclick = () => run('signup');
  }

  async function boot() {
    if (!configured() || !window.supabase?.createClient) { renderCloudUI(); return; }
    client = window.supabase.createClient(window.FRAGMENTS_SUPABASE_URL, window.FRAGMENTS_SUPABASE_ANON_KEY);
    await startSession();
    client.auth.onAuthStateChange((_event, session) => { user = session?.user || null; renderCloudUI(); });
  }

  window.FragmentsCloud = { boot, pushAll, queuePush, login, logout };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true }); else boot();
})();
