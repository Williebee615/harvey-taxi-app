// Nashville destination pages (owner decision 2026-10-23): one
// server-rendered page per destination plus a hub, so search engines see
// real HTML at a real URL. Content is transportation logistics only.
//
// Every venue fact comes from the venue's (or Metro Nashville's) own
// website, found by search on 2026-10-23; the page cites each source and
// tells riders to confirm on the day. Where official sources disagree or
// say nothing, the page says so instead of guessing. No airport (BNA)
// page and no airport claims (standing owner rule). No fixed fares: the
// page links to a live estimate in the booking screen.
//
// Pure: no I/O. Travel times are passed in by the server (Mapbox, cached).

const CHECKED_ON = "2026-10-23";
const SITE = "https://harveytaxiservice.com";

// Starting points for the travel-time table. Labels are neighbourhoods;
// the address is only what the route is measured from.
const ORIGINS = Object.freeze([
  { id: "downtown", label: "Downtown (Nashville Public Library)", address: "615 Church Street, Nashville, TN 37219" },
  { id: "midtown", label: "Midtown (West End Avenue)", address: "2100 West End Avenue, Nashville, TN 37203" },
  { id: "east", label: "East Nashville (Five Points)", address: "1000 Woodland Street, Nashville, TN 37206" }
]);

