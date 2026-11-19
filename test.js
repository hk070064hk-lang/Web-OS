// スタートボタン強制バインド＆診断用コード
document.addEventListener('DOMContentLoaded', () => {
  const startMenu = document.getElementById('start-menu');

  // 1. 既存の #btn-start だけでなく、「スタート」という文字や start を含む要素も探す
  const candidates = [
    document.getElementById('btn-start'),
    document.querySelector('[data-action="start"]'),
    document.querySelector('.start-btn'),
    ...Array.from(document.querySelectorAll('button, div, span')).filter(el => {
      const t = (el.textContent || '').trim();
      return t === 'スタート' || t === 'Start';
    })
  ].filter(Boolean);

  console.log('スタートボタン候補:', candidates);
  console.log('start-menu要素:', startMenu);

  const toggleMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!startMenu) {
      alert('start-menu が見つかりません。HTML側のIDを確認してください。');
      return;
    }
    const isHidden = startMenu.classList.contains('hidden') || getComputedStyle(startMenu).display === 'none';
    if (isHidden) {
      startMenu.classList.remove('hidden');
      startMenu.style.display = 'block';
      startMenu.style.zIndex = '99999';
    } else {
      startMenu.classList.add('hidden');
      startMenu.style.display = 'none';
    }
  };

  candidates.forEach(btn => {
    btn.style.pointerEvents = 'auto';
    btn.style.position = btn.style.position || 'relative';
    btn.style.zIndex = '99998';
    btn.addEventListener('click', toggleMenu, true);
  });

  // 2. 画面上で一番手前にある要素を調べる（重なり・透明オーバーレイ確認用）
  document.addEventListener('click', (e) => {
    const topEl = document.elementFromPoint(e.clientX, e.clientY);
    console.log('クリック座標の最前面要素:', topEl, '元ターゲット:', e.target);
  }, true);
});
