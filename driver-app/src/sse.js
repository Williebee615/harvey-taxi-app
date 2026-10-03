// Minimal Server-Sent Events client over XMLHttpRequest. React Native has
// no EventSource, and its XHR delivers the response text progressively,
// which is all SSE needs. Headers are supported (the driver session goes
// in x-driver-token, never in the URL).

// Parses complete events out of a text buffer. Returns the events and the
// unparsed remainder.
export function parseSseChunk(buffer) {
  const events = [];
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop();
  for (const block of blocks) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length || event !== 'message') {
      let parsed = null;
      try {
        parsed = data.length ? JSON.parse(data.join('\n')) : null;
      } catch {
        parsed = data.join('\n');
      }
      events.push({ event, data: parsed });
    }
  }
  return { events, rest };
}

export function openEventStream({ url, headers = {}, onEvent, onOpen, onError, XHR = globalThis.XMLHttpRequest }) {
  const xhr = new XHR();
  let seen = 0;
  let buffer = '';
  let opened = false;
  let closed = false;

  xhr.open('GET', url, true);
  Object.entries({ Accept: 'text/event-stream', 'Cache-Control': 'no-cache', ...headers }).forEach(([k, v]) => xhr.setRequestHeader(k, v));

  const consume = () => {
    const text = xhr.responseText || '';
    if (text.length <= seen) return;
    buffer += text.slice(seen);
    seen = text.length;
    const { events, rest } = parseSseChunk(buffer);
    buffer = rest;
    events.forEach((e) => onEvent && onEvent(e));
  };

  xhr.onreadystatechange = () => {
    if (closed) return;
    if (xhr.readyState >= 2 && !opened) {
      if (xhr.status === 200) {
        opened = true;
        onOpen && onOpen();
      } else if (xhr.status) {
        closed = true;
        onError && onError({ status: xhr.status });
        return;
      }
    }
    if (xhr.readyState >= 3) consume();
    if (xhr.readyState === 4 && !closed) {
      closed = true;
      onError && onError({ status: xhr.status || 0, ended: true });
    }
  };
  xhr.onerror = () => {
    if (closed) return;
    closed = true;
    onError && onError({ status: 0 });
  };
  xhr.send();

  return {
    close() {
      closed = true;
      try {
        xhr.abort();
      } catch {
        // already closed
      }
    }
  };
}
