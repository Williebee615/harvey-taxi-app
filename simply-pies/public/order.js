(function () {
  'use strict';
  const { formatMoney, escapeHtml, rememberOrder, forgetOrder } = window.SimplyPies;
  const $ = (id) => document.getElementById(id);

  const params = new URLSearchParams(location.search);
  const orderId = params.get('id');
  const token = params.get('t');
  const query = `t=${encodeURIComponent(token || '')}`;
  let business = {};
  let polling = false;
  let pollTimer;
  let wakeLock;
  let latestStatus;

  const COPY = {
    pending_payment: ['Confirming your payment', 'This usually takes a few seconds.'],
    paid: ['Order received', 'We’ve got your order and will start on it shortly.'],
    preparing: ['We’re preparing your pies', 'Head over whenever you’re ready.'],
    ready: ['Your order is ready', 'Tap “I’ve Arrived” when you’re parked outside.'],
    completed: ['Enjoy your pies!', 'This order has been picked up. Thank you for ordering with us.'],
    cancelled: ['Order cancelled', 'Please contact us if you have any questions about this order.'],
    expired: ['Payment not completed', 'This checkout expired before payment went through. You have not been charged.'],
  };
  const STEPS = ['paid', 'preparing', 'ready'];

  function render(order) {
    latestStatus = order.status;
    const [headline, sub] = COPY[order.status] || ['Your order', ''];
    $('order-num').textContent = `Order #${order.number}`;
    $('headline').textContent = order.status === 'paid' ? `Thanks, ${order.firstName}!` : headline;
    $('subline').textContent = sub;
    document.title = `Order #${order.number}: ${headline}`;

    const stepIndex = STEPS.indexOf(order.status);
    const showTracker = stepIndex >= 0;
    $('tracker').hidden = !showTracker;
    for (const li of $('tracker').children) {
      const i = STEPS.indexOf(li.dataset.step);
      li.className = i < stepIndex || (i === stepIndex && order.status === 'ready') ? 'done' : i === stepIndex ? 'current done' : '';
    }

    const active = showTracker;
    $('arrive-section').hidden = !active || Boolean(order.arrivedAt);
    $('arrived-box').hidden = !active || !order.arrivedAt;
    if (order.arrivedAt) {
      $('arrived-text').textContent = order.status === 'ready'
        ? 'Your order is ready. We’re bringing it out to you now.'
        : 'The kitchen has been notified. We’ll bring your order out as soon as it’s ready.';
    }

    $('summary-card').hidden = order.status === 'pending_payment' || order.status === 'expired';
    $('summary').innerHTML = order.items
      .map((i) => `<li><span>${i.qty} × ${escapeHtml(i.name)}</span><span>${formatMoney(i.lineCents, order.currency)}</span></li>`)
      .join('');
    $('summary-total').textContent = formatMoney(order.totalCents, order.currency);

    if (active) rememberOrder(orderId, token); else forgetOrder();
    if (order.status === 'completed' || order.status === 'cancelled' || order.status === 'expired') stopLive();
  }

  function renderPickup() {
    const lines = [];
    if (business.pickupAddress) {
      const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(business.pickupAddress)}`;
      lines.push(`<p style="margin:0 0 6px"><strong>${escapeHtml(business.pickupAddress)}</strong></p>`);
      lines.push(`<p style="margin:0 0 10px"><a href="${maps}" target="_blank" rel="noopener">Open in Maps</a></p>`);
    }
    if (business.pickupInstructions) lines.push(`<p style="margin:0 0 6px">${escapeHtml(business.pickupInstructions)}</p>`);
    if (business.phone) {
      lines.push(`<p style="margin:0">Need help? <a href="tel:${escapeHtml(business.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(business.phone)}</a></p>`);
    }
    if (business.email) {
      lines.push(`<p style="margin:0">Questions? <a href="mailto:${escapeHtml(business.email)}">${escapeHtml(business.email)}</a></p>`);
    }
    $('pickup').innerHTML = lines.join('');
    $('pickup-card').hidden = lines.length === 0;
  }

  async function fetchOrder() {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}?${query}`);
    if (!res.ok) throw new Error('not-found');
    return (await res.json()).order;
  }

  function setLive(on) {
    $('live').className = on ? 'live-dot' : 'live-dot off';
    $('live').textContent = on ? 'Live' : 'Reconnecting';
  }

  // Checks for updates every few seconds. While payment is confirming, the
  // server also checks Stripe on each request.
  async function poll() {
    clearTimeout(pollTimer);
    if (!polling) return;
    try {
      render(await fetchOrder());
      setLive(true);
    } catch (e) {
      setLive(false);
    }
    if (polling) pollTimer = setTimeout(poll, latestStatus === 'pending_payment' ? 2500 : 4000);
  }

  function startLive() {
    polling = true;
    pollTimer = setTimeout(poll, 2500);
  }

  function stopLive() {
    polling = false;
    clearTimeout(pollTimer);
    $('live').hidden = true;
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  // Keep the screen on so the page stays live during the drive over.
  async function keepAwake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || !polling) return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not critical */ }
  }

  async function arrive() {
    const button = $('arrive-btn');
    button.disabled = true;
    $('arrive-error').textContent = '';
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/arrived`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token, note: $('arrival-note').value.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not reach the kitchen. Please try again.');
      if (navigator.vibrate) navigator.vibrate(120);
      render(data.order);
    } catch (err) {
      $('arrive-error').textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  async function init() {
    if (!orderId || !token) {
      $('order-num').textContent = '';
      $('headline').textContent = 'Order not found';
      $('subline').innerHTML = 'Please use the link from your checkout. <a href="/">Back to the menu</a>';
      return;
    }
    $('arrive-btn').addEventListener('click', arrive);
    fetch('/api/config').then((r) => r.json()).then((c) => { business = c.business; renderPickup(); }).catch(() => {});
    try {
      render(await fetchOrder());
      setLive(true);
    } catch (err) {
      forgetOrder();
      $('order-num').textContent = '';
      $('headline').textContent = 'Order not found';
      $('subline').innerHTML = 'This link may be incomplete. <a href="/">Back to the menu</a>';
      $('live').hidden = true;
      return;
    }
    if (params.has('session_id')) history.replaceState(null, '', `/order?id=${encodeURIComponent(orderId)}&t=${encodeURIComponent(token)}`);
    if (!['completed', 'cancelled', 'expired'].includes(latestStatus)) {
      startLive();
      keepAwake();
    }
    document.addEventListener('visibilitychange', () => {
      keepAwake();
      if (document.visibilityState === 'visible') poll(); // catch up after the phone was locked
    });
  }

  init();
})();
