(function () {
  'use strict';
  const { formatMoney, pieSvg, escapeHtml, recallOrder, renderHeader } = window.SimplyPies;
  const CART_KEY = 'simplyPies.cart';

  let config;
  const cart = new Map(); // id -> qty

  const $ = (id) => document.getElementById(id);

  function saveCart() {
    try { sessionStorage.setItem(CART_KEY, JSON.stringify([...cart])); } catch (e) { /* ignore */ }
  }
  function loadCart() {
    try {
      for (const [id, qty] of JSON.parse(sessionStorage.getItem(CART_KEY) || '[]')) {
        if (config.menu.some((p) => p.id === id) && qty > 0) cart.set(id, qty);
      }
    } catch (e) { /* ignore */ }
  }

  function money(cents) { return formatMoney(cents, config.business.currency); }

  function addNotice(text, kind) {
    const p = document.createElement('p');
    p.className = `notice${kind ? ` ${kind}` : ''}`;
    p.textContent = text;
    $('notices').appendChild(p);
    return p;
  }

  function renderSignature() {
    $('signature').innerHTML = config.signature
      .map((s) => `<li><strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.body)}</span></li>`)
      .join('');
  }

  function renderMenu() {
    $('menu').innerHTML = config.menu.map((pie) => `
      <article class="pie-card" data-id="${escapeHtml(pie.id)}">
        <div class="pie-media">
          ${pie.image
            ? `<img src="${escapeHtml(pie.image)}" alt="${escapeHtml(pie.name)} pie" loading="lazy" width="1200" height="900">`
            : pieSvg(pie.accent)}
          <span class="pie-tag">${escapeHtml(pie.category)}</span>
        </div>
        <div class="pie-body">
          <div class="pie-row">
            <h3 class="pie-name">${escapeHtml(pie.name)}</h3>
            <span class="pie-price">${money(pie.priceCents)}</span>
          </div>
          <p class="pie-desc">${escapeHtml(pie.description)}</p>
          <div class="pie-actions" data-actions></div>
        </div>
      </article>`).join('');
    for (const card of $('menu').querySelectorAll('.pie-card')) renderActions(card);
  }

  function renderActions(card) {
    const id = card.dataset.id;
    const pie = config.menu.find((p) => p.id === id);
    const qty = cart.get(id) || 0;
    const box = card.querySelector('[data-actions]');
    if (qty === 0) {
      box.innerHTML = `<button class="btn" type="button" data-add>Add to order</button>`;
      box.querySelector('[data-add]').onclick = () => setQty(id, 1);
    } else {
      box.innerHTML = `
        <div class="stepper" role="group" aria-label="${escapeHtml(pie.name)} quantity">
          <button type="button" data-dec aria-label="Remove one">−</button>
          <output aria-live="polite">${qty}</output>
          <button type="button" data-inc aria-label="Add one">+</button>
        </div>`;
      box.querySelector('[data-dec]').onclick = () => setQty(id, qty - 1);
      box.querySelector('[data-inc]').onclick = () => setQty(id, qty + 1);
    }
  }

  function setQty(id, qty) {
    const clamped = Math.max(0, Math.min(qty, config.limits.maxQuantityPerItem));
    if (clamped === 0) cart.delete(id); else cart.set(id, clamped);
    saveCart();
    const card = $('menu').querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (card) renderActions(card);
    renderCart();
  }

  function cartTotals() {
    let pies = 0;
    let cents = 0;
    for (const [id, qty] of cart) {
      const pie = config.menu.find((p) => p.id === id);
      pies += qty;
      cents += pie.priceCents * qty;
    }
    return { pies, cents };
  }

  function renderCart() {
    const { pies, cents } = cartTotals();
    $('cart-bar').hidden = pies === 0;
    $('cart-count').textContent = pies;
    $('cart-total').textContent = money(cents);
    $('sheet-total').textContent = money(cents);
    $('cart-lines').innerHTML = [...cart].map(([id, qty]) => {
      const pie = config.menu.find((p) => p.id === id);
      return `<li data-id="${escapeHtml(id)}">
          <div><div class="name">${escapeHtml(pie.name)}</div><div class="sub">${money(pie.priceCents)} each</div></div>
          <div class="stepper" role="group" aria-label="${escapeHtml(pie.name)} quantity">
            <button type="button" data-dec aria-label="Remove one">−</button>
            <output>${qty}</output>
            <button type="button" data-inc aria-label="Add one">+</button>
          </div>
        </li>`;
    }).join('');
    for (const li of $('cart-lines').querySelectorAll('li')) {
      const id = li.dataset.id;
      li.querySelector('[data-dec]').onclick = () => setQty(id, (cart.get(id) || 0) - 1);
      li.querySelector('[data-inc]').onclick = () => setQty(id, (cart.get(id) || 0) + 1);
    }
    if (pies === 0 && $('cart-sheet').open) $('cart-sheet').close();
  }

  function renderFooter() {
    const b = config.business;
    const lines = [`<strong>${escapeHtml(b.name)}</strong>`];
    if (b.pickupAddress) lines.push(`<span>Pickup: ${escapeHtml(b.pickupAddress)}</span>`);
    if (b.hours) lines.push(`<span>Hours: ${escapeHtml(b.hours)}</span>`);
    if (b.phone) lines.push(`<span>Call or text: <a href="tel:${escapeHtml(b.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(b.phone)}</a></span>`);
    if (b.email) lines.push(`<span><a href="mailto:${escapeHtml(b.email)}">${escapeHtml(b.email)}</a></span>`);
    lines.push(`<span>© ${new Date().getFullYear()} ${escapeHtml(b.name)}</span>`);
    $('footer').innerHTML = lines.join('');
  }

  async function checkout(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const error = $('form-error');
    error.textContent = '';
    const customer = {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      vehicle: form.vehicle.value.trim(),
      notes: form.notes.value.trim(),
    };
    if (customer.name.length < 2) { error.textContent = 'Please enter your name.'; form.name.focus(); return; }
    if (customer.phone.replace(/\D/g, '').length < 7) { error.textContent = 'Please enter a valid phone number.'; form.phone.focus(); return; }

    const button = $('pay-btn');
    button.disabled = true;
    button.textContent = 'Starting secure checkout…';
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [...cart].map(([id, qty]) => ({ id, qty })), customer }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      try { sessionStorage.removeItem(CART_KEY); } catch (e) { /* ignore */ }
      window.location.href = data.redirectUrl;
    } catch (err) {
      error.textContent = err.message;
      button.disabled = false;
      button.textContent = 'Continue to secure payment';
    }
  }

  async function init() {
    try {
      const res = await fetch('/api/config');
      config = await res.json();
    } catch (err) {
      addNotice('We could not load the menu. Please refresh the page.', 'warn');
      return;
    }
    renderHeader(config.business);
    loadCart();
    renderSignature();
    renderMenu();
    renderCart();
    renderFooter();

    if (config.demoPayments) {
      addNotice('Preview mode: orders go straight to the kitchen and no payment is taken.');
      $('pay-btn').textContent = 'Place preview order';
      $('pay-note').textContent = 'Preview mode. Live checkout uses Stripe for card, Apple Pay and Google Pay.';
    } else if (!config.paymentsReady) {
      addNotice('Online ordering opens soon. You can browse the menu in the meantime.', 'warn');
      $('pay-btn').disabled = true;
    }
    if (new URLSearchParams(location.search).get('cancelled')) {
      addNotice('Checkout was cancelled and you have not been charged. Your order is still here.');
      history.replaceState(null, '', '/');
    }
    const active = recallOrder();
    if (active) {
      const link = document.createElement('a');
      link.className = 'resume-link';
      link.href = `/order?id=${encodeURIComponent(active.id)}&t=${encodeURIComponent(active.token)}`;
      link.textContent = 'You have an order in progress. Open it →';
      $('notices').appendChild(link);
    }

    $('open-cart').onclick = () => $('cart-sheet').showModal();
    $('close-cart').onclick = () => $('cart-sheet').close();
    $('cart-sheet').addEventListener('click', (e) => { if (e.target === $('cart-sheet')) $('cart-sheet').close(); });
    $('checkout-form').addEventListener('submit', checkout);
  }

  init();
})();