const DESTINATIONS = Object.freeze([
  {
    slug: "broadway-downtown",
    name: "Lower Broadway & Downtown",
    category: "District",
    address: "Lower Broadway, Nashville, TN 37203",
    summary: "Rides to and from Lower Broadway's honky-tonks and downtown Nashville without hunting for parking.",
    dropoff: [
      "Lower Broadway between 1st and 5th Avenues is crowded with pedestrians, especially late at night. Metro Nashville cites hazardous conditions near Broadway entertainment venues as the reason for its rideshare-zone work.",
      "Metro's Traffic & Parking Commission has reviewed a Downtown Rideshare Program with 23 pickup and drop-off zones in existing loading zones and metered spaces (proposed hours Thursday to Sunday, 5 PM to 4 AM, three-minute limit). We could not confirm whether it has been approved; follow posted signs.",
      "Setting your pickup pin on a side street a block off Broadway usually makes it easier for your driver to reach you."
    ],
    accessibility: [
      "If you use a wheelchair or need extra time getting in, add a note for your driver when you book."
    ],
    parking: [
      "Downtown parking is paid garages, surface lots and meters. A ride avoids garage fees and the walk back late at night."
    ],
    sources: [
      { label: "Metro Nashville: Rideshare Zone Pilot Program", url: "https://www.nashville.gov/departments/transportation/plans-and-programs/transportation-demand/rideshare-pilot" },
      { label: "Metro Traffic & Parking Commission staff analysis (April 2026)", url: "https://www.nashville.gov/sites/default/files/2026-04/TPC_StaffAnalysis_APR2026.pdf" }
    ],
    related: ["ryman-auditorium", "bridgestone-arena", "nissan-stadium"]
  },
  {
    slug: "ryman-auditorium",
    name: "Ryman Auditorium",
    category: "Venue",
    address: "116 Rep. John Lewis Way North, Nashville, TN 37219",
    summary: "Rides to shows and tours at the Ryman Auditorium, half a block off Broadway.",
    dropoff: [
      "The Ryman is between Fourth and Fifth Avenues, half a block north of Broadway. The entrance is on the Fourth Avenue side of the building, so ask to be dropped on that side.",
      "The Ryman does not publish a specific rideshare drop-off or pickup spot. After the show, set your pickup pin a short walk away from the Broadway crowds."
    ],
    accessibility: [
      "The Ryman handles accessible seating and services through a contact form on its Accessibility page. Some parts of the tour may not be accessible to guests with mobility difficulties, according to the venue."
    ],
    parking: [
      "The Ryman has no public parking lot. It points drivers to the Fifth + Broadway garage across the street and to other paid lots and meters nearby."
    ],
    sources: [
      { label: "Ryman: Directions, Parking & Transportation", url: "https://www.ryman.com/plan-your-visit/know-before-you-go/directions-parking-transportation" },
      { label: "Ryman: Accessibility", url: "https://www.ryman.com/accessibility" }
    ],
    related: ["broadway-downtown", "bridgestone-arena"]
  },
  {
    slug: "bridgestone-arena",
    name: "Bridgestone Arena",
    category: "Venue",
    address: "501 Broadway, Nashville, TN 37203",
    summary: "Rides to Predators games and concerts at Bridgestone Arena.",
    dropoff: [
      "The arena lists its rideshare and guest drop-off in the eastbound curb lane of Broadway between 6th and 5th Avenues.",
      "Event traffic and street closures change on busy nights. Follow posted signs and staff directions."
    ],
    accessibility: [
      "Accessible entrances listed by the arena: the main entrance at 5th and Broadway, the SoBro entrance at 5th and Demonbreun, and the entry points from the 6th Avenue Garage.",
      "The southwest elevator is next to the 6th Avenue garage entrance. Accessible seating is on all levels."
    ],
    parking: [
      "Official garages include Fifth + Broadway (across from the arena) and 222 2nd Ave; accessible parking stalls are in the 6th Avenue Garage for placard or plate holders. Event parking is paid, and a ride skips the garage exit line."
    ],
    sources: [
      { label: "Bridgestone Arena: Directions & Parking", url: "https://www.bridgestonearena.com/plan-your-visit/directions-parking" },
      { label: "Bridgestone Arena: Accessibility", url: "https://www.bridgestonearena.com/accessibility" },
      { label: "Bridgestone Arena: Arena Policies (guest drop-off point)", url: "https://www.bridgestonearena.com/arena-info/arena-policies" }
    ],
    related: ["broadway-downtown", "ryman-auditorium", "nissan-stadium"]
  },
  {
    slug: "grand-ole-opry",
    name: "Grand Ole Opry",
    category: "Venue",
    address: "600 Opry Mills Drive, Nashville, TN 37214",
    summary: "Rides to evening shows and tours at the Grand Ole Opry House.",
    dropoff: [
      "For shows, the Opry asks guests to use the doors along the front of the building.",
      "The Opry does not publish a specific rideshare zone. The Opry House sits in the Opry complex with Opry Mills, so check the address in the app before you confirm."
    ],
    accessibility: [
      "The Opry lends wheelchairs free, first come, first served, with a valid photo ID. Wheelchair-accessible seating is on the upper and lower levels, and FM assistive listening devices are at the Tour Desk in the lobby."
    ],
    parking: [
      "Paid parking is run by Metropolis, booked in advance, and available for evening shows from 5 PM, according to the Opry. A ride avoids the post-show exit from the lot."
    ],
    sources: [
      { label: "Opry: Directions, Parking & Transportation", url: "https://www.opry.com/plan-your-visit/opry-house/directions-parking-transportation" },
      { label: "Opry: Accessibility", url: "https://www.opry.com/accessibility" },
      { label: "Opry: Parking", url: "https://www.opry.com/plan-your-visit/parking" }
    ],
    related: ["opry-mills", "gaylord-opryland"]
  },
  {
    slug: "opry-mills",
    name: "Opry Mills",
    category: "Shopping",
    address: "433 Opry Mills Drive, Nashville, TN 37214",
    summary: "Rides to and from Opry Mills shopping, dining and the cinema.",
    dropoff: [
      "Opry Mills lists a ride-share pick-up and drop-off zone on its website but does not give its exact location there. Use the mall's map or signs when you arrive.",
      "The mall has numbered entries (for example Entry 2 by the valet stand). Naming your entry in a note helps your driver find you."
    ],
    accessibility: [
      "If you need help getting to the car, add a note for your driver when you book."
    ],
    parking: [
      "Paid Up Front Plus parking is at the mall entrances, with prices that vary by day and time; valet is at Entry 2."
    ],
    sources: [
      { label: "Opry Mills (Simon): About and directions", url: "https://www.simon.com/mall/opry-mills/about" },
      { label: "Opry Mills (Simon): Valet parking", url: "https://www.simon.com/mall/opry-mills/stores/valet-parking" }
    ],
    related: ["grand-ole-opry", "gaylord-opryland"]
  },
  {
    slug: "gaylord-opryland",
    name: "Gaylord Opryland Resort",
    category: "Resort",
    address: "2800 Opryland Drive, Nashville, TN 37214",
    summary: "Rides to Gaylord Opryland Resort and Convention Center for stays, conventions and holiday events.",
    dropoff: [
      "The resort's meeting planner map shows a taxi and rideshare pickup area near the Magnolia section, separate from the shuttle pickup at the Cascades Portico. Confirm with the front desk on arrival.",
      "The resort is large; tell your driver which entrance or ballroom you are heading to."
    ],
    accessibility: [
      "If you need extra time or help with luggage, add a note for your driver when you book."
    ],
    parking: [
      "The resort charges daily self-parking and valet fees; Marriott's listings show different rates, so check the current rate before you drive."
    ],
    sources: [
      { label: "Marriott: Gaylord Opryland Resort details", url: "https://www.marriott.com/en-us/hotels/bnago-gaylord-opryland-resort-and-convention-center/details/" },
      { label: "Gaylord Opryland meeting planning guide (property map)", url: "https://www.marriott.com/content/dam/marriott-digital/ge/us-canada/hws/b/bnago/en_us/document/assets/ge-bnago-gaylordmeetingplanner-37784.pdf" }
    ],
    related: ["grand-ole-opry", "opry-mills"]
  },
  {
    slug: "nissan-stadium",
    name: "Nissan Stadium",
    category: "Venue",
    address: "One Titans Way, Nashville, TN 37213",
    summary: "Rides to Titans games, Nashville SC matches and stadium concerts.",
    dropoff: [
      "The stadium's transportation guide lists two rideshare zones: Crutcher Street on the south end and Gay Street on the north end, across the Woodland Street bridge.",
      "Older event pages name different spots, and zones can change by event. Check the event page and follow posted signs on the day."
    ],
    accessibility: [
      "The ADA drop-off and pick-up is in Lot T and needs a stadium-issued ADA Lane pass, which does not include parking. Fan Services staff can help with wheelchair pick-up and drop-off on event days."
    ],
    parking: [
      "Stadium lots are paid and fill up on game days. A ride drops you at the rideshare zone instead."
    ],
    sources: [
      { label: "Nissan Stadium: Parking & Transportation Guide", url: "https://nissanstadium.com/transportation/" },
      { label: "Nissan Stadium: Accessibility & ADA Services", url: "https://nissanstadium.com/accessibility/" },
      { label: "Nissan Stadium: Contact (address)", url: "https://nissanstadium.com/contact/" }
    ],
    related: ["broadway-downtown", "bridgestone-arena"]
  },
  {
    slug: "nashville-zoo",
    name: "Nashville Zoo at Grassmere",
    category: "Family",
    address: "3777 Nolensville Pike, Nashville, TN 37211",
    summary: "Family rides to the Nashville Zoo at Grassmere off Nolensville Pike.",
    dropoff: [
      "The zoo does not publish a rideshare zone. Ask to be dropped at the main entrance from the parking area."
    ],
    accessibility: [
      "Manual wheelchairs and electric scooters can be rented at the zoo entrance, first come, first served; personal wheelchairs are welcome. Leashed, trained service dogs are welcome; tell staff at the entrance.",
      "On busy days the zoo opens an unpaved overflow lot and suggests the main lot for strollers and wheelchairs that aren't all-terrain."
    ],
    parking: [
      "The zoo charges a per-vehicle parking fee (members park free). Its pages show different amounts, so check before you go."
    ],
    sources: [
      { label: "Nashville Zoo: Accessibility", url: "https://www.nashvillezoo.org/accessibility" },
      { label: "Nashville Zoo: Hours & Directions", url: "https://www.nashvillezoo.org/hours-directions" },
      { label: "Nashville Zoo: Visit", url: "https://www.nashvillezoo.org/visit" }
    ],
    related: ["broadway-downtown"]
  },
  {
    slug: "vanderbilt-medical-center",
    name: "Vanderbilt University Medical Center",
    category: "Medical",
    address: "1211 Medical Center Drive, Nashville, TN 37232",
    summary: "Rides to appointments and visits at Vanderbilt University Medical Center. Not for emergencies: call 911.",
    dropoff: [
      "VUMC's valet entrance is on 21st Avenue, next to the Medical Arts building (valet hours 5 AM to 7 PM, per VUMC).",
      "Labor and delivery patients more than 20 weeks pregnant have their own entrance off 21st Avenue, separate from the main entrance.",
      "Drop-off points have changed during construction. Check your appointment letter or VUMC's parking page for your building's entrance."
    ],
    accessibility: [
      "Harvey Taxi is a ride service, not medical transport. If you need a wheelchair-accessible vehicle or help from the car, contact support before you book."
    ],
    parking: [
      "VUMC lists free valet for patients and visitors on the main campus, with longer waits during construction. A ride avoids the garage and the valet line."
    ],
    sources: [
      { label: "Vanderbilt Health: Parking and Transportation", url: "https://www.vanderbilthealth.com/information/parking-and-transportation" },
      { label: "VUMC: Valet Service", url: "https://www.vumc.org/med-center-parking/valet-service" },
      { label: "Vanderbilt Health: Labor and Delivery Entrance", url: "https://www.vanderbilthealth.com/locations/vanderbilt-university-hospital-labor-and-delivery-entrance" }
    ],
    related: ["vanderbilt-university", "belmont-university"]
  },
  {
    slug: "vanderbilt-university",
    name: "Vanderbilt University",
    category: "University",
    address: "2305 West End Avenue, Nashville, TN 37203",
    summary: "Rides to Vanderbilt University for campus visits, classes and events.",
    dropoff: [
      "Undergraduate Admissions is at 2305 West End Avenue. For other buildings, enter the building's own address so your driver goes to the right side of campus."
    ],
    accessibility: [
      "If you need help from the car, add a note for your driver when you book."
    ],
    parking: [
      "Vanderbilt lists visitor parking at $4 per hour. Admissions visitors are pointed to the paid 2525 West End Garage, about a 10-minute walk from admissions events, with a 7-foot height limit."
    ],
    sources: [
      { label: "Vanderbilt: Visitor parking", url: "https://www.vanderbilt.edu/transportation-parking/parking/visitors/" },
      { label: "Vanderbilt Admissions: Visit campus", url: "https://admissions.vanderbilt.edu/visit/" },
      { label: "Vanderbilt Admissions: Parking for programs", url: "https://admissions.vanderbilt.edu/visit/parking.php" }
    ],
    related: ["vanderbilt-medical-center", "belmont-university"]
  },
  {
    slug: "belmont-university",
    name: "Belmont University",
    category: "University",
    address: "1900 Belmont Boulevard, Nashville, TN 37212",
    summary: "Rides to Belmont University for campus visits, classes and Curb Event Center events.",
    dropoff: [
      "Admissions visitors use the Johnson Center entrance at 1909 15th Avenue South. For other buildings, enter the building's name or address, or check Belmont's campus map."
    ],
    accessibility: [
      "Belmont publishes an accessibility campus map. If you need help from the car, add a note for your driver when you book."
    ],
    parking: [
      "Belmont offers free visitor parking registration online for up to two days, and admissions visitors park in the Johnson Center garage."
    ],
    sources: [
      { label: "Belmont: Where to Park", url: "https://www.belmont.edu/about/visit/parking.html" },
      { label: "Belmont: Accessibility map (PDF)", url: "https://www.belmont.edu/about/visit/_files/campus-maps/accessibility-map.pdf" }
    ],
    related: ["vanderbilt-university", "vanderbilt-medical-center"]
  }
]);

