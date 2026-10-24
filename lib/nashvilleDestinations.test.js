const d = require("./nashvilleDestinations");

const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

describe("Nashville destination pages", () => {
  test("the owner's three batches, with no airport page", () => {
    expect(d.DESTINATIONS.map((x) => x.slug)).toEqual([
      "broadway-downtown", "ryman-auditorium", "bridgestone-arena", "grand-ole-opry", "opry-mills",
      "gaylord-opryland", "nissan-stadium", "nashville-zoo", "vanderbilt-medical-center",
      "vanderbilt-university", "belmont-university",
      // Batch 2 (owner decision 2026-10-23): 4 venues + 4 hospitals.
      "geodis-park", "music-city-center", "country-music-hall-of-fame", "parthenon-centennial-park",
      "saint-thomas-midtown", "saint-thomas-west", "monroe-carell-childrens-hospital", "nashville-va-medical-center",
      // Batch 3 (owner decision 2026-10-24): 5 neighborhoods + 3 universities + WeGo Central.
      "the-gulch", "twelve-south", "east-nashville-five-points", "germantown", "midtown-music-row",
      "tennessee-state-university", "fisk-university", "lipscomb-university", "wego-central"
    ]);
    for (const x of d.DESTINATIONS) {
      expect(JSON.stringify(x)).not.toMatch(/\bBNA\b|airport/i);
    }
  });

  test("every page shows the date its sources were checked", () => {
    for (const x of d.DESTINATIONS) {
      const expected = x.checked || d.CHECKED_ON;
      expect(expected).toMatch(/^2026-\d\d-\d\d$/);
      const [, m, day] = expected.split("-").map(Number);
      const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1];
      expect(d.renderDestinationPage(x.slug)).toContain(`Checked ${month} ${day}, 2026.`);
    }
  });

  test("every destination cites at least one https source and links only to existing pages", () => {
    const slugs = new Set(d.DESTINATIONS.map((x) => x.slug));
    for (const x of d.DESTINATIONS) {
      expect(x.sources.length).toBeGreaterThan(0);
      for (const s of x.sources) expect(s.url).toMatch(/^https:\/\//);
      for (const r of x.related) expect(slugs.has(r)).toBe(true);
      for (const k of ["dropoff", "accessibility", "parking"]) expect(x[k].length).toBeGreaterThan(0);
    }
  });

  test("a page is full HTML with its own canonical URL, h1, sources and a live estimate link", () => {
    const html = d.renderDestinationPage("ryman-auditorium");
    expect(html).toContain('<link rel="canonical" href="https://harveytaxiservice.com/destinations/ryman-auditorium/" />');
    expect(html).toContain("<h1>Rides to Ryman Auditorium</h1>");
    expect(html).toContain("Fourth Avenue side");
    expect(html).toContain('href="https://www.ryman.com/accessibility"');
    expect(html).toContain("/rider-dashboard.html?ai_destination=116%20Rep.%20John%20Lewis%20Way%20North");
    expect(html).not.toMatch(/\$\d+(\.\d\d)?\s*(fare|flat)/i);
  });

  test("TaxiService and breadcrumb structured data", () => {
    const [service, crumbs] = ldBlocks(d.renderDestinationPage("grand-ole-opry"));
    expect(service).toMatchObject({
      "@type": "TaxiService",
      provider: { "@type": "LocalBusiness", name: "Harvey Taxi Service LLC", url: "https://harveytaxiservice.com" },
      areaServed: { "@type": "Place", address: { addressLocality: "Nashville", addressRegion: "TN" } }
    });
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect(crumbs.itemListElement.at(-1).item).toBe("https://harveytaxiservice.com/destinations/grand-ole-opry/");
  });

  test("travel times appear only when given, labelled as estimates", () => {
    expect(d.renderDestinationPage("nissan-stadium")).not.toContain("<table>");
    const html = d.renderDestinationPage("nissan-stadium", {
      travelTimes: [{ originId: "downtown", minutes: 6.4, miles: 1.94 }, { originId: "nowhere", minutes: 1, miles: 1 }]
    });
    expect(html).toContain("<td>Downtown (Nashville Public Library)</td><td>about 6 min</td><td>1.9 mi</td>");
    expect(html).not.toContain("nowhere");
    expect(html).toContain("without live traffic");
  });

  test("the hub lists and links every destination; unknown slugs render nothing", () => {
    const html = d.renderHubPage();
    for (const x of d.DESTINATIONS) expect(html).toContain(`href="/destinations/${x.slug}/"`);
    expect(d.renderDestinationPage("bna-airport")).toBeNull();
    expect(d.SITEMAP_PATHS[0]).toBe("/nashville-destinations/");
  });

  test("text is escaped in HTML and cannot close a JSON-LD script", () => {
    const html = d.renderDestinationPage("broadway-downtown");
    expect(html).toContain("Lower Broadway &amp; Downtown");
    for (const block of html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g)) {
      expect(block.slice(0, -9)).not.toMatch(/<\//);
    }
  });

  test("every destination sits in a known corridor and links to the rest of it", () => {
    const ids = new Set(d.CLUSTERS.map((c) => c.id));
    for (const x of d.DESTINATIONS) {
      expect(ids.has(x.cluster)).toBe(true);
      const html = d.renderDestinationPage(x.slug);
      for (const other of d.DESTINATIONS.filter((o) => o.cluster === x.cluster && o.slug !== x.slug)) {
        expect(html).toContain(`href="${d.pagePath(other.slug)}"`);
      }
    }
    const hub = d.renderHubPage();
    for (const c of d.CLUSTERS) expect(hub).toContain(`<h2>${c.name.replace("&", "&amp;")}</h2>`);
  });

  test("three rider FAQs per page, visible and matching the FAQPage data, with no pricing promises", () => {
    for (const x of d.DESTINATIONS) {
      const faqs = d.faqsFor(x);
      expect(faqs).toHaveLength(3);
      const html = d.renderDestinationPage(x.slug);
      const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
      const faqLd = ld.find((b) => b["@type"] === "FAQPage");
      expect(faqLd.mainEntity.map((q) => q.name)).toEqual(faqs.map((f) => f.q));
      for (const f of faqs) {
        expect(html).toContain(f.q.replace(/&/g, "&amp;").replace(/'/g, "&#39;"));
        expect(f.a.length).toBeGreaterThan(40);
        expect(f.a).not.toMatch(/\bsurge\b|never (raise|increase)|guarantee|cheapest/i);
      }
    }
  });

  test("hospital pages say Harvey Taxi is not medical transport and not for emergencies", () => {
    for (const x of d.DESTINATIONS.filter((y) => y.category === "Medical")) {
      expect(x.summary).toMatch(/Not for emergencies: call 911/);
      expect(x.accessibility.join(" ")).toMatch(/not medical transport/);
    }
  });

  test("the busy-event callout appears on event venues only", () => {
    for (const x of d.DESTINATIONS) {
      expect(d.renderDestinationPage(x.slug).includes("Leaving after an event")).toBe(x.events === true);
    }
    expect(d.DESTINATIONS.filter((x) => x.category === "Medical").every((x) => !x.events)).toBe(true);
  });
});
