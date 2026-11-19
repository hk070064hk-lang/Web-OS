/**
 * WebOS Core — Pure Vanilla JS Desktop Environment
 * Chromebook / GitHub Pages / Cloudflare Workers Ready
 */
(() => {
  'use strict';

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
    notes: {
      id: 'notes',
      title: 'メモ帳',
      icon: 'file-text',
      color: 'linear-gradient(135deg, #f59e0b, #d97706)',
      width: 560,
      height: 400
    },
    browser: {
      id: 'browser',
      title: 'Webブラウザ',
      icon: 'globe',
      color: 'linear-gradient(135deg, #38bdf8, #2563eb)',
      width: 780,
      height: 520
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
      height: 450
    }
  };

  /* =========================================================
   * 2. ストレージ・永続化層（ユーザーごとの localStorage + IndexedDB）
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
    // 大容量データやバックアップ用の IndexedDB 同期
    openDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('WebOS_DB', 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore('kv');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async syncToIndexedDB(key, val) {
      try {
        const db = await this.openDB();
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, this.userPrefix() + key);
      } catch {
        // プライベートブラウジング等のフォールバック時は無視
      }
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
    user: null,       // { id, login, name, avatar_url, token }
    windows: [],      // 起動中ウィンドウ配列
    zCounter: 100,
    activeWinId: null
  };

  /* =========================================================
   * 4. GitHub OAuth 認証フロー（PKCE + Cloudflare Worker対応）
   * ========================================================= */
  const Auth = {
    async init() {
      const cfg = Storage.getGlobal('oauth_cfg', { clientId: '', workerUrl: '' });
      document.getElementById('cfg-client-id').value = cfg.clientId || '';
      document.getElementById('cfg-worker-url').value = cfg.workerUrl || '';

      // OAuth コールバック（?code=...&state=...）の処理
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');

      if (code && state) {
        await this.handleOAuthCallback(code, state, cfg);
        return;
      }

      // 既存セッション復元
      const savedSession = Storage.getGlobal('session', null);
      if (savedSession) {
        State.user = savedSession;
        Desktop.boot();
      }
    },

    async startGitHubLogin() {
      const cfg = Storage.getGlobal('oauth_cfg', {});
      if (!cfg.clientId || !cfg.workerUrl) {
        alert('先に「GitHub OAuth 連携設定」を開いて Client ID と Worker URL を保存してください。\n（ローカルテストのみの場合は「ゲストとして続行」を押してください）');
        return;
      }

      // PKCE (code_verifier & code_challenge) 生成
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

      // URLからパラメータを消去
      window.history.replaceState({}, document.title, window.location.pathname);

      if (!savedState || state !== savedState) {
        alert('OAuth state検証エラーが発生しました。もう一度ログインしてください。');
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
        if (!res.ok || !data.access_token) {
          throw new Error(data.error || 'トークン取得失敗');
        }

        // GitHub ユーザープロフィール取得
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
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    }
  };

  /* =========================================================
   * 5. デスクトップ・アイコン配置・タスクバー・時計
   * ========================================================= */
  const Desktop = {
    boot() {
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('desktop').classList.remove('hidden');

      // プロフィール反映
      document.getElementById('user-avatar').src = State.user.avatar_url;
      document.getElementById('user-name').textContent = State.user.name;
      document.getElementById('user-handle').textContent = `@${State.user.login}`;

      // プロキシステータス表示
      const cfg = Storage.getGlobal('oauth_cfg', {});
      const badge = document.getElementById('proxy-status-badge');
      if (cfg.workerUrl) {
        badge.textContent = 'Proxy Ready';
        badge.classList.add('online');
      }

      this.applyWallpaper();
      this.renderIcons();
      this.renderStartMenu();
      this.startClock();
      lucide.createIcons();

      // 初回起動時はウェルカムメモを用意
      const notes = Storage.getUserData('notes', null);
      if (!notes) {
        Storage.setUserData('notes', [{
          id: Date.now(),
          title: 'WebOS へようこそ！',
          content: '・デスクトップアイコンをダブルクリックで起動\n・右クリックでメニュー表示\n・ターミナルで "help" と入力するとコマンド一覧が見れます\n・ブラウザアプリはキーワード検索＆Workerプロキシに対応しています'
        }]);
      }
    },

    applyWallpaper() {
      const wp = Storage.getUserData('wallpaper', WALLPAPERS[0].css);
      document.getElementById('desktop').style.background = wp;
    },

    getDefaultIconPositions() {
      const list = Object.values(APPS);
      const pos = {};
      list.forEach((app, idx) => {
        pos[app.id] = { x: 18, y: 18 + idx * 96 };
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

        // ダブルクリック（またはモバイルタップ）で起動
        el.addEventListener('dblclick', () => WindowManager.open(app.id));
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          document.querySelectorAll('.desktop-icon').forEach(i => i.classList.remove('selected'));
          el.classList.add('selected');
        });

        // アイコンのドラッグ移動と座標保存
        let dragging = false, startX, startY, origX, origY;
        el.addEventListener('mousedown', (e) => {
          if (e.button !== 0) return;
          dragging = true;
          startX = e.clientX;
          startY = e.clientY;
          origX = p.x;
          origY = p.y;
        });

        window.addEventListener('mousemove', (e) => {
          if (!dragging) return;
          p.x = Math.max(0, origX + (e.clientX - startX));
          p.y = Math.max(0, origY + (e.clientY - startY));
          el.style.left = `${p.x}px`;
          el.style.top = `${p.y}px`;
        });

        window.addEventListener('mouseup', () => {
          if (!dragging) return;
          dragging = false;
          positions[app.id] = { x: p.x, y: p.y };
          Storage.setUserData('icons', positions);
        });

        container.appendChild(el);
      });
      lucide.createIcons();
    },

    renderStartMenu() {
      const list = document.getElementById('start-app-list');
      list.innerHTML = '';
      Object.values(APPS).forEach(app => {
        const btn = document.createElement('button');
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
   * 6. ウィンドウ管理システム（複数起動・ドラッグ・8方向リサイズ・z-index）
   * ========================================================= */
  const WindowManager = {
    open(appId, options = {}) {
      const app = APPS[appId];
      if (!app) return;

      const winId = `win_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const offset = (State.windows.length % 6) * 26;
      const winObj = {
        id: winId,
        appId,
        title: options.title || app.title,
        icon: app.icon,
        x: 90 + offset,
        y: 45 + offset,
        w: Math.min(app.width, window.innerWidth - 40),
        h: Math.min(app.height, window.innerHeight - 90),
        minimized: false,
        maximized: false
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
      el.className = 'os-window';
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
            <button class="win-btn min" title="最小化"><i data-lucide="minus"></i></button>
            <button class="win-btn max" title="最大化"><i data-lucide="square"></i></button>
            <button class="win-btn close" title="閉じる"><i data-lucide="x"></i></button>
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

      // クリックで最前面化
      el.addEventListener('mousedown', () => this.focus(winObj.id));

      // コントロールボタン
      el.querySelector('.win-btn.min').onclick = (e) => { e.stopPropagation(); this.minimize(winObj.id); };
      el.querySelector('.win-btn.max').onclick = (e) => { e.stopPropagation(); this.toggleMaximize(winObj.id); };
      el.querySelector('.win-btn.close').onclick = (e) => { e.stopPropagation(); this.close(winObj.id); };

      // タイトルバーダブルクリックで最大化切替
      const titlebar = el.querySelector('.win-titlebar');
      titlebar.addEventListener('dblclick', () => this.toggleMaximize(winObj.id));

      // タイトルバードラッグ移動
      this.bindDrag(el, titlebar, winObj);

      // 8方向リサイズ
      this.bindResize(el, winObj);

      // アプリ本体レンダリング
      const body = el.querySelector('.win-body');
      AppRenderers[winObj.appId](body, winObj, options);

      container.appendChild(el);
      lucide.createIcons();
    },

    bindDrag(el, handle, winObj) {
      let dragging = false, sx, sy, ox, oy;
      handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('.win-btn') || winObj.maximized) return;
        dragging = true;
        sx = e.clientX;
        sy = e.clientY;
        ox = winObj.x;
        oy = winObj.y;
      });
      window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        winObj.x = ox + (e.clientX - sx);
        winObj.y = Math.max(0, oy + (e.clientY - sy));
        el.style.left = `${winObj.x}px`;
        el.style.top = `${winObj.y}px`;
      });
      window.addEventListener('mouseup', () => { dragging = false; });
    },

    bindResize(el, winObj) {
      el.querySelectorAll('.resizer').forEach(r => {
        r.addEventListener('mousedown', (e) => {
          if (winObj.maximized) return;
          e.stopPropagation();
          const dir = r.dataset.dir;
          const sx = e.clientX, sy = e.clientY;
          const { x: ox, y: oy, w: ow, h: oh } = winObj;

          const onMove = (ev) => {
            const dx = ev.clientX - sx;
            const dy = ev.clientY - sy;
            if (dir.includes('e')) winObj.w = Math.max(280, ow + dx);
            if (dir.includes('s')) winObj.h = Math.max(200, oh + dy);
            if (dir.includes('w')) {
              const nw = Math.max(280, ow - dx);
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
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
          };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        });
      });
    },

    focus(winId) {
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
      this.renderTaskbar();
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
        btn.className = 'task-item' + (w.id === State.activeWinId && !w.minimized ? ' active' : '');
        btn.innerHTML = `<i data-lucide="${w.icon}"></i><span>${w.title}</span>`;
        btn.onclick = () => {
          if (w.id === State.activeWinId && !w.minimized) {
            this.minimize(w.id);
          } else {
            this.focus(w.id);
          }
        };
        bar.appendChild(btn);
      });
      lucide.createIcons();
    }
  };

  /* =========================================================
   * 7. 標準搭載アプリ実装（メモ帳 / 電卓 / ターミナル / 設定 / ブラウザ）
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
              <button class="btn btn-small" id="n-add">+ 新規</button>
              <button class="btn btn-small" id="n-del" style="background:#ef4444;color:#fff;">削除</button>
            </div>
            <div class="notes-list" id="n-list"></div>
          </div>
          <div class="notes-editor">
            <input type="text" class="note-title-input" id="n-title" placeholder="タイトル">
            <textarea class="note-textarea" id="n-body" placeholder="ここにメモを入力（自動保存されます）..."></textarea>
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
      const buttons = [
        'C', '(', ')', '/',
        '7', '8', '9', '*',
        '4', '5', '6', '-',
        '1', '2', '3', '+',
        '0', '.', '←', '='
      ];

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
        btn.className = 'calc-btn' + (['/', '*', '-', '+', 'C', '←'].includes(b) ? ' op' : '') + (b === '=' ? ' eq' : '');
        btn.textContent = b;
        btn.onclick = () => {
          if (b === 'C') {
            expr = '0';
          } else if (b === '←') {
            expr = expr.length > 1 ? expr.slice(0, -1) : '0';
          } else if (b === '=') {
            try {
              if (!/^[0-9+\-*/().\s]+$/.test(expr)) throw new Error();
              const res = Function(`"use strict"; return (${expr})`)();
              expr = String(Number.isFinite(res) ? +res.toFixed(10) : 'Error');
            } catch {
              expr = 'Error';
            }
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
          <div class="term-output" id="t-out">WebOS Shell v1.0 — "help" でコマンド一覧を表示\n</div>
          <div class="term-input-line">
            <span class="term-prompt">${State.user.login}@webos:~$</span>
            <input type="text" class="term-input" id="t-in" autofocus autocomplete="off">
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
            print('利用可能コマンド:\n  help              - このヘルプを表示\n  apps              - 起動可能なアプリ一覧\n  open <app>        - アプリ起動 (notes, browser, calculator, settings)\n  search <keyword>  - ブラウザを開いて検索\n  whoami            - ログインユーザー表示\n  date              - 現在時刻\n  clear             - 画面クリア');
            break;
          case 'apps':
            print('notes, browser, terminal, calculator, settings');
            break;
          case 'open':
            if (APPS[args[0]]) {
              WindowManager.open(args[0]);
              print(`Launching ${args[0]}...`);
            } else {
              print(`Error: アプリ "${args[0] || ''}" が見つかりません`);
            }
            break;
          case 'search':
            if (args.length) {
              WindowManager.open('browser', { initialQuery: args.join(' ') });
              print(`Searching "${args.join(' ')}" in Browser...`);
            } else {
              print('Usage: search <keyword>');
            }
            break;
          case 'whoami':
            print(`${State.user.name} (@${State.user.login}) [ID: ${State.user.id}]`);
            break;
          case 'date':
            print(new Date().toString());
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
      const oauthCfg = Storage.getGlobal('oauth_cfg', { clientId: '', workerUrl: '' });

      container.innerHTML = `
        <div class="settings-app">
          <div class="settings-section">
            <h3>壁紙設定</h3>
            <div class="wallpaper-grid" id="s-wp-grid"></div>
          </div>

          <div class="settings-section">
            <h3>GitHub アカウント ＆ プロキシWorker設定</h3>
            <p>ログイン中: <strong>${State.user.name}</strong> (@${State.user.login})</p>
            <div class="settings-row">
              <input type="text" class="settings-input" id="s-client-id" placeholder="GitHub Client ID" value="${oauthCfg.clientId || ''}">
              <input type="url" class="settings-input" id="s-worker-url" placeholder="Cloudflare Worker URL" value="${oauthCfg.workerUrl || ''}">
              <button class="btn btn-small" id="s-save-worker">保存</button>
            </div>
          </div>

          <div class="settings-section">
            <h3>データのバックアップ / 復元（JSON）</h3>
            <div class="settings-row">
              <button class="btn btn-small" id="s-export">JSONエクスポート</button>
              <label class="btn btn-small" style="cursor:pointer;">
                JSONインポート
                <input type="file" id="s-import" accept=".json" class="hidden">
              </label>
            </div>
          </div>
        </div>
      `;

      // 壁紙スウォッチ
      const grid = container.querySelector('#s-wp-grid');
      WALLPAPERS.forEach(wp => {
        const sw = document.createElement('div');
        sw.className = 'wp-swatch' + (wp.css === currentWp ? ' active' : '');
        sw.style.background = wp.css;
        sw.title = wp.name;
        sw.onclick = () => {
          Storage.setUserData('wallpaper', wp.css);
          Desktop.applyWallpaper();
          grid.querySelectorAll('.wp-swatch').forEach(x => x.classList.remove('active'));
          sw.classList.add('active');
        };
        grid.appendChild(sw);
      });

      // Worker URL 保存
      container.querySelector('#s-save-worker').onclick = () => {
        const clientId = container.querySelector('#s-client-id').value.trim();
        const workerUrl = container.querySelector('#s-worker-url').value.trim();
        Storage.setGlobal('oauth_cfg', { clientId, workerUrl });
        const badge = document.getElementById('proxy-status-badge');
        if (workerUrl) {
          badge.textContent = 'Proxy Ready';
          badge.classList.add('online');
        } else {
          badge.textContent = 'Local';
          badge.classList.remove('online');
        }
        alert('設定を保存しました。');
      };

      // エクスポート
      container.querySelector('#s-export').onclick = () => {
        const blob = new Blob([JSON.stringify(Storage.exportAllUserData(), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `webos-backup-${State.user.login}.json`;
        a.click();
      };

      // インポート
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

    /* ---------- 仮想Webブラウザ（タブ・Wikipedia検索・Cloudflare Workerプロキシ対応） ---------- */
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
            <button class="b-nav-btn" id="b-back" title="戻る"><i data-lucide="arrow-left"></i></button>
            <button class="b-nav-btn" id="b-fwd" title="進む"><i data-lucide="arrow-right"></i></button>
            <button class="b-nav-btn" id="b-reload" title="再読み込み"><i data-lucide="rotate-cw"></i></button>
            <input type="text" class="b-url-input" id="b-url" placeholder="URL または 検索キーワードを入力して Enter...">
            <label class="b-proxy-toggle" title="Cloudflare Worker経由でX-Frame-Optionsをバイパス">
              <input type="checkbox" id="b-proxy-chk" checked>
              <span>Proxy経由</span>
            </label>
          </div>
          <div class="browser-viewport" id="b-view"></div>
        </div>
      `;

      const tabsEl = container.querySelector('#b-tabs');
      const urlInput = container.querySelector('#b-url');
      const proxyChk = container.querySelector('#b-proxy-chk');
      const viewEl = container.querySelector('#b-view');

      const getActiveTab = () => tabs.find(t => t.id === activeTabId);

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

        // ホーム画面
        if (current === 'about:home') {
          tab.title = 'スタートページ';
          renderTabs();
          viewEl.innerHTML = `
            <div class="search-results-page" style="text-align:center; padding-top:48px;">
              <h2 style="margin-bottom:8px;">WebOS Browser</h2>
              <p style="color:#94a3b8; font-size:0.85rem; margin-bottom:20px;">
                URL（https://...）の直接表示、またはキーワード検索（Wikipedia API）に対応
              </p>
              <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
                <button class="btn btn-small" data-quick="https://example.com">Example.com</button>
                <button class="btn btn-small" data-quick="https://ja.wikipedia.org">Wikipedia</button>
                <button class="btn btn-small" data-quick="HTML5">検索: HTML5</button>
              </div>
            </div>
          `;
          viewEl.querySelectorAll('[data-quick]').forEach(b => {
            b.onclick = () => navigate(b.dataset.quick);
          });
          return;
        }

        // URL判定
        const isUrl = /^https?:\/\//i.test(current) || (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(current) && !current.includes(' '));
        if (isUrl) {
          const targetUrl = /^https?:\/\//i.test(current) ? current : `https://${current}`;
          tab.title = targetUrl.replace(/^https?:\/\//, '');
          renderTabs();

          const cfg = Storage.getGlobal('oauth_cfg', {});
          let iframeSrc = targetUrl;

          // Workerプロキシ経由の場合、トークンまたはゲストパスコードを付与
          if (tab.useProxy && cfg.workerUrl) {
            const pUrl = new URL(`${cfg.workerUrl.replace(/\/$/, '')}/proxy`);
            pUrl.searchParams.set('url', targetUrl);
            if (State.user?.token) {
              pUrl.searchParams.set('token', State.user.token);
            }
            iframeSrc = pUrl.toString();
          }

          viewEl.innerHTML = `<iframe class="browser-iframe" src="${iframeSrc}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>`;
          return;
        }

        // キーワード検索（フロントエンド直接fetch可能なWikipedia OpenSearch / Query API）
        tab.title = `検索: ${current}`;
        renderTabs();
        viewEl.innerHTML = `<div class="search-results-page"><p>「${current}」を検索中...</p></div>`;

        try {
          const apiUrl = `https://ja.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(current)}&format=json&origin=*`;
          const res = await fetch(apiUrl);
          const data = await res.json();
          const results = data?.query?.search || [];

          if (!results.length) {
            viewEl.innerHTML = `<div class="search-results-page"><p>一致する結果が見つかりませんでした。</p></div>`;
            return;
          }

          const html = results.map(item => {
            const pageUrl = `https://ja.wikipedia.org/wiki/${encodeURIComponent(item.title)}`;
            return `
              <div class="search-result-card">
                <h4>${item.title}</h4>
                <p>${item.snippet}...</p>
                <div class="search-result-actions">
                  <button class="btn btn-small" data-open-url="${pageUrl}">ブラウザ内で開く</button>
                  <a class="btn btn-small" style="background:rgba(255,255,255,0.12);color:#fff;text-decoration:none;" href="${pageUrl}" target="_blank" rel="noopener">外部タブで開く</a>
                </div>
              </div>
            `;
          }).join('');

          viewEl.innerHTML = `<div class="search-results-page">${html}</div>`;
          viewEl.querySelectorAll('[data-open-url]').forEach(btn => {
            btn.onclick = () => navigate(btn.dataset.openUrl);
          });
        } catch (err) {
          viewEl.innerHTML = `<div class="search-results-page"><p>検索エラー: ${err.message}</p></div>`;
        }
      };

      // ナビゲーションイベント
      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') navigate(urlInput.value);
      });
      proxyChk.addEventListener('change', () => {
        getActiveTab().useProxy = proxyChk.checked;
        renderViewport();
      });
      container.querySelector('#b-back').onclick = () => {
        const tab = getActiveTab();
        if (tab.histIndex > 0) {
          tab.histIndex -= 1;
          renderViewport();
        }
      };
      container.querySelector('#b-fwd').onclick = () => {
        const tab = getActiveTab();
        if (tab.histIndex < tab.history.length - 1) {
          tab.histIndex += 1;
          renderViewport();
        }
      };
      container.querySelector('#b-reload').onclick = () => renderViewport();

      renderTabs();
      renderViewport();
      lucide.createIcons();
    }
  };

  /* =========================================================
   * 8. グローバルUIイベント（ログイン・スタートメニュー・右クリック）
   * ========================================================= */
  function bindGlobalEvents() {
    document.getElementById('btn-github-login').onclick = () => Auth.startGitHubLogin();
    document.getElementById('btn-guest-login').onclick = () => Auth.loginAsGuest();
    document.getElementById('btn-logout').onclick = () => Auth.logout();

    document.getElementById('btn-save-oauth-cfg').onclick = () => {
      const clientId = document.getElementById('cfg-client-id').value.trim();
      const workerUrl = document.getElementById('cfg-worker-url').value.trim();
      Storage.setGlobal('oauth_cfg', { clientId, workerUrl });
      alert('GitHub OAuth / Worker 設定を保存しました。');
    };

    // スタートメニュー開閉
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

    // 右クリックメニュー
    const ctxMenu = document.getElementById('context-menu');
    document.getElementById('desktop-icons').addEventListener('contextmenu', (e) => {
      e.preventDefault();
      startMenu.classList.add('hidden');
      ctxMenu.style.left = `${Math.min(e.clientX, window.innerWidth - 200)}px`;
      ctxMenu.style.top = `${Math.min(e.clientY, window.innerHeight - 230)}px`;
      ctxMenu.classList.remove('hidden');
    });

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

    // デスクトップ空白クリックでメニュー類を閉じる
    document.addEventListener('click', () => {
      startMenu.classList.add('hidden');
      ctxMenu.classList.add('hidden');
    });
  }

  // エントリーポイント
  window.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    bindGlobalEvents();
    Auth.init();
  });
})();
