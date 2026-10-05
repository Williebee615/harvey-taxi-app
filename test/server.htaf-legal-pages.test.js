// HTAF legal pages: host-based routing isolation, canonical redirects,
// and the content rules approved for HTAF's public pages (entity
// naming, tax-status wording, footer, legal links, metadata, no
// advertising tags, no Harvey Taxi AI widget, no document upload).
//
// Routing is exercised through real requests with a Host header,
// because the same paths exist on both the taxi and foundation domains
// and only the Host decides which entity's page is served.

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.RIDER_SESSION_SECRET = "test-rider-session-secret";
process.env.DRIVER_SESSION_SECRET = "test-driver-session-secret";
process.env.RIDE_QUOTE_SECRET = "test-ride-quote-secret";
process.env.ADMIN_API_TOKEN = "test-admin-token";
// Left unset deliberately, matching production: the real hardcoded
// defaults (harveytaxiservice.com / harveytransportationfoundation.com).
delete process.env.CANONICAL_HOST;
delete process.env.FOUNDATION_HOST;

const fs = require("fs");
const path = require("path");
const { createFakeSupabase } = require("./fakeSupabase");

let mockSupabaseClient;

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => mockSupabaseClient
}));

const request = require("supertest");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const readPage = (name) => fs.readFileSync(path.join(PUBLIC_DIR, name), "utf8");
const normalize = (html) => html.replace(/\s+/g, " ");
// Visible text only: drops tags, scripts and styles.
const visibleText = (html) =>
  normalize(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );

const FOUNDATION = "harveytransportationfoundation.com";
const WWW_FOUNDATION = `www.${FOUNDATION}`;
const TAXI = "harveytaxiservice.com";
const PREVIEW = "harvey-taxi-app-git-htaf-legal-pages.vercel.app";
const CANONICAL = `https://${FOUNDATION}`;

const PRIVACY_URL = `${CANONICAL}/privacy.html`;
const TERMS_URL = `${CANONICAL}/terms.html`;
const PROVIDERS_URL = `${CANONICAL}/service-providers.html`;

const APPROVED_FOOTER =
  "© 2026 Harvey Transportation Assistance Foundation · 501(c)(3) public charity · EIN 41-5115030";

// Every public HTAF page, and the admin page that must not carry the
// Harvey Taxi AI widget either.
const PUBLIC_HTAF_PAGES = [
  "foundation.html",
  "contact.html",
  "leadership.html",
  "htaf-application.html",
  "htaf-privacy.html",
  "htaf-terms.html",
  "htaf-service-providers.html"
];
const ALL_HTAF_PAGES = [...PUBLIC_HTAF_PAGES, "admin-htaf.html"];
const LEGAL_PAGES = ["htaf-privacy.html", "htaf-terms.html", "htaf-service-providers.html"];

let app;

beforeAll(() => {
  mockSupabaseClient = createFakeSupabase({});
  // eslint-disable-next-line global-require
  ({ app } = require("../server"));
});

describe("routing -- canonical HTAF legal URLs on the foundation domain", () => {
  test.each([
    ["/privacy.html", "Privacy Policy — Harvey Transportation Assistance Foundation"],
    ["/terms.html", "Terms of Use — Harvey Transportation Assistance Foundation"],
    ["/service-providers.html", "Service Providers — Harvey Transportation Assistance Foundation"]
  ])("%s serves HTAF's page on the apex and www hosts", async (urlPath, title) => {
    for (const host of [FOUNDATION, WWW_FOUNDATION]) {
      const res = await request(app).get(urlPath).set("Host", host);
      expect(res.status).toBe(200);
      expect(res.text).toContain(`<title>${title}</title>`);
    }
  });
});

describe("routing -- internal HTAF legal filenames redirect to the canonical URL on every host", () => {
  const cases = [
    ["/htaf-privacy.html", PRIVACY_URL],
    ["/htaf-terms.html", TERMS_URL],
    ["/htaf-service-providers.html", PROVIDERS_URL]
  ];

  test.each(cases.flatMap(([from, to]) => [FOUNDATION, WWW_FOUNDATION, TAXI, PREVIEW].map((host) => [from, host, to])))(
    "%s on %s -> 301 %s",
    async (from, host, to) => {
      const res = await request(app).get(from).set("Host", host);
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe(to);
    }
  );

  test("HEAD requests are redirected the same way", async () => {
    const res = await request(app).head("/htaf-privacy.html").set("Host", TAXI);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(PRIVACY_URL);
  });

  test.each(cases)("following the %s redirect lands on a 200, not another redirect (no loop)", async (from) => {
    const first = await request(app).get(from).set("Host", PREVIEW);
    const target = new URL(first.headers.location);

    const second = await request(app).get(target.pathname).set("Host", target.host);
    expect(second.status).toBe(200);
    expect(second.headers.location).toBeUndefined();
  });

  test("a query string does not bypass the redirect", async () => {
    const res = await request(app).get("/htaf-terms.html?x=1").set("Host", TAXI);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(TERMS_URL);
  });
});

