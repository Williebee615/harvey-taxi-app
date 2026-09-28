'use strict';

class CartError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CartError';
  }
}

function cleanText(value, maxLength) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new CartError('Invalid text field.');
  // Strip control characters and collapse whitespace.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

// Builds priced line items from the client's cart using the server-side menu.
function priceCart(rawItems, menu, limits) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new CartError('Your cart is empty.');
  }
  const byId = new Map(menu.map((item) => [item.id, item]));
  const quantities = new Map();
  for (const raw of rawItems) {
    const product = raw && byId.get(raw.id);
    if (!product) throw new CartError('An item in your cart is no longer available.');
    const qty = Number(raw.qty);
    if (!Number.isInteger(qty) || qty < 1) throw new CartError('Invalid quantity.');
    quantities.set(product.id, (quantities.get(product.id) || 0) + qty);
  }

  let totalPies = 0;
  const items = [];
  for (const [id, qty] of quantities) {
    if (qty > limits.maxQuantityPerItem) {
      throw new CartError(`Please order at most ${limits.maxQuantityPerItem} of each pie online.`);
    }
    totalPies += qty;
    const product = byId.get(id);
    items.push({
      id,
      name: product.name,
      qty,
      unitCents: product.priceCents,
      lineCents: product.priceCents * qty,
    });
  }
  if (totalPies > limits.maxPiesPerOrder) {
    throw new CartError(`For orders over ${limits.maxPiesPerOrder} pies, please contact us directly.`);
  }
  const totalCents = items.reduce((sum, item) => sum + item.lineCents, 0);
  return { items, totalPies, totalCents };
}

function validateCustomer(raw) {
  const input = raw || {};
  const name = cleanText(input.name, 60);
  const phone = cleanText(input.phone, 30);
  const vehicle = cleanText(input.vehicle, 80);
  const notes = cleanText(input.notes, 280);
  if (name.length < 2) throw new CartError('Please enter your name.');
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) throw new CartError('Please enter a valid phone number.');
  return { name, phone, vehicle, notes };
}

module.exports = { CartError, cleanText, priceCart, validateCustomer };
