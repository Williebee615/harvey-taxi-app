# Working in harvey-taxi-app

## Status records: read first, update after every meaningful change

- `docs/project-status.md`: the shared platform. What is live, draft or blocked; PRs and dependencies; test results and verified deployment commits; owner approvals and their exact scope; AI consent, privacy, payments and market settings (Zimbabwe, Nigeria and Ghana kept separate from the US); costs; decisions needed.
- `docs/harvey-taxi-mobile-status.md`: the rider app (Harvey Taxi Mobile).
- `docs/harvey-taxi-driver-status.md`: the driver app (Harvey Taxi Driver).

Rules:
- Date every update (UTC).
- Label each statement **[Verified]** (with how and when), **[Owner decision]** (date and exact scope), **[Recommendation]** or **[Unresolved]**.
- Never record "tests passed" as "deployed", "built" as "uploaded", or "uploaded" as "released".
- Record credential **names and storage locations only**. Never record tokens, passwords, private keys or review-account credentials.
- End every session with a short handoff in each changed record: completed work, remaining work, and the next authorized action.

## Standing owner rules

Every merge, migration, deployment, build, store upload or submission, paid upgrade, and feature activation needs the owner's explicit approval. Approval in one context doesn't carry to another.

Automated agent actions follow `docs/agent-action-rules.md` (propose → check → approve → apply; agents never decide about people or move money).