const BY_SLUG = new Map(DESTINATIONS.map((d) => [d.slug, d]));
const HUB_PATH = "/nashville-destinations/";
const pagePath = (slug) => `/destinations/${slug}/`;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON inside <script type="application/ld+json">: "<" escaped so no
// value can close the script element.
function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function bookUrl(destination) {
  return `/rider-dashboard.html?ai_destination=${encodeURIComponent(destination.address)}`;
}

function formatDate(iso) {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const [y, m, d] = iso.split("-").map(Number);
  return `${months[m - 1]} ${d}, ${y}`;
}

const STYLE = `
:root{--bg:#07101f;--card:#0f1c33;--line:#22365a;--text:#eef3ff;--muted:#a9b8d6;--accent:#3ad1ff;--gold:#ffd166}
@media (prefers-color-scheme:light){:root{--bg:#f5f8fd;--card:#ffffff;--line:#d6e0f0;--text:#0b1530;--muted:#4a5a78;--accent:#0a6fb3;--gold:#9a6b00}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}main{max-width:820px;margin:0 auto;padding:24px 16px 64px}
header.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px;max-width:820px;margin:0 auto}
header.top a.brand{color:var(--text);text-decoration:none;font-weight:800}
.crumbs{font-size:.9rem;color:var(--muted)}.crumbs a{color:var(--muted)}
h1{font-size:1.9rem;line-height:1.2;margin:.4em 0}h2{font-size:1.25rem;margin:1.6em 0 .5em}
.lead{color:var(--muted);font-size:1.05rem}.addr{font-weight:600}
.cta{display:inline-block;margin:12px 0;padding:12px 18px;border-radius:12px;background:var(--accent);color:#04111f;font-weight:800;text-decoration:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:12px 0}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line)}
.note{font-size:.9rem;color:var(--muted)}ul{padding-left:1.2em}li{margin:.35em 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.grid a{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;text-decoration:none;color:var(--text)}
.grid small{display:block;color:var(--muted)}
footer{max-width:820px;margin:0 auto;padding:24px 16px;color:var(--muted);font-size:.9rem}`;

