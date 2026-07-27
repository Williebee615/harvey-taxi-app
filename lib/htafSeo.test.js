const fs = require("fs");
const path = require("path");
const { getMetaDescription, getOpenGraphTags, getJsonLdBlocks } = require("./htafSeo");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const readPage = (name) => fs.readFileSync(path.join(PUBLIC_DIR, name), "utf8");

const contactHtml = readPage("contact.html");
const leadershipHtml = readPage("leadership.html");
const foundationHtml = readPage("foundation.html");

const REQUIRED_OG_PROPERTIES = ["og:title", "og:description", "og:url", "og:type"];

describe("contact.html and leadership.html SEO tags", () => {
  test("each page has a non-empty, unique meta description", () => {
    const contactDescription = getMetaDescription(contactHtml);
    const leadershipDescription = getMetaDescription(leadershipHtml);

    expect(contactDescription).toBeTruthy();
    expect(leadershipDescription).toBeTruthy();
    expect(contactDescription).not.toBe(leadershipDescription);
  });

  test.each([
    ["contact.html", () => contactHtml],
    ["leadership.html", () => leadershipHtml],
  ])("%s has all required Open Graph tags", (_name, getHtml) => {
    const og = getOpenGraphTags(getHtml());
    for (const property of REQUIRED_OG_PROPERTIES) {
      expect(og[property]).toBeTruthy();
    }
  });

  test("contact.html and leadership.html use the Foundation domain for og:url", () => {
    const contactOg = getOpenGraphTags(contactHtml);
    const leadershipOg = getOpenGraphTags(leadershipHtml);

    expect(contactOg["og:url"]).toBe("https://harveytransportationfoundation.com/contact.html");
    expect(leadershipOg["og:url"]).toBe("https://harveytransportationfoundation.com/leadership.html");
  });
});

describe("foundation.html Organization JSON-LD", () => {
  test("contains exactly one JSON-LD block that parses as valid JSON", () => {
    const blocks = getJsonLdBlocks(foundationHtml);
    expect(blocks).toHaveLength(1);
  });

  test("declares the organization as an NGO with the confirmed public facts", () => {
    const [org] = getJsonLdBlocks(foundationHtml);

    expect(org["@context"]).toBe("https://schema.org");
    expect(org["@type"]).toBe("NGO");
    expect(org.name).toBe("Harvey Transportation Assistance Foundation");
    expect(org.url).toBe("https://harveytransportationfoundation.com/");
    expect(org.taxID).toBe("41-5115030");
    expect(org.nonprofitStatus).toBe("Nonprofit501c3");
    expect(org.email).toBe("WillieHtaf@harveytransportationfoundation.com");
    expect(org.telephone).toBe("+1-615-636-6201");
    expect(org.address.addressLocality).toBe("Nashville");
    expect(org.address.addressRegion).toBe("TN");
  });

  test("does not invent a street address, founder, logo, or social profile", () => {
    const [org] = getJsonLdBlocks(foundationHtml);

    expect(org.address.streetAddress).toBeUndefined();
    expect(org.founder).toBeUndefined();
    expect(org.logo).toBeUndefined();
    expect(org.sameAs).toBeUndefined();
  });
});
