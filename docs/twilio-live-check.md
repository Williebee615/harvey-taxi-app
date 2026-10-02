# Twilio live check

`scripts/twilio-live-check.js` checks the real Twilio account behind Harvey Taxi's SMS. Its default mode is **read-only and sends no SMS** (no cost). Sending one real Verify code is a separate, explicitly authorized step.

## What it checks

| Check | Host | What passes |
|---|---|---|
| `account` | `api.twilio.com` | The account exists and its status is `active` |
| `verify_service` | `verify.twilio.com` | `TWILIO_VERIFY_SERVICE_SID` exists (used by rider and driver sign-in) |
| `from_number` | `api.twilio.com` | `TWILIO_FROM_NUMBER` belongs to the account and can send SMS |
| `tollfree_verification` | `messaging.twilio.com` | For a toll-free `TWILIO_FROM_NUMBER`: Twilio's toll-free verification is `TWILIO_APPROVED`. Until it is, ordinary SMS from that number is undelivered with error 30032 (`docs/production-incidents.md`, 2026-07-31). |
| `verify_send` *(opt-in)* | `verify.twilio.com` | One Verify code is sent to the named number (`pending`) |
| `verify_check` *(opt-in)* | `verify.twilio.com` | The code received on that phone is `approved` |

## Network domains required

- `api.twilio.com`
- `verify.twilio.com`
- `messaging.twilio.com`

In a Claude Code cloud environment, add these under the environment's **Network access** settings. The running server itself only needs `api.twilio.com` and `verify.twilio.com`.

## Credentials

From the environment only, never pasted into chat or committed:

- `TWILIO_ACCOUNT_SID`, plus either `TWILIO_AUTH_TOKEN` or an API key pair (`TWILIO_API_KEY_SID` and `TWILIO_API_KEY_SECRET`). An API key scoped to this check can be revoked afterwards without touching production's auth token.
- `TWILIO_VERIFY_SERVICE_SID` and `TWILIO_FROM_NUMBER`: the same values as production.
- When an egress proxy injects Twilio authentication, leave the token unset; the script then sends no `Authorization` header of its own.

Twilio's test credentials don't cover Verify, account or toll-free lookups, so this check uses the real account. The read-only mode makes only `GET` requests.

The script prints statuses, Twilio error codes and the last two digits of phone numbers. It never prints credentials, codes or full numbers.

## Running it

```
# Read-only (no SMS, no cost):
node scripts/twilio-live-check.js

# Only with the owner's written authorization of the test number and the cost:
node scripts/twilio-live-check.js --send-verify --to +1XXXXXXXXXX --i-authorize-one-sms
node scripts/twilio-live-check.js --check-verify --to +1XXXXXXXXXX --code <code received>
```

Behind an HTTPS proxy, prefix each command with `NODE_USE_ENV_PROXY=1` (Node 22.21 or later). Exit codes: `0` all checks passed, `1` a check failed, `2` usage or network error.

**Sending is refused** unless `--to` is a valid number and `--i-authorize-one-sms` is present. Each authorized run sends exactly one Verify SMS, which Twilio bills to the account.
