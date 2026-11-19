/**
 * WebOS Core Application (app.js)
 * - スタートボタン (#btn-start) / スタートメニュー (#start-menu) の確実な開閉
 * - ウィンドウ管理 (ドラッグ・リサイズ・最小化・最大化・閉じる)
 * - ブラウザアプリ (/search 対応)、APK展開・登録アプリ、ゲームランチャー内蔵
 */

const Storage = {
  getGlobal(key, fallback) {
    try {
      const raw = localStorage.getItem(`webos_global_${key}`);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  setGlobal(key, value) {
    try {
      localStorage.setItem(`webos_global_${key}`, JSON.stringify(value));
    } catch {}
  },
  getUserData(key, fallback) {
    try {
      const prefix = State.user?.id ? `webos_user_${State.user.id}_` : 'webos_guest_';
      const raw = localStorage.getItem(`${prefix}${key}`);
      return raw !== null ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  setUserData(key, value) {
    try {
      const prefix = State.user?.id ? `webos_user_${State.user.id}_` : 'webos_guest_';
      localStorage.setItem(`${prefix}${key}`, JSON.stringify(value));
    } catch {}
  }
};

const State = {
  user: Storage.getGlobal('current_user', null),
  windows: [],
  zIndexCounter: 100,
  activeWinId: null
};

const APPS = {
  browser: {
    id: 'browser',
    title: 'ブラウザ',
    icon: 'globe',
    color: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
    width: 820,
    height: 540
  },
  apkManager: {
    id: 'apkManager',
    title: 'APK 展開・管理',
    icon: 'package',
    color: 'linear-gradient(135deg, #10b981, #047857)',
    width: 600,
    height: 440
  },
  gameLauncher: {
    id: 'gameLauncher',
    title: 'ゲームランチャー',
    icon: 'gamepad-2',
    color: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
    width: 780,
    height: 520
  },
  notepad: {
    id: 'notepad',
    title: 'メモ帳',
    icon: 'file-text',
    color: 'linear-gradient(135deg, #f59e0b, #d97706)',
    width: 560,
    height: 400
  },
  settings: {
    id: 'settings',
    title: '設定',
    icon: 'settings',
    color: 'linear-gradient(135deg, #64748b, #334155)',
    width: 560,
    height: 440
  }
};

async function parseZipEntries(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const entries = [];
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;

    const method = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const uncompSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > bytes.length) break;

    const name = decoder.decode(bytes.subarray(nameStart, nameEnd));
    const dataStart = nameEnd + extraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > bytes.length) break;

    entries.push({
      name,
      method,
      compressedSize: compSize,
      uncompressedSize: uncompSize
    });

    offset = dataEnd;
  }

  return entries;
}

const AppRenderers = {
  browser(container) {
    let tabs = [{
      id: 1,
      title: '新しいタブ',
      history: ['about:home'],
      histIndex: 0,
      useProxy: true
    }];
    let activeTabId = 1;
    let tabSeq = 1;

    container.innerHTML = `
      <div class="browser-app" style="display:flex;flex-direction:column;height:100%;">
        <div class="browser-tabs" id="b-tabs" style="display:flex;gap:4px;padding:6px;background:rgba(0,0,0,0.25);align-items:center;flex-wrap:wrap;"></div>
        <div class="browser-navbar" style="display:flex;gap:6px;padding:8px;background:rgba(15,23,42,0.85);align-items:center;">
          <button type="button" class="btn btn-small" id="b-back" title="戻る"><i data-lucide="arrow-left"></i></button>
          <button type="button" class="btn btn-small" id="b-fwd" title="進む"><i data-lucide="arrow-right"></i></button>
          <button type="button" class="btn btn-small" id="b-reload" title="再読み込み"><i data-lucide="rotate-cw"></i></button>
          <form class="b-url-form" id="b-form" style="display:flex;flex:1;gap:6px;">
            <input type="text" class="b-url-input" id="b-url" placeholder="URL または 検索ワード..." style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.35);color:#fff;">
            <button type="submit" class="btn btn-small" id="b-go">移動</button>
          </form>
          <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;color:#cbd5e1;cursor:pointer;">
            <input type="checkbox" id="b-proxy-chk" checked>
            <span>Proxy</span>
          </label>
        </div>
        <div class="browser-viewport" id="b-view" style="flex:1;overflow:auto;background:#0b1020;"></div>
      </div>
    `;

    const tabsEl = container.querySelector('#b-tabs');
    const formEl = container.querySelector('#b-form');
    const urlInput = container.querySelector('#b-url');
    const proxyChk = container.querySelector('#b-proxy-chk');
    const viewEl = container.querySelector('#b-view');

    const getActiveTab = () => tabs.find(t => t.id === activeTabId);

    const renderTabs = () => {
      tabsEl.innerHTML = '';
      tabs.forEach(t => {
        const el = document.createElement('div');
        el.className = 'b-tab' + (t.id === activeTabId ? ' active' : '');
        el.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:6px;background:rgba(255,255,255,0.08);cursor:pointer;font-size:0.78rem;';
        if (t.id === activeTabId) el.style.background = 'rgba(59,130,246,0.35)';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = t.title;
        titleSpan.onclick = () => {
          activeTabId = t.id;
          renderTabs();
          renderViewport();
        };

        const closeSpan = document.createElement('span');
        closeSpan.textContent = '×';
        closeSpan.style.padding = '0 2px';
        closeSpan.onclick = (e) => {
          e.stopPropagation();
          if (tabs.length === 1) return;
          tabs = tabs.filter(x => x.id !== t.id);
          if (activeTabId === t.id) activeTabId = tabs[0].id;
          renderTabs();
          renderViewport();
        };

        el.appendChild(titleSpan);
        el.appendChild(closeSpan);
        tabsEl.appendChild(el);
      });

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn btn-small';
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
      const q = (inputStr || '').trim();
      if (!q || !tab) return;

      if (pushHistory) {
        tab.history = tab.history.slice(0, tab.histIndex + 1);
        tab.history.push(q);
        tab.histIndex = tab.history.length - 1;
      }
      renderViewport();
    };

    const renderViewport = async () => {
      const tab = getActiveTab();
      if (!tab) return;
      const current = tab.history[tab.histIndex];
      urlInput.value = current === 'about:home' ? '' : current;
      proxyChk.checked = tab.useProxy;

      if (current === 'about:home') {
        tab.title = 'ホーム';
        renderTabs();
        viewEl.innerHTML = `
          <div style="text-align:center;padding:36px 16px;">
            <h2 style="margin-bottom:8px;">WebOS Browser</h2>
            <p style="color:#94a3b8;font-size:0.84rem;margin-bottom:18px;">
              検索ワードまたはURLを入力してください
            </p>
            <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
              <button type="button" class="btn btn-small" data-quick="WebOS">検索: WebOS</button>
              <button type="button" class="btn btn-small" data-quick="HTML CSS">検索: HTML CSS</button>
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

        viewEl.innerHTML = `<iframe src="${iframeSrc}" style="width:100%;height:100%;border:none;background:#fff;" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>`;
        return;
      }

      tab.title = `検索: ${current}`;
      renderTabs();
      viewEl.innerHTML = `<div style="padding:20px;color:#cbd5e1;">「${current}」を検索中...</div>`;

      const cfg = Storage.getGlobal('oauth_cfg', {});
      if (!cfg.workerUrl) {
        viewEl.innerHTML = `
          <div style="padding:20px;">
            <div style="padding:14px;border-radius:8px;background:rgba(255,255,255,0.06);">
              <h4 style="margin-bottom:6px;">Worker URL が未設定です</h4>
              <p style="font-size:0.82rem;color:#94a3b8;">Web検索を利用するには「設定」から Cloudflare Worker URL を保存してください。URLの直接入力はそのまま開けます。</p>
            </div>
          </div>
        `;
        return;
      }

      try {
        const searchEndpoint = `${cfg.workerUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(current)}`;
        const res = await fetch(searchEndpoint);
        const data = await res.json();
        const results = data?.results || [];

        if (!results.length) {
          viewEl.innerHTML = `<div style="padding:20px;color:#94a3b8;">「${current}」の検索結果が見つかりませんでした。</div>`;
          return;
        }

        viewEl.innerHTML = `
          <div style="padding:14px;display:flex;flex-direction:column;gap:10px;">
            ${results.map(item => `
              <div style="padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.06);">
                <div style="font-size:0.7rem;color:#94a3b8;">[${item.source || 'Web'}] ${item.url}</div>
                <h4 style="margin:3px 0;font-size:0.92rem;">${item.title}</h4>
                <p style="font-size:0.8rem;color:#cbd5e1;margin-bottom:8px;">${item.snippet || ''}</p>
                <div style="display:flex;gap:8px;">
                  <button type="button" class="btn btn-small" data-open-url="${item.url}">ブラウザで開く</button>
                  <a class="btn btn-small" style="text-decoration:none;" href="${item.url}" target="_blank" rel="noopener">外部タブで開く</a>
                </div>
              </div>
            `).join('')}
          </div>
        `;

        viewEl.querySelectorAll('[data-open-url]').forEach(btn => {
          btn.onclick = () => navigate(btn.dataset.openUrl);
        });
      } catch (err) {
        viewEl.innerHTML = `<div style="padding:20px;color:#f87171;">検索エラー: ${err.message}</div>`;
      }
    };

    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      urlInput.blur();
      navigate(urlInput.value);
    });

    proxyChk.addEventListener('change', () => {
      const tab = getActiveTab();
      if (tab) {
        tab.useProxy = proxyChk.checked;
        renderViewport();
      }
    });

    container.querySelector('#b-back').onclick = () => {
      const tab = getActiveTab();
      if (tab && tab.histIndex > 0) {
        tab.histIndex -= 1;
        renderViewport();
      }
    };

    container.querySelector('#b-fwd').onclick = () => {
      const tab = getActiveTab();
      if (tab && tab.histIndex < tab.history.length - 1) {
        tab.histIndex += 1;
        renderViewport();
      }
    };

    container.querySelector('#b-reload').onclick = () => renderViewport();

    renderTabs();
    renderViewport();
    if (window.lucide) window.lucide.createIcons();
  },

  apkManager(container) {
    container.innerHTML = `
      <div style="padding:14px;font-size:0.84rem;line-height:1.5;height:100%;overflow:auto;">
        <h3 style="margin-bottom:8px;">APK ファイルの展開とOS内アプリ登録</h3>
        <p style="color:#94a3b8;margin-bottom:10px;">
          APKまたはZIPファイルを選択すると内部構造を展開し、Web OS内のアプリとして登録・起動できます。
        </p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
          <input type="file" id="apk-file-input" accept=".apk,.zip">
          <input type="text" id="apk-custom-name" placeholder="OS内アプリ名（任意）" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:#fff;">
          <button type="button" class="btn btn-small" id="apk-install-btn" disabled>OS内に登録</button>
        </div>
        <pre id="apk-preview" style="background:rgba(0,0,0,0.45);padding:10px;border-radius:8px;max-height:150px;overflow:auto;font-size:0.76rem;margin-bottom:14px;">ファイルを選択してください。</pre>
        <h4 style="margin-bottom:6px;">登録済みのOS内アプリ</h4>
        <div id="apk-installed-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      </div>
    `;

    const fileInput = container.querySelector('#apk-file-input');
    const nameInput = container.querySelector('#apk-custom-name');
    const installBtn = container.querySelector('#apk-install-btn');
    const previewEl = container.querySelector('#apk-preview');
    const listEl = container.querySelector('#apk-installed-list');

    let parsedPackage = null;

    const renderInstalledList = () => {
      const currentList = Storage.getUserData('installed_apks', []);
      if (!currentList.length) {
        listEl.innerHTML = `<div style="color:#94a3b8;font-size:0.8rem;">登録済みのアプリはありません。</div>`;
        return;
      }

      listEl.innerHTML = currentList.map(pkg => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,0.06);">
          <div>
            <strong>${pkg.title}</strong>
            <div style="font-size:0.74rem;color:#94a3b8;">${pkg.fileName} / エントリ数: ${pkg.entryCount}</div>
          </div>
          <button type="button" class="btn btn-small" data-launch-apk="${pkg.id}">起動</button>
        </div>
      `).join('');

      listEl.querySelectorAll('[data-launch-apk]').forEach(btn => {
        btn.onclick = () => {
          const target = Storage.getUserData('installed_apks', []).find(x => x.id === btn.dataset.launchApk);
          if (!target) return;

          const customAppId = `apk_app_${target.id}`;
          APPS[customAppId] = {
            id: customAppId,
            title: target.title,
            icon: 'package',
            color: 'linear-gradient(135deg, #06b6d4, #0284c7)',
            width: 540,
            height: 380
          };
          AppRenderers[customAppId] = (body) => {
            body.innerHTML = `
              <div style="padding:14px;font-size:0.84rem;line-height:1.6;">
                <h3 style="margin-bottom:6px;">${target.title}</h3>
                <p style="color:#94a3b8;margin-bottom:10px;">元ファイル: ${target.fileName}</p>
                <pre style="background:rgba(0,0,0,0.45);padding:10px;border-radius:8px;max-height:220px;overflow:auto;font-size:0.75rem;">${(target.entries || []).join('\n')}</pre>
              </div>
            `;
          };
          WindowManager.open(customAppId);
        };
      });
    };

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const buf = await file.arrayBuffer();
      const entries = await parseZipEntries(buf);

      parsedPackage = {
        id: String(Date.now()),
        fileName: file.name,
        title: nameInput.value.trim() || file.name.replace(/\.(apk|zip)$/i, ''),
        entryCount: entries.length,
        entries: entries.slice(0, 100).map(en => `${en.name} (${en.uncompressedSize} B)`)
      };

      installBtn.disabled = false;
      previewEl.textContent = [
        `ファイル名: ${file.name}`,
        `サイズ: ${file.size.toLocaleString()} bytes`,
        `検出エントリ数: ${entries.length}`,
        ...entries.slice(0, 12).map(en => `  - ${en.name}`)
      ].join('\n');
    });

    installBtn.addEventListener('click', () => {
      if (!parsedPackage) return;
      const title = nameInput.value.trim() || parsedPackage.title;
      const record = { ...parsedPackage, title };
      const updated = [record, ...Storage.getUserData('installed_apks', [])];
      Storage.setUserData('installed_apks', updated);
      renderInstalledList();
    });

    renderInstalledList();
  },

  gameLauncher(container) {
    const initialGames = Storage.getUserData('web_games', [
      { name: 'Example Page', url: 'https://example.com' }
    ]);

    container.innerHTML = `
      <div style="padding:12px;height:100%;display:flex;flex-direction:column;gap:10px;font-size:0.84rem;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <input type="text" id="g-name" placeholder="ゲーム名" style="padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:#fff;width:140px;">
          <input type="url" id="g-url" placeholder="https://... （ゲームURL）" style="padding:6px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.3);color:#fff;flex:1;min-width:180px;">
          <button type="button" class="btn btn-small" id="g-add">追加して起動</button>
        </div>
        <div id="g-list" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
        <iframe id="g-frame" src="${initialGames[0]?.url || 'about:blank'}" style="flex:1;width:100%;border:none;border-radius:8px;background:#090d16;" sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms"></iframe>
      </div>
    `;

    const nameInput = container.querySelector('#g-name');
    const urlInput = container.querySelector('#g-url');
    const addBtn = container.querySelector('#g-add');
    const listEl = container.querySelector('#g-list');
    const frameEl = container.querySelector('#g-frame');

    const renderList = () => {
      const games = Storage.getUserData('web_games', initialGames);
      listEl.innerHTML = games.map((g, i) => `
        <button type="button" class="btn btn-small" data-g-idx="${i}">${g.name}</button>
      `).join('');

      listEl.querySelectorAll('[data-g-idx]').forEach(btn => {
        btn.onclick = () => {
          const g = games[Number(btn.dataset.gIdx)];
          if (g) frameEl.src = g.url;
        };
      });
    };

    addBtn.onclick = () => {
      const rawUrl = urlInput.value.trim();
      if (!rawUrl) return;
      const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      const name = nameInput.value.trim() || url.replace(/^https?:\/\//, '').slice(0, 20);
      const games = Storage.getUserData('web_games', initialGames);
      games.unshift({ name, url });
      Storage.setUserData('web_games', games);
      nameInput.value = '';
      urlInput.value = '';
      frameEl.src = url;
      renderList();
    };

    renderList();
  },

  notepad(container) {
    const savedText = Storage.getUserData('notepad_text', '');
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;height:100%;padding:10px;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:0.8rem;color:#94a3b8;">自動保存メモ</span>
          <span id="note-status" style="font-size:0.75rem;color:#38bdf8;">保存済み</span>
        </div>
        <textarea id="note-area" style="flex:1;width:100%;resize:none;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.35);color:#fff;font-size:0.88rem;line-height:1.5;">${savedText}</textarea>
      </div>
    `;
    const area = container.querySelector('#note-area');
    const status = container.querySelector('#note-status');
    area.addEventListener('input', () => {
      Storage.setUserData('notepad_text', area.value);
      status.textContent = '保存しました';
    });
  },

  settings(container) {
    const cfg = Storage.getGlobal('oauth_cfg', { workerUrl: '', proxyPass: '' });
    container.innerHTML = `
      <div style="padding:14px;font-size:0.84rem;display:flex;flex-direction:column;gap:10px;">
        <h3>システム・ネットワーク設定</h3>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span>Cloudflare Worker URL</span>
          <input type="url" id="cfg-worker" value="${cfg.workerUrl || ''}" placeholder="https://....workers.dev" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.35);color:#fff;">
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;">
          <span>Proxy パスコード（任意）</span>
          <input type="password" id="cfg-pass" value="${cfg.proxyPass || ''}" style="padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.35);color:#fff;">
        </label>
        <div>
          <button type="button" class="btn btn-small" id="cfg-save">設定を保存</button>
          <span id="cfg-msg" style="margin-left:8px;font-size:0.78rem;color:#34d399;"></span>
        </div>
      </div>
    `;
    container.querySelector('#cfg-save').onclick = () => {
      Storage.setGlobal('oauth_cfg', {
        workerUrl: container.querySelector('#cfg-worker').value.trim(),
        proxyPass: container.querySelector('#cfg-pass').value
      });
      container.querySelector('#cfg-msg').textContent = '保存しました';
    };
  }
};

const WindowManager = {
  open(appId) {
    const app = APPS[appId];
    const renderer = AppRenderers[appId];
    const layer = document.getElementById('window-layer') || document.body;
    if (!app || !renderer) return;

    const winId = `win_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const winEl = document.createElement('div');
    winEl.className = 'os-window';
    winEl.id = winId;
    winEl.style.cssText = `
      position:fixed;
      top:70px;
      left:${Math.max(20, 80 + (State.windows.length % 6) * 24)}px;
      width:${Math.min(app.width || 640, window.innerWidth - 24)}px;
      height:${Math.min(app.height || 440, window.innerHeight - 90)}px;
      z-index:${++State.zIndexCounter};
      background:#0f172a;
      color:#f8fafc;
      border:1px solid rgba(255,255,255,0.16);
      border-radius:10px;
      box-shadow:0 16px 40px rgba(0,0,0,0.5);
      display:flex;
      flex-direction:column;
      overflow:hidden;
    `;

    winEl.innerHTML = `
      <div class="win-header" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:rgba(30,41,59,0.95);cursor:move;user-select:none;">
        <span style="font-size:0.86rem;font-weight:600;">${app.title}</span>
        <div style="display:flex;gap:6px;">
          <button type="button" class="win-min" style="padding:2px 8px;border:none;border-radius:4px;background:rgba(255,255,255,0.12);color:#fff;cursor:pointer;">－</button>
          <button type="button" class="win-close" style="padding:2px 8px;border:none;border-radius:4px;background:#ef4444;color:#fff;cursor:pointer;">×</button>
        </div>
      </div>
      <div class="win-body" style="flex:1;overflow:hidden;position:relative;"></div>
    `;

    const bodyEl = winEl.querySelector('.win-body');
    renderer(bodyEl);

    winEl.addEventListener('pointerdown', () => {
      winEl.style.zIndex = ++State.zIndexCounter;
      State.activeWinId = winId;
    });

    winEl.querySelector('.win-close').onclick = () => {
      winEl.remove();
      State.windows = State.windows.filter(w => w.id !== winId);
    };

    winEl.querySelector('.win-min').onclick = () => {
      winEl.style.display = winEl.style.display === 'none' ? 'flex' : 'none';
    };

    const header = winEl.querySelector('.win-header');
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      offsetX = e.clientX - winEl.offsetLeft;
      offsetY = e.clientY - winEl.offsetTop;
      header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      winEl.style.left = `${Math.max(0, e.clientX - offsetX)}px`;
      winEl.style.top = `${Math.max(0, e.clientY - offsetY)}px`;
    });

    header.addEventListener('pointerup', () => {
      dragging = false;
    });

    layer.appendChild(winEl);
    State.windows.push({ id: winId, appId, el: winEl });
    if (window.lucide) window.lucide.createIcons();
  }
};

