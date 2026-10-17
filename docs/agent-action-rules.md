# Agent action rules

**Adopted:** 2026-10-17 (UTC), owner decision ("Write agent action rules").

**Applies to:** every automated agent in Harvey Taxi Service LLC and HTAF systems:
- the assistants (rule-based, pilot, Claude Haiku);
- the specialist and review assistants;
- the AI Agent Manager (dispatch coordination);
- any future agent, scheduled job or model that can cause a change.

Staff working through the admin dashboard are people, not agents, but rule 6 applies to them too.

Labels follow `CLAUDE.md`. **[Verified]** means the rule is already enforced in code, with the place it is enforced.

---

## The lifecycle every agent action follows

| Step | What happens | Who |
|---|---|---|
| **1. Propose** | The agent describes the action and why. It changes nothing. | Agent |
| **2. Check** | Code verifies the proposal against fixed rules: permissions, limits, state, policy text. A failed check stops the action. | Code (deterministic) |
| **3. Approve** | A person approves, or an owner-approved switch allows this exact kind of action automatically. | Person, or owner-approved switch |
| **4. Apply** | The change is written once, conditionally (only if nothing changed since step 2), together with its audit record. | Server |

**Reading data and answering from approved text** need only steps 1–2. **Any change to records, money, people's status or what the public sees** needs all four steps.

---

## Rules

### 1. Agents read; the server writes
Agents use defined tools only, never the database directly.
- **Read-only tools.** Tools are read-only unless the owner has approved a specific write action. Each call is checked against the caller's organization, role and identity.
- **[Verified]** The pilot refuses any tool not marked read-only (`lib/assistantPilot/tools.js`), with at most 3 tool calls per turn.
- **[Verified]** The assistant tools (`lib/agent/tools.js`) contain no database writes.
- **[Verified]** Both points are guarded by `test/agent-action-rules.test.js`.

### 2. Answers come from approved text
An agent's answer about policy, prices, fees or eligibility must quote approved, published text. If none covers the question, the agent says so and offers support.
- **[Verified]** Pilot answers are checked before display (`lib/assistantPilot/citations.js`):
  - every citation must point to a source provided for that turn;
  - links, emails and phone numbers must appear in those sources;
  - the answer must not claim an action was taken.

  A failed check replaces the reply with a direct quote.
- **[Verified]** Policy articles become quotable only after an admin approves the exact version. Any edit returns an article to draft.

### 3. The check step is code, not another model
The reflector or quality check is deterministic code with tests, so the same input always gets the same verdict and every verdict can be audited.
- **[Recommendation]** A second AI model may advise a person, but it never replaces a code check or a person's approval.

### 4. Automatic actions need an owner-approved switch, shadow mode first
An action may run without a person only when the owner has approved that exact action type, and a flag that defaults to off has been turned on.
- **Shadow first.** Before going live, the action runs in shadow mode: it records what it would have done and changes nothing, so the results can be reviewed.
- **[Verified]** Automatic redispatch (`lib/agent/policy.js`, `lib/agent/coordinator.js`) needs both `agent_automation_enabled` and `agent_auto_redispatch_enabled`. It runs only when shadow mode, dispatch pause and `agent_kill_switch` are all off. Shadow mode logs `would_redispatch` only.
- **[Verified]** It goes through the existing `dispatchRide()` after a conditional claim on the ride row, has a cooldown and an attempt cap, and hands the ride to a person when the cap is reached.

### 5. Kill switch overrides everything
A kill switch, or a dispatch pause, stops every automatic action immediately, whatever other flags say.
- **[Verified]** `agent_kill_switch` forces the mode to `killed` (`resolveAgentMode` in `lib/agent/policy.js`).

### 6. Every change is conditional and audited
A change is applied only if the record is still in the state that was checked. The change and its audit record are written together, recording who or what acted, the reason and the before/after.
- **[Verified]** Driver overrides use atomic database functions (`apply_driver_contact_verification_override`, `apply_driver_compliance_override`).
- **[Verified]** Merchant reviews use a conditional update on status with an audit entry.
- **[Verified]** Knowledge approvals require the reviewed version.

### 7. Decisions about people stay with people
No agent approves, rejects, activates, suspends or penalizes a rider, driver, merchant or HTAF applicant.
- **Recommendations are allowed.** Agents may summarize and recommend, but a person decides.
- **[Verified]** The driver and HTAF review assistants write nothing to the records they review (`docs/driver-review-assistant.md`, `docs/htaf-review-assistant.md`).
- **[Owner decision, standing]** No automatic suspension of drivers.

### 8. Money moves only with a person's approval
No agent issues a refund, charge, payout, deduction or credit.
- **Staging allowed.** An agent may stage one for review, with the amount, reason and evidence, for example a missing-item refund checked against the 48-hour window and the abuse limit.
- **A person approves** it before Stripe is called.
- **[Owner decision, standing]** No live refunds without approval.
- **[Recommendation]** Build money actions in Stripe test mode first.

### 9. Private data stays private
- **Own records only.** Agents see only the records the signed-in caller is entitled to.
- **Public visitors** see only public, approved text.
- **No PII in logs.** Logs and gap reports store topic labels or redacted excerpts, never contact details, payment data, identity documents or background-check results.
- **Credentials are never stored.** The admin token is typed for each use, and credentials never appear in prompts, logs, Git or chat.

### 10. Heavy model work runs outside the website
Embeddings and model calls run in separate services (the harvey-membrane private service; Claude via its API, within its budget). If those services fail, the website keeps working with keyword search and direct quotes.
- **[Verified]** Claude spending is checked against the owner-approved monthly budget before each model turn (`lib/agent/modelBudget.js`).

### 11. Approval doesn't carry over
An approval covers the action and scope it names, once. Each of the following needs its own explicit approval from the owner:
- every merge, migration, deploy, build, store upload or submission, paid upgrade and feature activation;
- turning on any automatic action;
- widening an existing approval.

Approval given in one context doesn't carry to another (`CLAUDE.md`).

---

## Adding a new agent action: checklist

1. Write the proposal format: what the action changes, and the evidence it relies on.
2. Write the check as a pure function with tests covering allowed, refused and edge cases.
3. Decide the approval route: a person per action (the default), or an owner-approved switch. A switch must default to off and start in shadow mode.
4. Apply with a conditional write plus an audit record, in one database function where possible.
5. Confirm the kill switch stops it.
6. Record the action, its flag and its approval in `docs/project-status.md`.
7. Get the owner's approval to merge, and separate approval to switch it on.