function layout({ title, description, canonicalPath, body, ld }) {
  const canonical = `${SITE}${canonicalPath}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${SITE}/og-image.png" />
<link rel="icon" href="/favicon.ico" />
<style>${STYLE}</style>
${ld.map((x) => `<script type="application/ld+json">${jsonLd(x)}</script>`).join("\n")}
</head>
<body>
<header class="top"><a class="brand" href="/">Harvey Taxi</a><a href="${HUB_PATH}">Nashville destinations</a></header>
<main>
${body}
</main>
<footer>
<p>Harvey Taxi Service LLC, Nashville, Tennessee. Rides in Nashville (early access). Venue details are from each venue's own website, checked ${esc(formatDate(CHECKED_ON))}; venues change entrances and zones for events, so confirm on the day.</p>
<p><a href="/">Home</a> · <a href="${HUB_PATH}">All destinations</a> · <a href="/support.html">Support</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a></p>
</footer>
</body>
</html>`;
}

const PROVIDER = { "@type": "LocalBusiness", name: "Harvey Taxi Service LLC", url: SITE };

function breadcrumbs(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${SITE}${it.path}` }))
  };
}

function list(items) {
  return `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
}

// travelTimes: [{ originId, minutes, miles }] or null when unavailable.
function travelTable(travelTimes) {
  const rows = (travelTimes || [])
    .map((t) => ({ t, origin: ORIGINS.find((o) => o.id === t.originId) }))
    .filter(({ t, origin }) => origin && Number.isFinite(t.minutes) && Number.isFinite(t.miles));
  if (!rows.length) {
    return `<p class="note">Open the booking screen for a live route and fare estimate from where you are.</p>`;
  }
  return `<table><thead><tr><th>From</th><th>Typical drive (no traffic)</th><th>Distance</th></tr></thead><tbody>${rows
    .map(({ t, origin }) => `<tr><td>${esc(origin.label)}</td><td>about ${Math.max(1, Math.round(t.minutes))} min</td><td>${t.miles.toFixed(1)} mi</td></tr>`)
    .join("")}</tbody></table>
<p class="note">Estimated driving routes from Mapbox without live traffic. Event traffic and closures add time.</p>`;
}

