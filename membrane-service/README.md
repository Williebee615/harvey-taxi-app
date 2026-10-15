# Membrane service: Harvey Taxi's own embedding server

A small Python service that turns text into vectors (embeddings) with the open
`multilingual-e5-small` model, on CPU. The assistant uses it to find published
passages that answer reworded questions. It runs as a **Render private
service**:
- only Harvey Taxi's own web service can reach it;
- text is processed in memory and never stored or logged;
- no AI vendor is involved.

Owner approvals (2026-10-15): own model, no AI vendor; vector search; this
service at about $25/month (Render Standard; third-party price, confirm on
Render).

## One-time setup in Render (owner)

1. **New → Private Service**, connected to `Williebee615/harvey-taxi-app`, branch `main`.
   - **Name:** `harvey-membrane`
   - **Root Directory:** `membrane-service`
   - **Runtime:** Docker
   - **Instance type:** Standard (2 GB). Starter (512 MB) is too small for the model.
2. Under **Environment**, add `MEMBRANE_API_KEY` with a long random value. Render's "Generate" button works. Keep it private; it is never needed in chat or GitHub.
3. Click **Create Private Service**.
   - The first build downloads the model, so it takes several minutes.
   - The build log prints a `model {...}` line with the exact model commit and license.
   - When the service shows **Live**, copy its **Internal Address** (e.g. `harvey-membrane-xxxx:10000`) from the service page.
4. On the existing web service, open **Environment** and add:
   - `MEMBRANE_BASE_URL` = `http://<Internal Address>/v1`
   - `MEMBRANE_EMBED_MODEL` = `multilingual-e5-small`
   - `MEMBRANE_API_KEY` = the same value as in step 2
   - `MEMBRANE_TIMEOUT_MS` = `3000`

   Save; the web service redeploys.
5. Sign in to the admin dashboard, then open
   `https://harveytaxiservice.com/api/admin/membrane/calibration`.
   - It shows the service's health and the calibration scores, and changes nothing.
   - Share the result; the similarity threshold (`MEMBRANE_MIN_SIMILARITY`) is set from it.

Vector search stays **off** until the threshold is set and an organization's
`assistant_pilot_<org>_vectors_enabled` flag is turned on.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` (or `/v1/health`) | `{ ok, dims, model, revision }` |
| `POST /v1/embeddings` | `{ model, input: [text, …] }` → `{ data: [{ index, embedding }] }`. Needs `Authorization: Bearer $MEMBRANE_API_KEY` when the key is set; at most 64 inputs of 4,000 characters each. |

## Rollback

- Remove `MEMBRANE_BASE_URL` from the web service (keyword search only, exactly as before), or turn the vectors flag off.
- Suspend or delete the private service to stop its cost.
