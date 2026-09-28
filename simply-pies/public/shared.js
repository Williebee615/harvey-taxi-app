// Helpers shared by the customer pages.
(function () {
  'use strict';

  function formatMoney(cents, currency) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'usd').toUpperCase() })
      .format(cents / 100);
  }

  // Stylised pie illustration used until a real photo is added.
  function pieSvg(accent) {
    const color = accent || '#b4731a';
    return `
<svg viewBox="0 0 200 150" aria-hidden="true">
  <ellipse cx="100" cy="118" rx="84" ry="18" fill="#3b2416" opacity="0.12"/>
  <path d="M20 78 L32 112 Q100 134 168 112 L180 78 Z" fill="#c98a3d"/>
  <path d="M32 112 Q100 134 168 112" fill="none" stroke="#a86b28" stroke-width="3"/>
  <g stroke="#b77a33" stroke-width="2" opacity="0.7">
    <line x1="44" y1="86" x2="50" y2="116"/><line x1="64" y1="90" x2="68" y2="122"/>
    <line x1="84" y1="92" x2="86" y2="125"/><line x1="104" y1="92" x2="104" y2="126"/>
    <line x1="124" y1="92" x2="122" y2="125"/><line x1="144" y1="90" x2="140" y2="122"/>
    <line x1="160" y1="86" x2="154" y2="116"/>
  </g>
  <ellipse cx="100" cy="74" rx="86" ry="30" fill="#e2a650"/>
  <ellipse cx="100" cy="70" rx="80" ry="26" fill="#f0bd68"/>
  <path d="M34 70 Q60 56 100 56 Q140 56 166 70" fill="none" stroke="#fbd79a" stroke-width="5" stroke-linecap="round"/>
  <path d="M44 78 Q70 86 100 86 Q130 86 156 78" fill="none" stroke="#d8963f" stroke-width="3" stroke-linecap="round"/>
  <g fill="#c7832f">
    <path d="M86 64 l10 -6 l2 10 z"/><path d="M104 62 l10 4 l-8 7 z"/>
  </g>
  <circle cx="100" cy="68" r="6" fill="${color}" opacity="0.85"/>
</svg>`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const ACTIVE_ORDER_KEY = 'simplyPies.activeOrder';
  function rememberOrder(id, token) {
    try { localStorage.setItem(ACTIVE_ORDER_KEY, JSON.stringify({ id, token, at: Date.now() })); } catch (e) { /* ignore */ }
  }
  function recallOrder() {
    try {
      const saved = JSON.parse(localStorage.getItem(ACTIVE_ORDER_KEY) || 'null');
      if (saved && Date.now() - saved.at < 12 * 60 * 60 * 1000) return saved;
    } catch (e) { /* ignore */ }
    return null;
  }
  function forgetOrder() {
    try { localStorage.removeItem(ACTIVE_ORDER_KEY); } catch (e) { /* ignore */ }
  }

  function renderHeader(business) {
    const ig = document.getElementById('ig-link');
    if (ig && business.instagramHandle) {
      ig.href = `https://instagram.com/${encodeURIComponent(business.instagramHandle)}`;
      ig.textContent = `@${business.instagramHandle}`;
      ig.hidden = false;
    }
  }

  window.SimplyPies = { formatMoney, pieSvg, escapeHtml, rememberOrder, recallOrder, forgetOrder, renderHeader };
})();