function renderDestinationPage(slug, { travelTimes = null } = {}) {
  const d = BY_SLUG.get(slug);
  if (!d) return null;
  const path = pagePath(slug);
  const title = `Rides to ${d.name}, Nashville | Harvey Taxi`;
  const description = `${d.summary} Drop-off tips, accessibility and parking notes, and a live fare estimate.`.slice(0, 300);
  const related = d.related.map((s) => BY_SLUG.get(s)).filter(Boolean);
  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="${HUB_PATH}">Nashville destinations</a> › ${esc(d.name)}</nav>
<h1>Rides to ${esc(d.name)}</h1>
<p class="lead">${esc(d.summary)}</p>
<p class="addr">${esc(d.address)}</p>
<a class="cta" href="${esc(bookUrl(d))}">Get a live fare estimate</a>
<section class="card"><h2>Drop-off and pickup</h2>${list(d.dropoff)}</section>
<section class="card"><h2>Travel times</h2>${travelTable(travelTimes)}</section>
<section class="card"><h2>Accessibility</h2>${list(d.accessibility)}</section>
<section class="card"><h2>Parking compared with a ride</h2>${list(d.parking)}<p class="note">Fares depend on distance and time; the booking screen shows your estimate before you confirm.</p></section>
<section class="card"><h2>Sources</h2><ul>${d.sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener">${esc(s.label)}</a></li>`).join("")}</ul><p class="note">Checked ${esc(formatDate(CHECKED_ON))}. Venues update entrances and zones; confirm with the venue on the day.</p></section>
${related.length ? `<h2>Nearby destinations</h2><div class="grid">${related.map((r) => `<a href="${pagePath(r.slug)}">${esc(r.name)}<small>${esc(r.category)}</small></a>`).join("")}</div>` : ""}`;
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "TaxiService",
      name: `Harvey Taxi Service: rides to ${d.name}`,
      url: `${SITE}${path}`,
      provider: PROVIDER,
      areaServed: {
        "@type": "Place",
        name: `${d.name}, Nashville, TN`,
        address: { "@type": "PostalAddress", streetAddress: d.address.split(",")[0], addressLocality: "Nashville", addressRegion: "TN", addressCountry: "US" }
      }
    },
    breadcrumbs([{ name: "Home", path: "/" }, { name: "Nashville destinations", path: HUB_PATH }, { name: d.name, path }])
  ];
  return layout({ title, description, canonicalPath: path, body, ld });
}

function renderHubPage() {
  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › Nashville destinations</nav>
<h1>Rides to popular Nashville destinations</h1>
<p class="lead">Drop-off spots, accessibility and parking notes for the places riders go most, from each venue's own website.</p>
<div class="grid">${DESTINATIONS.map((d) => `<a href="${pagePath(d.slug)}">${esc(d.name)}<small>${esc(d.category)} · ${esc(d.address)}</small></a>`).join("")}</div>
<a class="cta" href="/rider-dashboard.html">Book a ride</a>`;
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Nashville destinations served by Harvey Taxi",
      itemListElement: DESTINATIONS.map((d, i) => ({ "@type": "ListItem", position: i + 1, name: d.name, url: `${SITE}${pagePath(d.slug)}` }))
    },
    breadcrumbs([{ name: "Home", path: "/" }, { name: "Nashville destinations", path: HUB_PATH }])
  ];
  return layout({
    title: "Rides to Nashville destinations | Harvey Taxi",
    description: "Harvey Taxi ride guides for Nashville: Broadway, the Ryman, Bridgestone Arena, the Opry, Nissan Stadium, the Nashville Zoo, Vanderbilt and Belmont.",
    canonicalPath: HUB_PATH,
    body,
    ld
  });
}

const SITEMAP_PATHS = Object.freeze([HUB_PATH, ...DESTINATIONS.map((d) => pagePath(d.slug))]);

module.exports = {
  CHECKED_ON,
  DESTINATIONS,
  HUB_PATH,
  ORIGINS,
  SITEMAP_PATHS,
  pagePath,
  renderDestinationPage,
  renderHubPage
};
