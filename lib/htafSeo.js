function parseAttributes(tagHtml) {
  const attrs = {};
  const attrRegex = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(tagHtml)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function getMetaTags(html) {
  const metaTagRegex = /<meta\b[^>]*>/gi;
  const tags = [];
  let match;
  while ((match = metaTagRegex.exec(html)) !== null) {
    tags.push(parseAttributes(match[0]));
  }
  return tags;
}

function getMetaDescription(html) {
  const meta = getMetaTags(html).find((tag) => tag.name === "description");
  return meta ? meta.content : null;
}

function getOpenGraphTags(html) {
  const og = {};
  for (const tag of getMetaTags(html)) {
    if (tag.property && tag.property.startsWith("og:")) {
      og[tag.property] = tag.content;
    }
  }
  return og;
}

function getJsonLdBlocks(html) {
  const scriptRegex = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  const blocks = [];
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    blocks.push(JSON.parse(match[1]));
  }
  return blocks;
}

module.exports = { getMetaTags, getMetaDescription, getOpenGraphTags, getJsonLdBlocks };