const Desktop = {
  renderIcons() {
    const grid = document.getElementById('desktop-icons');
    if (!grid) return;
    grid.innerHTML = '';

    Object.values(APPS).forEach(app => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'desktop-icon';
      item.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px;border:none;border-radius:8px;background:transparent;color:#fff;cursor:pointer;width:88px;';
      item.innerHTML = `
        <div style="width:44px;height:44px;border-radius:10px;background:${app.color};display:flex;align-items:center;justify-content:center;">
          <i data-lucide="${app.icon}"></i>
        </div>
        <span style="font-size:0.75rem;text-align:center;text-shadow:0 1px 3px rgba(0,0,0,0.8);">${app.title}</span>
      `;
      item.onclick = () => WindowManager.open(app.id);
      grid.appendChild(item);
    });

    if (window.lucide) window.lucide.createIcons();
  },

  renderStartMenu() {
    const list = document.getElementById('start-app-list');
    if (!list) return;
    list.innerHTML = '';

    Object.values(APPS).forEach(app => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'start-app-item';
      btn.style.cssText = 'display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:none;border-radius:6px;background:transparent;color:#fff;cursor:pointer;text-align:left;font-size:0.85rem;';
      btn.innerHTML = `<i data-lucide="${app.icon}"></i><span>${app.title}</span>`;
      btn.onclick = () => {
        const startMenu = document.getElementById('start-menu');
        if (startMenu) startMenu.classList.add('hidden');
        WindowManager.open(app.id);
      };
      list.appendChild(btn);
    });

    if (window.lucide) window.lucide.createIcons();
  },

  updateClock() {
    const clockEl = document.getElementById('clock');
    if (!clockEl) return;
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    clockEl.textContent = `${hh}:${mm}`;
  }
};

