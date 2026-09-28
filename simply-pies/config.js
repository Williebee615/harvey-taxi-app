'use strict';

// Business details and menu for Simply Steak and Chicken Pies.
//
// Every value marked CONFIRM is a placeholder that the owner must verify
// before launch. Blank (null) business fields are hidden on the site
// rather than shown as dummy text, and the server logs a warning at
// startup listing anything still unset (see missingLaunchItems below).

const business = {
  name: 'Simply Steak and Chicken Pies',
  shortName: 'Simply Pies',
  tagline: 'Handmade pies, ready at the curb.',
  instagramHandle: null, // CONFIRM: e.g. 'simplypies' (no @)
  phone: null, // CONFIRM: customer contact number, e.g. '(615) 555-0100'
  email: null, // CONFIRM: customer contact email
  pickupAddress: null, // CONFIRM: full curbside pickup address
  pickupInstructions: null, // CONFIRM: e.g. 'Park in the marked spots out front.'
  hours: null, // CONFIRM: e.g. 'Fri–Sun, 11am–6pm'
  currency: 'usd', // CONFIRM: ISO currency code used by Stripe
};

// Prices are in the smallest currency unit (cents). Every price is a
// placeholder until the owner confirms it. The server computes all totals
// from this list and never trusts prices sent by the browser.
const PRICES_CONFIRMED = false; // CONFIRM: set to true once prices are final

const menu = [
  {
    id: 'pepper-steak',
    name: 'Pepper Steak',
    category: 'Steak',
    description: 'Steak in a peppered gravy.', // CONFIRM wording
    priceCents: 900, // CONFIRM
    image: null, // e.g. 'images/pepper-steak.jpg'
    accent: '#7a3b1d',
  },
  {
    id: 'steak-and-cheese',
    name: 'Steak and Cheese',
    category: 'Steak',
    description: 'Steak with melted cheese.', // CONFIRM wording
    priceCents: 900, // CONFIRM
    image: null,
    accent: '#b7791f',
  },
  {
    id: 'burger-pie',
    name: 'Burger Pie',
    category: 'Steak',
    description: 'Burger-style beef filling.', // CONFIRM wording
    priceCents: 900, // CONFIRM
    image: null,
    accent: '#8c2f1b',
  },
  {
    id: 'chicken-peri-peri',
    name: 'Chicken Peri Peri',
    category: 'Chicken',
    description: 'Chicken in a peri peri sauce.', // CONFIRM wording
    priceCents: 900, // CONFIRM
    image: null,
    accent: '#c2410c',
  },
  {
    id: 'chicken-leek-mushroom',
    name: 'Chicken, Leek and Mushroom',
    category: 'Chicken',
    description: 'Chicken with leeks and mushrooms.', // CONFIRM wording
    priceCents: 900, // CONFIRM
    image: null,
    accent: '#5b6b2f',
  },
];

// The signature points from the development brief, shown on the landing page.
const signature = [
  { title: '4-inch round', body: 'A generous single-serve pie.' },
  { title: 'Short crust base', body: 'A sturdy, crumbly base that holds the filling.' },
  { title: 'Rough puff top', body: 'A flaky, buttery puff pastry lid.' },
];

const limits = {
  maxQuantityPerItem: 20,
  maxPiesPerOrder: 60,
};

function missingLaunchItems() {
  const missing = [];
  for (const key of ['instagramHandle', 'phone', 'pickupAddress', 'hours']) {
    if (!business[key]) missing.push(`business.${key}`);
  }
  if (!PRICES_CONFIRMED) missing.push('menu prices (PRICES_CONFIRMED is false)');
  return missing;
}

module.exports = { business, menu, signature, limits, missingLaunchItems };