describe("routing -- Harvey Taxi hosts keep Harvey Taxi's own legal pages", () => {
  test.each([TAXI, PREVIEW])("/privacy.html on %s is Harvey Taxi's policy", async (host) => {
    const res = await request(app).get("/privacy.html").set("Host", host);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Privacy Policy — Harvey Taxi Service LLC");
  });

  test.each([TAXI, PREVIEW])("/terms.html on %s is Harvey Taxi's terms", async (host) => {
    const res = await request(app).get("/terms.html").set("Host", host);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Harvey Taxi Terms of Service");
  });

  test("/service-providers.html on the taxi host never serves HTAF's page", async () => {
    const res = await request(app).get("/service-providers.html").set("Host", TAXI);
    expect(res.text || "").not.toContain("Service Providers — Harvey Transportation Assistance Foundation");
  });
});

describe("sitemap", () => {
  test("the foundation sitemap lists the canonical legal URLs, never the internal filenames", async () => {
    const res = await request(app).get("/sitemap.xml").set("Host", FOUNDATION);
    expect(res.text).toContain(`<loc>${PRIVACY_URL}</loc>`);
    expect(res.text).toContain(`<loc>${TERMS_URL}</loc>`);
    expect(res.text).toContain(`<loc>${PROVIDERS_URL}</loc>`);
    expect(res.text).not.toContain("htaf-privacy");
    expect(res.text).not.toContain("htaf-terms");
  });

  test("the taxi sitemap does not list HTAF's service-providers page", async () => {
    const res = await request(app).get("/sitemap.xml").set("Host", TAXI);
    expect(res.text).not.toContain("service-providers");
  });
});

describe("every public HTAF page -- footer, legal links, metadata", () => {
  test.each(PUBLIC_HTAF_PAGES)("%s shows the approved footer text", (page) => {
    expect(visibleText(readPage(page))).toContain(APPROVED_FOOTER);
  });

  test.each(PUBLIC_HTAF_PAGES)("%s links to the absolute Privacy, Terms, and Service Providers URLs", (page) => {
    const html = readPage(page);
    expect(html).toContain(`href="${PRIVACY_URL}"`);
    expect(html).toContain(`href="${TERMS_URL}"`);
    expect(html).toContain(`href="${PROVIDERS_URL}"`);
  });

  test.each(PUBLIC_HTAF_PAGES)("%s has no relative or internal-filename legal link", (page) => {
    const html = readPage(page);
    expect(html).not.toMatch(/href="\/?(privacy|terms|service-providers)\.html"/);
    expect(html).not.toMatch(/href="[^"]*htaf-(privacy|terms|service-providers)\.html"/);
  });

  test.each(PUBLIC_HTAF_PAGES)("%s has lang, viewport, title, description, robots, and a foundation-domain canonical and og:url", (page) => {
    const html = readPage(page);
    expect(html).toMatch(/<html lang="en"/);
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1\.0/);
    expect(html).toMatch(/<title>[^<]*Harvey Transportation Assistance Foundation[^<]*<\/title>/);
    expect(html).toMatch(/<meta\s+name="description"\s+content="[^"]+"/);
    expect(html).toMatch(/<meta name="robots" content="index, follow"/);

    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
    const ogUrl = html.match(/property="og:url"\s+content="([^"]+)"/);
    expect(canonical && canonical[1].startsWith(`${CANONICAL}/`)).toBe(true);
    expect(ogUrl && ogUrl[1]).toBe(canonical[1]);
  });

  test.each([
    ["htaf-privacy.html", PRIVACY_URL],
    ["htaf-terms.html", TERMS_URL],
    ["htaf-service-providers.html", PROVIDERS_URL]
  ])("%s declares its canonical as %s", (page, url) => {
    expect(readPage(page)).toContain(`<link rel="canonical" href="${url}"`);
  });

  test.each(PUBLIC_HTAF_PAGES)("%s has exactly one h1", (page) => {
    expect(readPage(page).match(/<h1[\s>]/g)).toHaveLength(1);
  });
});