function bindGlobalEvents() {
  const btnStart = document.getElementById('btn-start');
  const startMenu = document.getElementById('start-menu');
  const ctxMenu = document.getElementById('context-menu');

  const toggleStartMenu = (e) => {
    if (!startMenu) return;
    e.preventDefault();
    e.stopPropagation();
    const willOpen = startMenu.classList.contains('hidden');
    startMenu.classList.toggle('hidden', !willOpen);
    startMenu.style.display = willOpen ? 'block' : 'none';
    if (ctxMenu) {
      ctxMenu.classList.add('hidden');
      ctxMenu.style.display = 'none';
    }
  };

  if (btnStart) {
    btnStart.addEventListener('pointerdown', toggleStartMenu);
    btnStart.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  document.addEventListener('pointerdown', (e) => {
    if (startMenu && !e.target.closest('#start-menu') && !e.target.closest('#btn-start')) {
      startMenu.classList.add('hidden');
      startMenu.style.display = 'none';
    }
    if (ctxMenu && !e.target.closest('#context-menu')) {
      ctxMenu.classList.add('hidden');
      ctxMenu.style.display = 'none';
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  Desktop.renderIcons();
  Desktop.renderStartMenu();
  Desktop.updateClock();
  bindGlobalEvents();
  setInterval(() => Desktop.updateClock(), 15000);
  if (window.lucide) window.lucide.createIcons();
});
