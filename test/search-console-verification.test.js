const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const read = (name) => fs.readFileSync(path.join(PUBLIC_DIR, name), "utf8");

// The owner supplied one Google Search Console HTML-tag token, for
// https://harveytaxiservice.com. Google issues a separate token per
// property, so the tag belongs on the taxi homepage only: the foundation
// site is a separate property (and, by owner decision, kept separate).
describe("Google Search Console verification tag", () => {
  const TAG = /<meta name="google-site-verification" content="([A-Za-z0-9_-]{30,})" \/>/;

  test("the taxi homepage carries exactly one verification tag", () => {
    const matches = read("index.html").match(new RegExp(TAG.source, "g")) || [];
    expect(matches).toHaveLength(1);
    expect(read("index.html")).toMatch(TAG);
  });

  test("no foundation page carries the taxi site's token", () => {
    const token = read("index.html").match(TAG)[1];
    for (const page of ["foundation.html", "contact.html", "leadership.html", "htaf-application.html"]) {
      expect(read(page)).not.toContain(token);
      expect(read(page)).not.toContain("google-site-verification");
    }
  });
});
