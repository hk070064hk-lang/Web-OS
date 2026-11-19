    /* ---------- 仮想Webブラウザ（Worker Web検索＋プロキシ対応） ---------- */
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
                検索ワードまたはURLを入力してください（Worker設定済みならWeb全体を検索）
              </p>
              <div style="display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
                <button type="button" class="btn btn-small" data-quick="京王線 車両">検索: 京王線 車両</button>
                <button type="button" class="btn btn-small" data-quick="HTML CSS チュートリアル">検索: HTML CSS</button>
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

        // キーワード検索（Cloudflare Worker の /search エンドポイントを利用）
        tab.title = `検索: ${current}`;
        renderTabs();
        viewEl.innerHTML = `<div class="search-results-page"><p>「${current}」を検索中...</p></div>`;

        const cfg = Storage.getGlobal('oauth_cfg', {});
        if (!cfg.workerUrl) {
          viewEl.innerHTML = `
            <div class="search-results-page">
              <div class="search-result-card">
                <h4>Worker URL が未設定です</h4>
                <p>Web検索結果を取得するには「設定」から Cloudflare Worker URL を保存してください。URLを直接入力すればページ表示は可能です。</p>
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
            viewEl.innerHTML = `<div class="search-results-page"><p>「${current}」の検索結果が見つかりませんでした。</p></div>`;
            return;
          }

          const html = results.map(item => `
            <div class="search-result-card">
              <div style="font-size:0.7rem;color:#94a3b8;margin-bottom:2px;">[${item.source || 'Web'}] ${item.url}</div>
              <h4>${item.title}</h4>
              <p>${item.snippet || ''}</p>
              <div class="search-result-actions">
                <button type="button" class="btn btn-small" data-open-url="${item.url}">OSブラウザで開く</button>
                <a class="btn btn-small" style="background:rgba(255,255,255,0.14);color:#fff;text-decoration:none;" href="${item.url}" target="_blank" rel="noopener">外部タブで開く</a>
              </div>
            </div>
          `).join('');

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
