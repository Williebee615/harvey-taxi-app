(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const orders = new Map(); // id -> order
  const acknowledged = new Set(); // arrival alerts the staff have dismissed
  let seeded = false;
  let soundOn = true;
  let audio;
  let pollTimer;
  let wakeLock;
  let alarmTimer;
  let titleTimer;

  function show(section) {
    for (const id of ['login', 'start', 'board']) $(id).hidden = id !== section;
    $('tools').hidden = section !== 'board';
  }

  // ---- Sound -------------------------------------------------------------
  function tone(freq, start, duration, volume) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, audio.currentTime + start);
    gain.gain.exponentialRampToValueAtTime(volume, audio.currentTime + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(audio.currentTime + start);
    osc.stop(audio.currentTime + start + duration + 0.05);
  }
  function chimeNewOrder() {
    if (!soundOn || !audio) return;
    tone(660, 0, 0.35, 0.35);
    tone(880, 0.18, 0.5, 0.35);
  }
  function alarmArrival() {
    if (!soundOn || !audio) return;
    for (let i = 0; i < 3; i++) {
      tone(988, i * 0.45, 0.2, 0.6);
      tone(1319, i * 0.45 + 0.2, 0.22, 0.6);
    }
  }

  // ---- Alerts ------------------------------------------------------------
  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body, icon: 'logo.svg', tag: title, requireInteraction: true }); } catch (e) { /* ignore */ }
  }

  function pendingArrivals() {
    return [...orders.values()].filter((o) => o.arrivedAt && isActive(o) && !acknowledged.has(o.id));
  }

  function refreshAlerts() {
    const waiting = pendingArrivals();
    const banner = $('arrival-banner');
    if (waiting.length) {
      banner.hidden = false;
      banner.textContent = `🚗 ${waiting.map((o) => `#${o.number} ${o.customer.name}`).join(', ')} ${waiting.length === 1 ? 'is' : 'are'} outside. Tap to acknowledge.`;
      if (!alarmTimer) alarmTimer = setInterval(alarmArrival, 15000);
      if (!titleTimer) {
        let flip = false;
        titleTimer = setInterval(() => { document.title = (flip = !flip) ? '🚗 CUSTOMER OUTSIDE' : 'Kitchen Dashboard'; }, 1000);
      }
    } else {
      banner.hidden = true;
      clearInterval(alarmTimer); alarmTimer = null;
      clearInterval(titleTimer); titleTimer = null;
      document.title = 'Kitchen Dashboard — Simply Pies';
    }
  }

  function onUpdate(next) {
    const prev = orders.get(next.id);
    orders.set(next.id, next);
    if (!seeded) return;
    if (!prev && next.status === 'paid') {
      chimeNewOrder();
      notify(`New order #${next.number}`, `${next.totalPies} pie${next.totalPies === 1 ? '' : 's'} for ${next.customer.name}`);
    }
    if (next.arrivedAt && (!prev || !prev.arrivedAt) && isActive(next)) {
      alarmArrival();
      if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
      notify(`#${next.number} is outside`, `${next.customer.name}${next.customer.vehicle ? ` · ${next.customer.vehicle}` : ''}${next.arrivalNote ? ` · ${next.arrivalNote}` : ''}`);
    }
  }

  // ---- Rendering ---------------------------------------------------------
  function isActive(o) { return o.status === 'paid' || o.status === 'preparing' || o.status === 'ready'; }

  function ago(iso) {
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function actionsFor(order) {
    switch (order.status) {
      case 'paid': return [['preparing', 'Start preparing', 'k-btn-primary'], ['ready', 'Mark ready', '']];
      case 'preparing': return [['ready', 'Mark ready', 'k-btn-primary']];
      case 'ready': return [['completed', 'Handed over', 'k-btn-ok']];
      default: return [];
    }
  }

  function card(order) {
    const node = $('card-tpl').content.firstElementChild.cloneNode(true);
    node.querySelector('.k-num').textContent = `#${order.number}`;
    node.querySelector('.k-time').textContent = ago(order.paidAt || order.createdAt);
    node.querySelector('.k-name').textContent = order.customer.name;
    const list = node.querySelector('.k-items');
    for (const item of order.items) {
      const li = document.createElement('li');
      const qty = document.createElement('b');
      qty.textContent = `${item.qty}×`;
      li.append(qty, ` ${item.name}`);
      list.appendChild(li);
    }
    const meta = [];
    if (order.customer.vehicle) meta.push(`Car: ${order.customer.vehicle}`);
    if (order.customer.phone) meta.push(`Phone: ${order.customer.phone}`);
    if (order.customer.notes) meta.push(`Note: ${order.customer.notes}`);
    if (order.status === 'cancelled') meta.push('Cancelled. Refund in Stripe if payment was taken.');
    node.querySelector('.k-meta').textContent = meta.join('\n');

    if (order.arrivedAt && isActive(order)) {
      node.classList.add('is-arrived');
      const flag = node.querySelector('.k-arrived');
      flag.hidden = false;
      flag.textContent = `OUTSIDE since ${ago(order.arrivedAt)}${order.arrivalNote ? `: ${order.arrivalNote}` : ''}`;
    }
    if (!isActive(order)) node.classList.add('is-done');

    const actions = node.querySelector('.k-actions');
    for (const [status, label, cls] of actionsFor(order)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `k-btn ${cls}`;
      b.textContent = label;
      b.onclick = () => setStatus(order, status, b);
      actions.appendChild(b);
    }
    if (isActive(order)) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'k-btn k-btn-danger';
      cancel.textContent = 'Cancel';
      cancel.onclick = () => {
        if (confirm(`Cancel order #${order.number}? This does not refund the customer. Issue any refund in Stripe.`)) setStatus(order, 'cancelled', cancel);
      };
      actions.appendChild(cancel);
    }
    return node;
  }

  function render() {
    const all = [...orders.values()].sort((a, b) => a.number - b.number);
    const columns = {
      arrived: all.filter((o) => isActive(o) && o.arrivedAt),
      paid: all.filter((o) => o.status === 'paid' && !o.arrivedAt),
      preparing: all.filter((o) => o.status === 'preparing' && !o.arrivedAt),
      ready: all.filter((o) => o.status === 'ready' && !o.arrivedAt),
      done: all.filter((o) => !isActive(o)).reverse(),
    };
    for (const [key, list] of Object.entries(columns)) {
      const col = document.querySelector(`[data-col="${key}"]`);
      col.querySelector('.k-count').textContent = list.length;
      col.classList.toggle('empty', list.length === 0);
      const box = col.querySelector('.k-list');
      box.replaceChildren(...list.map(card));
      if (!list.length && key !== 'arrived') {
        const p = document.createElement('p');
        p.className = 'k-empty';
        p.textContent = key === 'done' ? 'Nothing yet.' : 'No orders.';
        box.appendChild(p);
      }
    }
    refreshAlerts();
  }

  async function setStatus(order, status, button) {
    button.disabled = true;
    try {
      const res = await fetch(`/api/kitchen/orders/${encodeURIComponent(order.id)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) return location.reload();
      if (!res.ok) throw new Error(data.error || 'Update failed.');
      onUpdate(data.order);
      render();
    } catch (err) {
      alert(err.message);
      button.disabled = false;
    }
  }

  // ---- Live updates ----------------------------------------------------
  // Checks for new orders and arrivals every few seconds. Alerts fire for
  // anything that changed since the last check, including after a dropped
  // connection.
  function setLive(on) {
    $('live').className = on ? 'k-live' : 'k-live off';
    $('live').textContent = on ? 'Live' : 'Reconnecting';
  }

  async function poll() {
    clearTimeout(pollTimer);
    try {
      const res = await fetch('/api/kitchen/orders', { cache: 'no-store' });
      if (res.status === 401) { show('login'); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { orders: list } = await res.json();
      const ids = new Set(list.map((o) => o.id));
      for (const id of [...orders.keys()]) if (!ids.has(id)) orders.delete(id);
      for (const o of list) onUpdate(o);
      seeded = true;
      setLive(true);
      render();
    } catch (err) {
      setLive(false);
    }
    pollTimer = setTimeout(poll, 3000);
  }

  async function keepAwake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not critical */ }
  }

  function startShift() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) { audio = new Ctx(); audio.resume(); tone(880, 0, 0.15, 0.2); }
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    keepAwake();
    document.addEventListener('visibilitychange', keepAwake);
    show('board');
    poll();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
    setInterval(render, 30000); // refresh the "x min ago" labels
  }

  async function init() {
    $('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('login-error').textContent = '';
      const res = await fetch('/api/kitchen/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: $('passcode').value }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) { $('login-error').textContent = data.error || 'Could not sign in.'; return; }
      $('passcode').value = '';
      show('start');
    });
    $('start-btn').addEventListener('click', startShift);
    $('sound-btn').addEventListener('click', () => {
      soundOn = !soundOn;
      $('sound-btn').textContent = soundOn ? 'Sound on' : 'Sound off';
      if (soundOn) chimeNewOrder();
    });
    $('logout-btn').addEventListener('click', async () => {
      await fetch('/api/kitchen/logout', { method: 'POST' }).catch(() => {});
      location.reload();
    });
    $('arrival-banner').addEventListener('click', () => {
      for (const o of pendingArrivals()) acknowledged.add(o.id);
      refreshAlerts();
    });

    const res = await fetch('/api/kitchen/orders').catch(() => null);
    if (res && res.ok) show('start');
    else if (res && res.status === 503) {
      show('login');
      $('login-form').innerHTML = '<h1>Not set up yet</h1><p>Set the KITCHEN_PASSCODE environment variable on the server to enable this dashboard.</p>';
    } else show('login');
  }

  init();
})();
