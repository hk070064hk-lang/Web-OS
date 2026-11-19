/**
 * WebOS Core — Mobile & Desktop Ready Pure Vanilla JS Desktop Environment
 */
(() => {
  'use strict';

  const isMobile = () => window.innerWidth <= 768;

  /* =========================================================
   * 1. 定数・プリセット定義
   * ========================================================= */
  const WALLPAPERS = [
    { id: 'nebula', name: 'Deep Nebula', css: 'radial-gradient(circle at 20% 20%, #1e3a8a 0%, #0f172a 55%, #020617 100%)' },
    { id: 'aurora', name: 'Aurora', css: 'linear-gradient(135deg, #064e3b 0%, #0f172a 50%, #312e81 100%)' },
    { id: 'sunset', name: 'Cyber Sunset', css: 'linear-gradient(135deg, #7c2d12 0%, #4c1d95 55%, #090d16 100%)' },
    { id: 'slate',  name: 'Minimal Dark', css: 'linear-gradient(180deg, #1e293b 0%, #090d16 100%)' }
  ];

  const APPS = {
    browser: {
      id: 'browser',
      title: 'Webブラウザ',
      icon: 'globe',
      color: 'linear-gradient(135deg, #38bdf8, #2563eb)',
      width: 780,
      height: 520
    },
    notes: {
      id: 'notes',
      title: 'メモ帳',
      icon: 'file-text',
      color: 'linear-gradient(135deg, #f59e0b, #d97706)',
      width: 560,
      height: 400
    },
    terminal: {
      id: 'terminal',
      title: 'ターミナル',
      icon: 'terminal',
      color: 'linear-gradient(135deg, #10b981, #059669)',
      width: 520,
      height: 340
    },
    calculator: {
      id: 'calculator',
      title: '電卓',
      icon: 'calculator',
      color: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
      width: 300,
      height: 410
    },
    settings: {
      id: 'settings',
      title: '設定',
      icon: 'settings',
      color: 'linear-gradient(135deg, #64748b, #334155)',
      width: 520,
      height: 460
    }
  };

  /* =========================================================
   * 2. ストレージ・永続化層
   * ========================================================= */
  const Storage = {
    getGlobal(key, fallback = null) {
      try {
        const raw = localStorage.getItem(`webos_global_${key}`);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    setGlobal(key, val) {
      localStorage.setItem(`webos_global_${key}`, JSON.stringify(val));
    },
    userPrefix() {
      const uid = State.user?.id || 'guest';
      return `webos_u_${uid}_`;
    },
    getUserData(key, fallback) {
      try {
        const raw = localStorage.getItem(this.userPrefix() + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    setUserData(key, val) {
      localStorage.setItem(this.userPrefix() + key, JSON.stringify(val));
      this.syncToIndexedDB(key, val);
    },
    openDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('WebOS_DB', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async syncToIndexedDB(key, val) {
      try {
        const db = await this.openDB();
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, this.userPrefix() + key);
      } catch {}
    },
    exportAllUserData() {
      return {
        exportedAt: new Date().toISOString(),
        user: State.user,
        wallpaper: this.getUserData('wallpaper', WALLPAPERS[0].css),
        icons: this.getUserData('icons', null),
        notes: this.getUserData('notes', [])
      };
    },
    importAllUserData(jsonObj) {
      if (!jsonObj || typeof jsonObj !== 'object') throw new Error('無効なJSONです');
      if (jsonObj.wallpaper) this.setUserData('wallpaper', jsonObj.wallpaper);
      if (jsonObj.icons) this.setUserData('icons', jsonObj.icons);
      if (Array.isArray(jsonObj.notes)) this.setUserData('notes', jsonObj.notes);
    }
  };

  /* =========================================================
   * 3. アプリケーション状態
   * ========================================================= */
  const State = {
    user: null,
    windows: [],
    zCounter: 100,
    activeWinId: null
  };

  /* =========================================================
   * 4. GitHub OAuth 認証フロー
   * ========================================================= */
  const Auth = {
    async init() {
      const cfg = Storage.getGlobal('oauth_cfg', { clientId: '', workerUrl: '', proxyPass: '' });
      document.getElementById('cfg-client-id').value = cfg.clientId || '';
      document.getElementById('cfg-worker-url').value = cfg.workerUrl || '';
      document.getElementById('cfg-proxy-pass').value = cfg.proxyPass || '';

      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');

      if (code && state) {
        await this.handleOAuthCallback(code, state, cfg);
        return;
      }

      const savedSession = Storage.getGlobal('session', null);
      if (savedSession) {
        State.user = savedSession;
        Desktop.boot();
      }
    },

    async startGitHubLogin() {
      const cfg = Storage.getGlobal('oauth_cfg', {});
      if (!cfg.clientId || !cfg.workerUrl) {
        alert('先に「GitHub OAuth ＆ プロキシ設定」を開いて Client ID と Worker URL を保存してください。');
        return;
      }

      const verifier = this.randomString(64);
      const challenge = await this.sha256Base64Url(verifier);
      const state = this.randomString(24);

      sessionStorage.setItem('gh_pkce_verifier', verifier);
      sessionStorage.setItem('gh_oauth_state', state);

      const redirectUri = window.location.origin + window.location.pathname;
      const authUrl = new URL('https://github.com/login/oauth/authorize');
      authUrl.searchParams.set('client_id', cfg.clientId);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('scope', 'read:user');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');

      window.location.href = authUrl.toString();
    },

    async handleOAuthCallback(code, state, cfg) {
      const savedState = sessionStorage.getItem('gh_oauth_state');
      const verifier = sessionStorage.getItem('gh_pkce_verifier');
      window.history.replaceState({}, document.title, window.location.pathname);

      if (!savedState || state !== savedState) {
        alert('OAuth state検証エラーが発生しました。');
        return;
      }

      try {
        const res = await fetch(`${cfg.workerUrl.replace(/\/$/, '')}/api/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: cfg.clientId,
            code,
            code_verifier: verifier,
            redirect_uri: window.location.origin + window.location.pathname
          })
        });
        const data = await res.json();
        if (!res.ok || !data.access_token) throw new Error(data.error || 'トークン取得失敗');

        const userRes = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${data.access_token}`,
            Accept: 'application/vnd.github+json'
          }
        });
        const ghUser = await userRes.json();

        State.user = {
          id: String(ghUser.id),
          login: ghUser.login,
          name: ghUser.name || ghUser.login,
          avatar_url: ghUser.avatar_url,
          token: data.access_token
        };
        Storage.setGlobal('session', State.user);
        Desktop.boot();
      } catch (err) {
        alert('GitHubログインに失敗しました: ' + err.message);
      }
    },

    loginAsGuest() {
      State.user = {
        id: 'guest',
        login: 'guest',
        name: 'Guest User',
        avatar_url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2338bdf8"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/></svg>',
        token: ''
      };
      Storage.setGlobal('session', State.user);
      Desktop.boot();
    },

    logout() {
      Storage.setGlobal('session', null);
      State.user = null;
      location.reload();
    },

    randomString(len) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
      const arr = new Uint8Array(len);
      crypto.getRandomValues(arr);
      return Array.from(arr, b => chars[b % chars.length]).join('');
    },

    async sha256Base64Url(str) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
  };

  /* =========================================================
   * 5. デスクトップ・アイコン配置・タスクバー
   * ========================================================= */
  const Desktop = {
    boot() {
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('desktop').classList.remove('hidden');

      document.getElementById('user-avatar').src = State.user.avatar_url;
      document.getElementById('user-name').textContent = State.user.name;
      document.getElementById('user-handle').textContent = `@${State.user.login}`;

      this.updateProxyBadge();
      this.applyWallpaper();
      this.renderIcons();
      this.renderStartMenu();
      this.startClock();
      lucide.createIcons();

      const notes = Storage.getUserData('notes', null);
      if (!notes) {
        Storage.setUserData('notes', [{
          id: Date.now(),
          title: 'WebOS へようこそ！',
          content: '・スマホはタップ、PCはダブルクリックでアプリ起動\n・ブラウザはキーワード検索（Wikipedia/DuckDuckGo）とプロキシに対応\n・設定アプリからCloudflare Worker URLとパスコードを登録できます'
        }]);
      }
    },

    updateProxyBadge() {
      const cfg = Storage.getGlobal('oauth_cfg', {});
      const badge = document.getElementById('proxy-status-badge');
      if (cfg.workerUrl) {
        badge.textContent = 'Proxy Ready';
        badge.classList.add('online');
      } else {
        badge.textContent = 'Local';
        badge.classList.remove('online');
      }
    },

    applyWallpaper() {
      const wp = Storage.getUserData('wallpaper', WALLPAPERS[0].css);
      document.getElementById('desktop').style.background = wp;
    },

    getDefaultIconPositions() {
      const list = Object.values(APPS);
      const pos = {};
      const cols = isMobile() ? 3 : 1;
      list.forEach((app, idx) => {
        if (isMobile()) {
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          pos[app.id] = { x: 16 + col * 96, y: 18 + row * 98 };
        } else {
          pos[app.id] = { x: 18, y: 18 + idx * 96 };
        }
      });
      return pos;
    },

    renderIcons() {
      const container = document.getElementById('desktop-icons');
      container.innerHTML = '';
      const positions = Storage.getUserData('icons', this.getDefaultIconPositions());

      Object.values(APPS).forEach(app => {
        const p = positions[app.id] || { x: 20, y: 20 };
        const el = document.createElement('div');
        el.className = 'desktop-icon';
        el.style.left = `${p.x}px`;
        el.style.top = `${p.y}px`;
        el.innerHTML = `
          <div class="icon-badge" style="background:${app.color}">
            <i data-lucide="${app.icon}"></i>
          </div>
          <div class="icon-label">${app.title}</div>
        `;

        let dragging = false, moved = false, startX, startY, origX, origY;

        el.addEventListener('pointerdown', (e) => {
          if (e.button !== 0 && e.pointerType === 'mouse') return;
          dragging = true;
          moved = false;
          startX = e.clientX;
          startY = e.clientY;
          origX = p.x;
          origY = p.y;
        });

        window.addEventListener('pointermove', (e) => {
          if (!dragging) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          if (Math.hypot(dx, dy) > 8) moved = true;
          if (!moved) return;
          p.x = Math.max(0, Math.min(window.innerWidth - 82, origX + dx));
          p.y = Math.max(0, Math.min(window.innerHeight - 130, origY + dy));
          el.style.left = `${p.x}px`;
          el.style.top = `${p.y}px`;
        });

        window.addEventListener('pointerup', (e) => {
          if (!dragging) return;
          dragging = false;
          if (moved) {
            positions[app.id] = { x: p.x, y: p.y };
            Storage.setUserData('icons', positions);
          } else if (e.pointerType === 'touch' || e.pointerType === 'pen') {
            WindowManager.open(app.id);
          }
        });

        el.addEventListener('click', (e) => {
          if (moved) { moved = false; return; }
          e.stopPropagation();
          document.querySelectorAll('.desktop-icon').forEach(i => i.classList.remove('selected'));
          el.classList.add('selected');
        });

        el.addEventListener('dblclick', () => WindowManager.open(app.id));
        container.appendChild(el);
      });
      lucide.createIcons();
    },

    renderStartMenu() {
      const list = document.getElementById('start-app-list');
      list.innerHTML = '';
      Object.values(APPS).forEach(app => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'start-app-btn';
        btn.innerHTML = `<i data-lucide="${app.icon}"></i><span>${app.title}</span>`;
        btn.onclick = () => {
          WindowManager.open(app.id);
          document.getElementById('start-menu').classList.add('hidden');
        };
        list.appendChild(btn);
      });
    },

    startClock() {
      const update = () => {
        const now = new Date();
        document.getElementById('clock-time').textContent =
          now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        document.getElementById('clock-date').textContent =
          now.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
      };
      update();
      setInterval(update, 1000);
    }
  };

  /* =========================================================
   * 6. ウィンドウ管理システム（スマホ自動最大化・ボタンクリック安定化）
   * ========================================================= */
  const WindowManager = {
    open(appId, options = {}) {
      const app = APPS[appId];
      if (!app) return;

      const winId = `win_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const offset = (State.windows.length % 5) * 24;
      const mobile = isMobile();

      const winObj = {
        id: winId,
        appId,
        title: options.title || app.title,
        icon: app.icon,
        x: mobile ? 0 : 70 + offset,
        y: mobile ? 0 : 35 + offset,
        w: mobile ? window.innerWidth : Math.min(app.width, window.innerWidth - 30),
        h: mobile ? window.innerHeight - 48 : Math.min(app.height, window.innerHeight - 80),
        minimized: false,
        maximized: mobile
      };

      State.windows.push(winObj);
      this.createWindowElement(winObj, options);
      this.focus(winId);
      this.renderTaskbar();
      return winId;
    },

    createWindowElement(winObj, options) {
      const container = document.getElementById('window-container');
      const el = document.createElement('div');
      el.className = 'os-window' + (winObj.maximized ? ' maximized' : '');
      el.id = winObj.id;
      el.style.left = `${winObj.x}px`;
      el.style.top = `${winObj.y}px`;
      el.style.width = `${winObj.w}px`;
      el.style.height = `${winObj.h}px`;

      el.innerHTML = `
        <div class="win-titlebar">
          <div class="win-title-left">
            <i data-lucide="${winObj.icon}"></i>
            <span class="win-title-text">${winObj.title}</span>
          </div>
          <div class="win-controls">
            <button type="button" class="win-btn min" title="最小化"><i data-lucide="minus"></i></button>
            <button type="button" class="win-btn max" title="最大化"><i data-lucide="square"></i></button>
            <button type="button" class="win-btn close" title="閉じる"><i data-lucide="x"></i></button>
          </div>
        </div>
        <div class="win-body"></div>
        <div class="resizer n" data-dir="n"></div>
        <div class="resizer s" data-dir="s"></div>
        <div class="resizer e" data-dir="e"></div>
        <div class="resizer w" data-dir="w"></div>
        <div class="resizer nw" data-dir="nw"></div>
        <div class="resizer ne" data-dir="ne"></div>
        <div class="resizer sw" data-dir="sw"></div>
        <div class="resizer se" data-dir="se"></div>
      `;

      el.addEventListener('pointerdown', () => {
        if (State.activeWinId !== winObj.id) {
          this.focus(winObj.id, false);
        }
      });

      const minBtn = el.querySelector('.win-btn.min');
      const maxBtn = el.querySelector('.win-btn.max');
      const closeBtn = el.querySelector('.win-btn.close');

      [minBtn, maxBtn, closeBtn].forEach(btn => {
        btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      });

      minBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.minimize(winObj.id);
      });
      maxBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMaximize(winObj.id);
      });
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close(winObj.id);
      });

      const titlebar = el.querySelector('.win-titlebar');
      titlebar.addEventListener('dblclick', () => this.toggleMaximize(winObj.id));

      this.bindDrag(el, titlebar, winObj);
      this.bindResize(el, winObj);

      const body = el.querySelector('.win-body');
      AppRenderers[winObj.appId](body, winObj, options);

      container.appendChild(el);
      lucide.createIcons();
    },

    bindDrag(el, handle, winObj) {
      let dragging = false, sx, sy, ox, oy;
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.win-btn') || winObj.maximized) return;
        dragging = true;
        sx = e.clientX;
        sy = e.clientY;
        ox = winObj.x;
        oy = winObj.y;
      });
      window.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        winObj.x = ox + (e.clientX - sx);
        winObj.y = Math.max(0, oy + (e.clientY - sy));
        el.style.left = `${winObj.x}px`;
        el.style.top = `${winObj.y}px`;
      });
      window.addEventListener('pointerup', () => {
        dragging = false;
      });
    },

    bindResize(el, winObj) {
      el.querySelectorAll('.resizer').forEach(r => {
        r.addEventListener('pointerdown', (e) => {
          if (winObj.maximized) return;
          e.stopPropagation();
          const dir = r.dataset.dir;
          const sx = e.clientX, sy = e.clientY;
          const { x: ox, y: oy, w: ow, h: oh } = winObj;

          const onMove = (ev) => {
            const dx = ev.clientX - sx;
            const dy = ev.clientY - sy;
            if (dir.includes('e')) winObj.w = Math.max(260, ow + dx);
            if (dir.includes('s')) winObj.h = Math.max(200, oh + dy);
            if (dir.includes('w')) {
              const nw = Math.max(260, ow - dx);
              winObj.x = ox + (ow - nw);
              winObj.w = nw;
            }
            if (dir.includes('n')) {
              const nh = Math.max(200, oh - dy);
              winObj.y = Math.max(0, oy + (oh - nh));
              winObj.h = nh;
            }
            el.style.left = `${winObj.x}px`;
            el.style.top = `${winObj.y}px`;
            el.style.width = `${winObj.w}px`;
            el.style.height = `${winObj.h}px`;
          };

          const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
          };
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
      });
    },

    focus(winId, rebuildTaskbar = true) {
      State.activeWinId = winId;
      State.zCounter += 1;
      State.windows.forEach(w => {
        const el = document.getElementById(w.id);
        if (!el) return;
        if (w.id === winId) {
          w.minimized = false;
          el.classList.remove('minimized');
          el.classList.add('active');
          el.style.zIndex = State.zCounter;
        } else {
          el.classList.remove('active');
        }
      });

      document.querySelectorAll('#taskbar-windows .task-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.winId === winId);
      });

      if (rebuildTaskbar) {
        this.renderTaskbar();
      }
    },

    minimize(winId) {
      const w = State.windows.find(x => x.id === winId);
      if (!w) return;
      w.minimized = true;
      document.getElementById(winId)?.classList.add('minimized');
      if (State.activeWinId === winId) State.activeWinId = null;
      this.renderTaskbar();
    },

    toggleMaximize(winId) {
      const w = State.windows.find(x => x.id === winId);
      if (!w) return;
      w.maximized = !w.maximized;
      document.getElementById(winId)?.classList.toggle('maximized', w.maximized);
    },

    close(winId) {
      State.windows = State.windows.filter(x => x.id !== winId);
      document.getElementById(winId)?.remove();
      if (State.activeWinId === winId) State.activeWinId = null;
      this.renderTaskbar();
    },

    renderTaskbar() {
      const bar = document.getElementById('taskbar-windows');
      bar.innerHTML = '';
      State.windows.forEach(w => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.winId = w.id;
        btn.className = 'task-item' + (w.id === State.activeWinId && !w.minimized ? ' active' : '');
        btn.innerHTML = `<i data-lucide="${w.icon}"></i><span>${w.title}</span>`;
        btn.addEventListener('click', () => {
          if (w.id === State.activeWinId && !w.minimized) {
            this.minimize(w.id);
          } else {
            this.focus(w.id);
          }
        });
        bar.appendChild(btn);
      });
      lucide.createIcons();
    }
  };

  /* =========================================================
   * 7. 標準搭載アプリ実装
   * ========================================================= */
  const AppRenderers = {
    /* ---------- メモ帳 ---------- */
    notes(container, winObj, options = {}) {
      let notes = Storage.getUserData('notes', []);
      if (options.createNew) {
        const newNote = { id: Date.now(), title: '新規メモ', content: '' };
        notes.unshift(newNote);
        Storage.setUserData('notes', notes);
      }
      let currentId = notes[0]?.id || null;

      container.innerHTML = `
        <div class="notes-app">
          <div class="notes-sidebar">
            <div class="notes-toolbar">
              <button type="button" class="btn btn-small" id="n-add">+ 新規</button>
              <button type="button" class="btn btn-small" id="n-del" style="background:#ef4444;color:#fff;">削除</button>
            </div>
            <div class="notes-list" id="n-list"></div>
          </div>
          <div class="notes-editor">
            <input type="text" class="note-title-input" id="n-title" placeholder="タイトル">
            <textarea class="note-textarea" id="n-body" placeholder="ここにメモを入力..."></textarea>
          </div>
        </div>
      `;

      const listEl = container.querySelector('#n-list');
      const titleEl = container.querySelector('#n-title');
      const bodyEl = container.querySelector('#n-body');

      const renderList = () => {
        listEl.innerHTML = '';
        notes.forEach(n => {
          const item = document.createElement('div');
          item.className = 'note-item' + (n.id === currentId ? ' active' : '');
          item.textContent = n.title || '(無題)';
          item.onclick = () => {
            currentId = n.id;
            loadCurrent();
            renderList();
          };
          listEl.appendChild(item);
        });
      };

      const loadCurrent = () => {
        const cur = notes.find(n => n.id === currentId);
        titleEl.value = cur ? cur.title : '';
        bodyEl.value = cur ? cur.content : '';
        titleEl.disabled = !cur;
        bodyEl.disabled = !cur;
      };

      const save = () => {
        const cur = notes.find(n => n.id === currentId);
        if (!cur) return;
        cur.title = titleEl.value;
        cur.content = bodyEl.value;
        Storage.setUserData('notes', notes);
        renderList();
      };

      titleEl.addEventListener('input', save);
      bodyEl.addEventListener('input', save);

      container.querySelector('#n-add').onclick = () => {
        const n = { id: Date.now(), title: '新規メモ', content: '' };
        notes.unshift(n);
        currentId = n.id;
        Storage.setUserData('notes', notes);
        renderList();
        loadCurrent();
      };

      container.querySelector('#n-del').onclick = () => {
        if (!currentId) return;
        notes = notes.filter(n => n.id !== currentId);
        currentId = notes[0]?.id || null;
        Storage.setUserData('notes', notes);
        renderList();
        loadCurrent();
      };

      renderList();
      loadCurrent();
    },

    /* ---------- 電卓 ---------- */
    calculator(container) {
      let expr = '0';
      const buttons = ['C','(',')','/','7','8','9','*','4','5','6','-','1','2','3','+','0','.','←','='];

      container.innerHTML = `
        <div class="calc-app">
          <div class="calc-display" id="c-disp">0</div>
          <div class="calc-grid"></div>
        </div>
      `;

      const disp = container.querySelector('#c-disp');
      const grid = container.querySelector('.calc-grid');

      buttons.forEach(b => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'calc-btn' + (['/', '*', '-', '+', 'C', '←'].includes(b) ? ' op' : '') + (b === '=' ? ' eq' : '');
        btn.textContent = b;
        btn.onclick = () => {
          if (b === 'C') expr = '0';
          else if (b === '←') expr = expr.length > 1 ? expr.slice(0, -1) : '0';
          else if (b === '=') {
            try {
              if (!/^[0-9+\-*/().\s]+$/.test(expr)) throw new Error();
              const res = Function(`"use strict"; return (${expr})`)();
              expr = String(Number.isFinite(res) ? +res.toFixed(10) : 'Error');
            } catch { expr = 'Error'; }
          } else {
            expr = (expr === '0' || expr === 'Error') ? b : expr + b;
          }
          disp.textContent = expr;
        };
        grid.appendChild(btn);
      });
    },

    /* ---------- 簡易ターミナル ---------- */
    terminal(container) {
      container.innerHTML = `
        <div class="term-app">
          <div class="term-output" id="t-out">WebOS Shell v1.2 — "help" でコマンド一覧を表示\n</div>
          <div class="term-input-line">
            <span class="term-prompt">${State.user.login}@webos:~$</span>
            <input type="text" class="term-input" id="t-in" autocomplete="off">
          </div>
        </div>
      `;

      const out = container.querySelector('#t-out');
      const input = container.querySelector('#t-in');
      const print = (txt) => { out.textContent += txt + '\n'; out.scrollTop = out.scrollHeight; };

      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const raw = input.value.trim();
        input.value = '';
        print(`${State.user.login}@webos:~$ ${raw}`);
        if (!raw) return;

        const [cmd, ...args] = raw.split(/\s+/);
        switch (cmd.toLowerCase()) {
          case 'help':
            print('コマンド:\n  help              - ヘルプ表示\n  apps              - アプリ一覧\n  open <app>        - アプリ起動 (notes, browser, calculator, settings)\n  search <keyword>  - ブラウザ検索\n  whoami            - ユーザー情報\n  clear             - 画面クリア');
            break;
          case 'apps':
            print('notes, browser, terminal, calculator, settings');
            break;
          case 'open':
            if (APPS[args[0]]) {
              WindowManager.open(args[0]);
              print(`Launching ${args[0]}...`);
            } else {
              print(`Error: "${args[0] || ''}" が見つかりません`);
            }
            break;
          case 'search':
            if (args.length) {
              WindowManager.open('browser', { initialQuery: args.join(' ') });
              print(`Searching "${args.join(' ')}"...`);
            } else print('Usage: search <keyword>');
            break;
          case 'whoami':
            print(`${State.user.name} (@${State.user.login})`);
            break;
          case 'clear':
            out.textContent = '';
            break;
          default:
            print(`command not found: ${cmd}`);
        }
      });
    },

    /* ---------- 設定 ---------- */
    settings(container) {
      const currentWp = Storage.getUserData('wallpaper', WALLPAPERS[0].css);
      const oauthCfg = Storage.getGlobal('oauth_cfg', { clientId: '', workerUrl: '', proxyPass: '' });

      container.innerHTML = `
        <div class="settings-app">
          <div class="settings-section">
            <h3>壁紙設定</h3>
            <div class="wallpaper-grid" id="s-wp-grid"></div>
          </div>

          <div class="settings-section">
            <h3>GitHub OAuth ＆ プロキシWorker設定</h3>
            <p>ログイン中: <strong>${State.user.name}</strong> (@${State.user.login})</p>
            <div class="settings-row">
              <input type="text" class="settings-input" id="s-client-id" placeholder="GitHub Client ID (任意)" value="${oauthCfg.clientId || ''}">
              <input type="url" class="settings-input" id="s-worker-url" placeholder="Cloudflare Worker URL (例: https://xxx.workers.dev)" value="${oauthCfg.workerUrl || ''}">
              <input type="password" class="settings-input" id="s-proxy-pass" placeholder="プロキシ専用パスコード (ゲスト利用時)" value="${oauthCfg.proxyPass || ''}">
              <button type="button" class="btn btn-small" id="s-save-worker">設定を保存</button>
            </div>
          </div>

          <div class="settings-section">
            <h3>データのバックアップ / 復元（JSON）</h3>
            <div class="settings-row" style="flex-direction:row;">
              <button type="button" class="btn btn-small" id="s-export">エクスポート</button>
              <label class="btn btn-small" style="cursor:pointer;">
                インポート
                <input type="file" id="s-import" accept=".json" class="hidden">
              </label>
            </div>
          </div>
        </div>
      `;

      const grid = container.querySelector('#s-wp-grid');
      WALLPAPERS.forEach(wp => {
        const sw = document.createElement('div');
        sw.className = 'wp-swatch' + (wp.css === currentWp ? ' active' : '');
        sw.style.background = wp.css;
        sw.onclick = () => {
          Storage.setUserData('wallpaper', wp.css);
          Desktop.applyWallpaper();
          grid.querySelectorAll('.wp-swatch').forEach(x => x.classList.remove('active'));
          sw.classList.add('active');
        };
        grid.appendChild(sw);
      });

      container.querySelector('#s-save-worker').onclick = () => {
        const clientId = container.querySelector('#s-client-id').value.trim();
        const workerUrl = container.querySelector('#s-worker-url').value.trim();
        const proxyPass = container.querySelector('#s-proxy-pass').value.trim();
        Storage.setGlobal('oauth_cfg', { clientId, workerUrl, proxyPass });
        Desktop.updateProxyBadge();
        alert('設定を保存しました。');
      };

      container.querySelector('#s-export').onclick = () => {
        const blob = new Blob([JSON.stringify(Storage.exportAllUserData(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `webos-backup-${State.user.login}.json`;
        a.click();
      };

      container.querySelector('#s-import').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            Storage.importAllUserData(JSON.parse(reader.result));
            Desktop.applyWallpaper();
            Desktop.renderIcons();
            alert('データを復元しました！');
          } catch (err) {
            alert('読み込みエラー: ' + err.message);
          }
        };
        reader.readAsText(file);
      };
    },

    /* ---------- 仮想Webブラウザ（JSONP検索＋Workerプロキシ対応） ---------- */
    browser(container, winObj, options = {}) {
      let tabs = [{
        id: 1,
        title: '新しいタブ',
        history: [options.initialQuery || 'about:home'],
        histIndex: 0,
        useProxy: true
      }];
      let activeTabId = 1;
      let tabSeq = 1;

      container.innerHTML = `
        <div class="browser-app">
          <div class="browser-tabs" id="b-tabs"></div>
          <div class="browser-navbar">
            <button type="button" class="b-nav-btn" id="b-back" title="戻る"><i data-lucide="arrow-left"></i></button>
            <button type="button" class="b-nav-btn" id="b-fwd" title="進む"><i data-lucide="arrow-right"></i></button>
            <button type="button" class="b-nav-btn" id="b-reload" title="再読み込み"><i data-lucide="rotate-cw"></i></button>
            <form class="b-url-form" id="b-form">
              <input type="text" class="b-url-input" id="b-url" placeholder="URL または 検索ワード...">
              <button type="submit" class="b-go-btn">移動</button>
            </form>
            <label class="b-proxy-toggle">
              <input type="checkbox" id="b-proxy-chk" checked>
              <span>Proxy</span>
            </label>
          </div>
          <div class="browser-viewport" id="b-view"></div>
        </div>
      `;

      const tabsEl = container.querySelector('#b-tabs');
      const formEl = container.querySelector('#b-form');
      const urlInput = container.querySelector('#b-url');
      const proxyChk = container.querySelector('#b-proxy-chk');
      const viewEl = container.querySelector('#b-view');

      const getActiveTab = () => tabs.find(t => t.id === activeTabId);

      const fetchJsonp = (url) => new Promise((resolve, reject) => {
        const cbName = `webos_cb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        const script = document.createElement('script');
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('検索タイムアウト'));
        }, 8000);

        const cleanup = () => {
          clearTimeout(timer);
          delete window[cbName];
          script.remove();
        };

        window[cbName] = (data) => {
          cleanup();
          resolve(data);
        };

        script.onerror = () => {
          cleanup();
          reject(new Error('ネットワーク接続エラー'));
        };

        script.src = `${url}&callback=${cbName}`;
        document.body.appendChild(script);
      });

      const renderTabs = () => {
        tabsEl.innerHTML = '';
        tabs.forEach(t => {
          const el = document.createElement('div');
          el.className = 'b-tab' + (t.id === activeTabId ? ' active' : '');
          el.innerHTML = `<span class="b-tab-title">${t.title}</span><span class="b-tab-close">×</span>`;
          el.onclick = (e) => {
            if (e.target.classList.contains('b-tab-close')) {
              if (tabs.length === 1) return;
              tabs = tabs.filter(x => x.id !== t.id);
              if (activeTabId === t.id) activeTabId = tabs[0].id;
              renderTabs();
              renderViewport();
            } else {
              activeTabId = t.id;
              renderTabs();
              renderViewport();
            }
          };
          tabsEl.appendChild(el);
        });

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'b-new-tab';
        addBtn.textContent = '+';
        addBtn.onclick = () => {
          tabSeq += 1;
          tabs.push({ id: tabSeq, title: '新しいタブ', history: ['about:home'], histIndex: 0, useProxy: true });
          activeTabId = tabSeq;
          renderTabs();
          renderViewport();
        };
        tabsEl.appendChild(addBtn);
      };

      const navigate = (inputStr, pushHistory = true) => {
        const tab = getActiveTab();
        const q = inputStr.trim();
        if (!q) return;

        if (pushHistory) {
          tab.history = tab.history.slice(0, tab.histIndex + 1);
          tab.history.push(q);
          tab.histIndex = tab.history.length - 1;
        }
        renderViewport();
      };

      const renderViewport = async () => {
        const tab = getActiveTab();
        const current = tab.history[tab.histIndex];
        urlInput.value = current === 'about:home' ? '' : current;
        proxyChk.checked = tab.useProxy;

        if (current === 'about:home') {
          tab.title = 'ホーム';
          renderTabs();
          viewEl.innerHTML = `
            <div class="search-results-page" style="text-align:center; padding-top:36px;">
              <h2 style="margin-bottom:8px;">WebOS Browser</h2>
              <p style="color:#94a3b8; font-size:0.84rem; margin-bottom:18px;">
                上のバーに検索ワード、またはURLを入力して「移動」を押してください
              </p>
              <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
                <button type="button" class="btn btn-small" data-quick="日本の鉄道">検索: 日本の鉄道</button>
                <button type="button" class="btn btn-small" data-quick="JavaScript">検索: JavaScript</button>
                <button type="button" class="btn btn-small" data-quick="https://example.com">Example.com</button>
              </div>
            </div>
          `;
          viewEl.querySelectorAll('[data-quick]').forEach(b => {
            b.onclick = () => navigate(b.dataset.quick);
          });
          return;
        }

        const isUrl = /^https?:\/\//i.test(current) || (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(current) && !current.includes(' '));
        if (isUrl) {
          const targetUrl = /^https?:\/\//i.test(current) ? current : `https://${current}`;
          tab.title = targetUrl.replace(/^https?:\/\//, '');
          renderTabs();

          const cfg = Storage.getGlobal('oauth_cfg', {});
          let iframeSrc = targetUrl;

          if (tab.useProxy && cfg.workerUrl) {
            const pUrl = new URL(`${cfg.workerUrl.replace(/\/$/, '')}/proxy`);
            pUrl.searchParams.set('url', targetUrl);
            if (State.user?.token) {
              pUrl.searchParams.set('token', State.user.token);
            } else if (cfg.proxyPass) {
              pUrl.searchParams.set('pass', cfg.proxyPass);
            }
            iframeSrc = pUrl.toString();
          }

          viewEl.innerHTML = `<iframe class="browser-iframe" src="${iframeSrc}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>`;
          return;
        }

        tab.title = `検索: ${current}`;
        renderTabs();
        viewEl.innerHTML = `<div class="search-results-page"><p>「${current}」を検索中...</p></div>`;

        try {
          const wikiApi = `https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(current)}&format=json`;
          const data = await fetchJsonp(wikiApi);
          const results = data?.query?.search || [];

          const ddgUrl = `https://duckduckgo.com/?q=${encodeURIComponent(current)}`;
          const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(current)}`;

          let html = `
            <div class="search-result-card" style="border-color:rgba(56,189,248,0.4);">
              <h4>外部検索エンジンで開く: 「${current}」</h4>
              <p>Wikipedia以外のWeb全体を検索したい場合はこちらから直接開けます。</p>
              <div class="search-result-actions">
                <a class="btn btn-small" style="text-decoration:none;" href="${ddgUrl}" target="_blank" rel="noopener">DuckDuckGoで検索</a>
                <a class="btn btn-small" style="background:rgba(255,255,255,0.14);color:#fff;text-decoration:none;" href="${googleUrl}" target="_blank" rel="noopener">Googleで検索</a>
              </div>
            </div>
          `;

          if (results.length) {
            html += results.map(item => {
              const pageUrl = `https://ja.wikipedia.org/wiki/${encodeURIComponent(item.title)}`;
              return `
                <div class="search-result-card">
                  <h4>${item.title}</h4>
                  <p>${item.snippet}...</p>
                  <div class="search-result-actions">
                    <button type="button" class="btn btn-small" data-open-url="${pageUrl}">OSブラウザ内で開く</button>
                    <a class="btn btn-small" style="background:rgba(255,255,255,0.12);color:#fff;text-decoration:none;" href="${pageUrl}" target="_blank" rel="noopener">別タブで開く</a>
                  </div>
                </div>
              `;
            }).join('');
          } else {
            html += `<p style="color:#94a3b8;font-size:0.85rem;">Wikipedia内に一致する記事は見つかりませんでした。</p>`;
          }

          viewEl.innerHTML = `<div class="search-results-page">${html}</div>`;
          viewEl.querySelectorAll('[data-open-url]').forEach(btn => {
            btn.onclick = () => navigate(btn.dataset.openUrl);
          });
        } catch (err) {
          viewEl.innerHTML = `<div class="search-results-page"><p>検索エラー: ${err.message}</p></div>`;
        }
      };

      formEl.addEventListener('submit', (e) => {
        e.preventDefault();
        urlInput.blur();
        navigate(urlInput.value);
      });
      proxyChk.addEventListener('change', () => {
        getActiveTab().useProxy = proxyChk.checked;
        renderViewport();
      });
      container.querySelector('#b-back').onclick = () => {
        const tab = getActiveTab();
        if (tab.histIndex > 0) { tab.histIndex -= 1; renderViewport(); }
      };
      container.querySelector('#b-fwd').onclick = () => {
        const tab = getActiveTab();
        if (tab.histIndex < tab.history.length - 1) { tab.histIndex += 1; renderViewport(); }
      };
      container.querySelector('#b-reload').onclick = () => renderViewport();

      renderTabs();
      renderViewport();
      lucide.createIcons();
    }
  };

  /* =========================================================
   * 8. グローバルUIイベント（右クリック ＆ スマホ長押しメニュー対応）
   * ========================================================= */
  function bindGlobalEvents() {
    document.getElementById('btn-github-login').onclick = () => Auth.startGitHubLogin();
    document.getElementById('btn-guest-login').onclick = () => Auth.loginAsGuest();
    document.getElementById('btn-logout').onclick = () => Auth.logout();

    document.getElementById('btn-save-oauth-cfg').onclick = () => {
      const clientId = document.getElementById('cfg-client-id').value.trim();
      const workerUrl = document.getElementById('cfg-worker-url').value.trim();
      const proxyPass = document.getElementById('cfg-proxy-pass').value.trim();
      Storage.setGlobal('oauth_cfg', { clientId, workerUrl, proxyPass });
      alert('設定を保存しました。');
    };

    const startMenu = document.getElementById('start-menu');
    document.getElementById('btn-start').onclick = (e) => {
      e.stopPropagation();
      startMenu.classList.toggle('hidden');
      document.getElementById('context-menu').classList.add('hidden');
    };

    document.getElementById('btn-settings-quick').onclick = () => {
      WindowManager.open('settings');
      startMenu.classList.add('hidden');
    };

    const ctxMenu = document.getElementById('context-menu');
    const desktopIcons = document.getElementById('desktop-icons');

    const openContextMenu = (x, y) => {
      startMenu.classList.add('hidden');
      ctxMenu.style.left = `${Math.min(x, window.innerWidth - 205)}px`;
      ctxMenu.style.top = `${Math.min(y, window.innerHeight - 250)}px`;
      ctxMenu.classList.remove('hidden');
    };

    desktopIcons.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(e.clientX, e.clientY);
    });

    let longPressTimer = null;
    desktopIcons.addEventListener('pointerdown', (e) => {
      if (e.target !== desktopIcons) return;
      longPressTimer = setTimeout(() => openContextMenu(e.clientX, e.clientY), 550);
    });
    desktopIcons.addEventListener('pointerup', () => clearTimeout(longPressTimer));
    desktopIcons.addEventListener('pointermove', () => clearTimeout(longPressTimer));

    ctxMenu.querySelectorAll('.ctx-item').forEach(item => {
      item.onclick = () => {
        const act = item.dataset.action;
        ctxMenu.classList.add('hidden');
        if (act === 'new-note') WindowManager.open('notes', { createNew: true });
        if (act === 'open-terminal') WindowManager.open('terminal');
        if (act === 'open-browser') WindowManager.open('browser');
        if (act === 'open-settings') WindowManager.open('settings');
        if (act === 'change-wallpaper') {
          const cur = Storage.getUserData('wallpaper', WALLPAPERS[0].css);
          const idx = WALLPAPERS.findIndex(w => w.css === cur);
          const next = WALLPAPERS[(idx + 1) % WALLPAPERS.length];
          Storage.setUserData('wallpaper', next.css);
          Desktop.applyWallpaper();
        }
        if (act === 'reset-icons') {
          Storage.setUserData('icons', Desktop.getDefaultIconPositions());
          Desktop.renderIcons();
        }
      };
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#start-menu') && !e.target.closest('#btn-start')) {
        startMenu.classList.add('hidden');
      }
      if (!e.target.closest('#context-menu')) {
        ctxMenu.classList.add('hidden');
      }
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    bindGlobalEvents();
    Auth.init();
  });
})();
