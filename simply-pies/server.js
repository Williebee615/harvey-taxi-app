'use strict';

// Local server. On Vercel, api/index.js serves the same app instead.
const { buildFromEnv } = require('./lib/fromEnv');

const { app, problems, warnings } = buildFromEnv();
if (problems.length) {
  for (const problem of problems) console.error(`[simply-pies] ${problem}`);
  process.exit(1);
}

const port = Number(process.env.PORT) || 3100;
app.listen(port, () => {
  console.log(`[simply-pies] Listening on http://localhost:${port}`);
  for (const warning of warnings) console.warn(`[simply-pies] ${warning}`);
});