describe("every HTAF page -- no advertising tags, no Harvey Taxi AI widget", () => {
  test.each(ALL_HTAF_PAGES)("%s loads no Google Ads or gtag", (page) => {
    const html = readPage(page);
    expect(html).not.toContain("googletagmanager");
    expect(html).not.toMatch(/\bgtag\s*\(/);
    expect(html).not.toContain("AW-18161547185");
  });

  test.each(ALL_HTAF_PAGES)("%s has no AI widget entry point, script, or context", (page) => {
    const html = readPage(page);
    expect(html).not.toContain("ai-support-widget");
    expect(html).not.toContain("openHarveyAiChat");
    expect(html).not.toContain("HARVEY_AI_CONTEXT");
    expect(html).not.toContain("harvey-ai-chat-root");
    expect(html).not.toMatch(/Harvey (Taxi )?AI/);
    expect(html).not.toMatch(/>\s*AI Help\s*</);
  });

  test.each(ALL_HTAF_PAGES)("%s has no Stripe donation link", (page) => {
    expect(readPage(page)).not.toContain("buy.stripe.com");
  });

  test.each(["foundation.html", "htaf-application.html", "contact.html"])("%s loads HTAF's own assistant, never Harvey Taxi's", (page) => {
    const html = readPage(page);
    expect(html).toContain('<script src="/htaf-assist.js" defer></script>');
    expect(html).not.toContain("agent-assist.js");
  });

  test("Harvey Taxi pages never load the HTAF assistant", () => {
    for (const page of ["index.html", "rider-dashboard.html", "driver-dashboard.html", "support.html"]) {
      expect(readPage(page)).not.toContain("htaf-assist.js");
    }
  });

  test("the Harvey Taxi widget itself is left in place for Harvey Taxi pages", () => {
    expect(fs.existsSync(path.join(PUBLIC_DIR, "ai-support-widget.js"))).toBe(true);
    expect(readPage("index.html")).toContain("ai-support-widget.js");
  });
});

describe("every public HTAF page -- entity and tax-status wording", () => {
  test.each(PUBLIC_HTAF_PAGES)("%s makes no 170(b)(1)(A)(vi) claim", (page) => {
    expect(readPage(page)).not.toMatch(/170\s*\(b\)/);
  });

  test.each(PUBLIC_HTAF_PAGES)("%s does not say Tennessee nonprofit, incorporated in Tennessee, or Tennessee 501(c)(3)", (page) => {
    const text = readPage(page);
    expect(text).not.toMatch(/Tennessee 501\(c\)\(3\)/i);
    expect(text).not.toMatch(/Tennessee nonprofit/i);
    expect(text).not.toMatch(/incorporated in Tennessee/i);
  });

  test.each(PUBLIC_HTAF_PAGES)("%s does not name Lyft or promise volunteer drivers", (page) => {
    const text = readPage(page);
    expect(text).not.toMatch(/\bLyft\b/i);
    expect(text).not.toMatch(/volunteer drivers?/i);
  });
});

describe("application page -- no document upload", () => {
  const html = readPage("htaf-application.html");
  const NOTICE =
    "Do not upload documents through this application. If supporting documentation is needed, HTAF will contact you with instructions for submitting it securely.";

  test("renders no file input and no upload label", () => {
    expect(html).not.toMatch(/type=["']file["']/i);
    expect(html).not.toContain("supportingDocs");
    expect(html).not.toMatch(/>\s*Upload (Documents|Files)\s*</);
  });

  test("never collects or sends file names or counts", () => {
    expect(html).not.toContain("document_names");
    expect(html).not.toContain("document_count");
    expect(html).not.toMatch(/\.files\b/);
  });

  test("never claims that documents were submitted", () => {
    expect(html).not.toMatch(/\["Documents",/);
    expect(visibleText(html)).not.toMatch(/documents? (were |have been )?(uploaded|received|submitted)/i);
  });

  test("shows the approved instruction instead", () => {
    expect(visibleText(html)).toContain(NOTICE);
  });

  test("the server still ignores document fields if an old cached page sends them", () => {
    const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    expect(server).not.toContain("document_names");
    expect(server).not.toContain("document_count");
  });
});

describe("Privacy Policy content", () => {
  const html = readPage("htaf-privacy.html");
  const text = visibleText(html);

  test("has the approved section headings, in order", () => {
    const headings = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(headings).toEqual([
      "1. Who We Are",
      "2. Scope of This Policy",
      "3. Information We Collect",
      "4. How We Use Information",
      "5. How We Share Information",
      "6. Service Providers",
      "7. Who Can Access Your Information",
      "8. Health-Related Information",
      "9. Donations",
      "10. Data Retention",
      "11. Security",
      "12. Your Rights and Choices",
      "13. Children",
      "14. Changes to This Policy",
      "15. Contact Us"
    ]);
  });

  test("states that documents are not collected online, and keeps the 90-day rule as a future procedure", () => {
    expect(text).toContain("HTAF does not currently collect supporting documents through the online application.");
    expect(text).toMatch(/Future procedure: if HTAF introduces an approved secure process[^.]*within 90 days/);
    expect(text).toContain("This procedure does not apply today");
  });

  test("uses the approved provider-sharing and separate-entity wording", () => {
    expect(text).toContain(
      "HTAF may share the minimum trip information necessary to arrange approved transportation with independent transportation providers. Harvey Taxi Service LLC is a separate for-profit company and may receive trip information only when selected to provide or coordinate an approved trip."
    );
  });

  test("uses the approved interim access wording and discloses shared infrastructure without implying shared governance", () => {
    expect(text).toContain(
      "HTAF limits application access to authorized administrators and designated personnel who require access to operate or support the transportation-assistance program. HTAF is working to enforce more granular technical access controls between its charitable program and affiliated or supporting systems."
    );
    expect(text).toMatch(/uses technical infrastructure[^.]*shared with Harvey Taxi Service LLC/);
    expect(text).toContain("does not mean the organizations share governance");
    expect(text).not.toMatch(/only HTAF staff|exclusively (to|by) HTAF/i);
  });

  test("uses the approved donation statement", () => {
    expect(text).toContain(
      "Online donations are processed on the payment provider's hosted site. HTAF does not receive or store complete payment-card or bank-account credentials."
    );
  });

  test("gives the rights contact and the 45-day response time", () => {
    expect(text).toContain("WillieHtaf@harveytransportationfoundation.com");
    expect(text).toContain("615-636-6201");
    expect(text).toContain("within 45 days");
  });

  test("makes no HIPAA business-associate promise", () => {
    expect(text).not.toMatch(/Business Associate Agreement/i);
    expect(text).toContain("is not a covered entity under the Health Insurance Portability and Accountability Act (HIPAA)");
  });

  test("makes no claim that alerts go only to an HTAF-controlled mailbox", () => {
    expect(text).not.toMatch(/HTAF-controlled mailbox|only to HTAF/i);
  });
});

describe("Terms of Use content", () => {
  const html = readPage("htaf-terms.html");
  const text = visibleText(html);

  test("keeps the no-guarantee statement", () => {
    expect(text).toContain("does not guarantee approval, funding, transportation, or scheduling");
  });

  test("uses the approved conduct rule verbatim", () => {
    expect(text).toContain(
      "Fraud, material misrepresentation, misuse of assistance, harassment, threats, unsafe conduct, or interference with transportation services may result in denial, suspension, or termination of assistance, subject to applicable law and reasonable accommodation requirements."
    );
  });

  test("names Tennessee law and Davidson County venue", () => {
    expect(text).toContain("governed by the laws of the State of Tennessee");
    expect(text).toContain("Davidson County, Tennessee");
  });

  test("invents no appeals process", () => {
    expect(text).not.toMatch(/\bappeal/i);
    expect(text).toContain("Questions, Corrections, Complaints, and Accommodation Requests");
  });
});

describe("legal pages -- counsel-review markers and excluded clauses", () => {
  const combined = LEGAL_PAGES.map((page) => visibleText(readPage(page))).join(" ");

  test.each([
    "Retention schedule: pending counsel review",
    "HIPAA and healthcare-data language: pending counsel review",
    "Disclaimers: pending counsel review",
    "Liability limitations: pending counsel review",
    "Governing law and venue: pending counsel review",
    "Minor-applicant provisions: pending counsel review",
    "Provider data-sharing disclosure: pending counsel review"
  ])("marks '%s'", (marker) => {
    expect(combined).toContain(marker);
  });

  test.each(LEGAL_PAGES)("%s has no arbitration, class-action waiver, jury waiver, indemnification, or release", (page) => {
    const pageText = visibleText(readPage(page));
    expect(pageText).not.toMatch(/arbitrat/i);
    expect(pageText).not.toMatch(/class[- ]action/i);
    expect(pageText).not.toMatch(/jury/i);
    expect(pageText).not.toMatch(/indemnif/i);
    expect(pageText).not.toMatch(/\brelease\b/i);
  });

  test.each(LEGAL_PAGES)("%s names no provider that no current HTAF function uses", (page) => {
    const pageText = visibleText(readPage(page));
    expect(pageText).not.toMatch(/OpenAI/i);
    expect(pageText).not.toMatch(/Stripe/i);
    expect(pageText).not.toMatch(/\bLyft\b/i);
  });

  test("the Service Providers page lists the providers HTAF's pages and application actually use", () => {
    const providers = visibleText(readPage("htaf-service-providers.html"));
    for (const name of ["Supabase", "Render", "SendGrid", "Google Fonts", "PayPal", "Independent transportation providers"]) {
      expect(providers).toContain(name);
    }
  });

  test.each(LEGAL_PAGES)("%s states the effective date is set on publication", (page) => {
    expect(readPage(page)).toContain('data-effective-date=""');
  });
});
