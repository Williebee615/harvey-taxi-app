// IndexNow (owner decision 2026-10-23): after a deploy, tell Bing and the
// other IndexNow search engines which Harvey Taxi pages exist, so new
// destination pages are found without waiting for a crawl. Google does
// not use IndexNow; it reads the sitemap.
//
// The key is public by design: IndexNow checks it against the file at
// https://harveytaxiservice.com/<key>.txt (public/<key>.txt).

const INDEXNOW_KEY = "1cd8a8f3c1398f593f48c5344b0f716c";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

// Pure: the request body for a host and its page paths.
function buildIndexNowBody({ host, paths }) {
  const urlList = [...new Set((paths || []).map((p) => `https://${host}${p.startsWith("/") ? p : `/${p}`}`))];
  return { host, key: INDEXNOW_KEY, keyLocation: `https://${host}/${INDEXNOW_KEY}.txt`, urlList };
}

// IndexNow answers 200 or 202 when it accepts the list.
const indexNowAccepted = (status) => status === 200 || status === 202;

module.exports = { INDEXNOW_KEY, INDEXNOW_ENDPOINT, buildIndexNowBody, indexNowAccepted };
