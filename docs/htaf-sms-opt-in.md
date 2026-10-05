# HTAF text messages: opt-in and toll-free verification

HTAF (Harvey Transportation Assistance Foundation) only. Harvey Taxi Service LLC messaging is separate and is not part of this program or its registration.

## Program
- **Sender:** (844) 795-0299 (HTAF's toll-free number).
- **Who receives texts:** applicants who check the optional box on https://harveytransportationfoundation.com/htaf-application.html. The box is unchecked by default and is not required to apply.
- **Message types:** application updates, transportation scheduling, pickup reminders, service changes and support. No marketing.
- **Frequency:** varies. Message and data rates may apply.
- **Opt out:** reply STOP. Reply START or UNSTOP to opt back in. Reply HELP for help.

## Consent records (`htaf_sms_consents`)
- One row per event, written by the server:
  - `opt_in` or `declined`, from the application form, with the wording version (`htaf-sms-v1`), the source (`htaf-application-web-form`) and the server time;
  - `opt_out`, `opt_in_again` or `help`, from reply keywords.
- The content of reply messages is never stored.
- HTAF may text a number only when its latest opt-in or opt-out event is an opt-in (`lib/htafSms.js` `canText`). No record means no texts.
- An application is saved whether or not the consent row can be written.

## Before any HTAF text is sent
1. Toll-free verification approved for (844) 795-0299.
2. Migration `20261005120000_htaf_sms_consents.sql` applied.
3. In Twilio, set the number's "A message comes in" webhook to `https://harveytransportationfoundation.com/api/htaf/sms/inbound` (HTTP POST). Requests are checked against the Twilio signature for exactly that URL.
4. Set the HELP reply to the text below. This needs a Messaging Service containing the number. Twilio's default HELP reply does not name HTAF.
5. Test from a personal phone: HELP, STOP (the carrier sends its "NETWORK MSG" confirmation), then START. Confirm the `opt_out` and `opt_in_again` rows.
6. Set `HTAF_SMS_FROM_NUMBER=+18447950299` and `HTAF_SMS_ENABLED=true` on the server.
   - Until then nothing is sent.
   - The sender never falls back to Harvey Taxi's `TWILIO_FROM_NUMBER`.

## HELP reply text
HTAF (Harvey Transportation Assistance Foundation): For help, email WillieHtaf@harveytransportationfoundation.com or call 615-636-6201. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.

## Welcome text (sent once after an opt-in, only when enabled)
HTAF (Harvey Transportation Assistance Foundation): You're signed up for texts about your transportation-assistance application. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.

## Changing the consent wording
1. Add a new version to `CONSENT_TEXT` in `lib/htafSms.js`.
2. Update the form to match. The page test requires the form's text to equal the current version.
3. Keep the old versions: records refer to them.
