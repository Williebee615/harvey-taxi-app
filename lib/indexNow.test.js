const fs = require("fs");
const path = require("path");
const { INDEXNOW_KEY, buildIndexNowBody, indexNowAccepted } = require("./indexNow");

test("the key file is published at the site root with exactly the key", () => {
  expect(INDEXNOW_KEY).toMatch(/^[a-f0-9]{32}$/);
  expect(fs.readFileSync(path.join(__dirname, "..", "public", `${INDEXNOW_KEY}.txt`), "utf8")).toBe(INDEXNOW_KEY);
});

test("the body lists full https URLs once each, with the key location", () => {
  const body = buildIndexNowBody({ host: "harveytaxiservice.com", paths: ["/", "/nashville-destinations/", "destinations/geodis-park/", "/"] });
  expect(body).toEqual({
    host: "harveytaxiservice.com",
    key: INDEXNOW_KEY,
    keyLocation: `https://harveytaxiservice.com/${INDEXNOW_KEY}.txt`,
    urlList: ["https://harveytaxiservice.com/", "https://harveytaxiservice.com/nashville-destinations/", "https://harveytaxiservice.com/destinations/geodis-park/"]
  });
  expect([200, 202].map(indexNowAccepted)).toEqual([true, true]);
  expect([400, 403, 422, 429].some(indexNowAccepted)).toBe(false);
});
