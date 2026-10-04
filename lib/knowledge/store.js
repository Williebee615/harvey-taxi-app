// The assistant's knowledge index: published pages plus admin-approved
// articles (docs/ai-knowledge.md). Pages are read once at startup; the
// approved articles are read from the database at most every ttlMs (and
// right after an admin approves, edits or retires one), so answering a
// question never reads the database.

const { buildIndex, loadSources, articleSections } = require("./search");

function createKnowledgeStore({ loadApproved, ttlMs = 10 * 60 * 1000, now = () => Date.now(), pages = null, log = () => {} } = {}) {
  const pageSections = pages || loadSources().sections;
  let index = buildIndex(pageSections);
  let articles = [];
  let approvedRows = [];
  let loadedAt = 0;
  let refreshing = null;
  let lastError = null;

  async function refresh() {
    if (!loadApproved) return index;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const rows = await loadApproved();
        approvedRows = (rows || []).filter((r) => r && r.status === "approved");
        articles = articleSections(approvedRows);
        index = buildIndex([...pageSections, ...articles]);
        lastError = null;
      } catch (err) {
        // Keep answering from the last good index (pages at minimum).
        lastError = err && err.message ? err.message : "load failed";
        log(lastError);
      } finally {
        loadedAt = now();
        refreshing = null;
      }
      return index;
    })();
    return refreshing;
  }

  // Never waits on the database: returns the current index and refreshes
  // in the background when it is older than ttlMs.
  function getIndex() {
    if (loadApproved && now() - loadedAt > ttlMs && !refreshing) refresh();
    return index;
  }

  function status() {
    return { page_sections: pageSections.length, approved_articles: articles.length, loaded_at: loadedAt ? new Date(loadedAt).toISOString() : null, last_error: lastError };
  }

  // Approved articles for the public /policies.html page (cached copy).
  function approved() {
    return approvedRows.map((r) => ({ slug: r.slug, title: r.title, body: r.body, audience: r.audience, approved_at: r.approved_at, version: r.version }));
  }

  return { getIndex, refresh, status, approved };
}

module.exports = { createKnowledgeStore };
