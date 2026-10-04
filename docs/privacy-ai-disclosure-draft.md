# DRAFT: Privacy Policy addition for the AI assistant (for owner approval)

**Status:** draft for the owner's review. **Not published and not in effect.**
- Model answers stay limited to synthetic test accounts until the owner approves this text, it is published in `/privacy-policy.html` with an updated "Last updated" date, and the owner sets `AGENT_MODEL_PUBLIC_APPROVED=true`.
- Recommend review by legal counsel; this draft is not legal advice.

## Anthropic's terms this draft relies on (checked 2026-10-04)

| Statement in the draft | Source | How it was checked |
|---|---|---|
| Not used to train models without express permission | Anthropic, "API and data retention" (platform.claude.com/docs/en/manage-claude/api-and-data-retention): "Retained data is never used for model training without your express permission." | Read directly |
| Conversation content is not retained by default (Claude Haiku 4.5 is not a "Covered Model") | Same page: "Conversation content (your prompts and Claude's outputs) is not retained by default; the exception is Covered Models, which require 30-day retention." Covered Models listed: Claude Fable 5.1, Mythos 5.1, Fable 5, Mythos 5. | Read directly |
| Deleted within 30 days | Anthropic Privacy Center, "How long do you store my organization's data?" (privacy.claude.com/en/articles/7996866): inputs and outputs are deleted within 30 days of receipt or generation, with exceptions. | Search summary of the official page; the page itself is blocked from this environment. **[owner to open the page and confirm]** |
| Flagged content: up to 2 years (safety scores up to 7 years) | API data retention page: "if a chat or session is flagged, Anthropic may retain inputs and outputs for up to 2 years." Privacy Center: classification scores up to 7 years. | 2 years read directly; 7 years from search summary **[confirm]** |
| Retention where required by law | API data retention page: "Anthropic may retain data where required by law…" | Read directly |
| Anthropic acts as Harvey Taxi's data processor | API data retention page: on the Claude API "Anthropic is the data processor." | Read directly. **[Owner: accept Anthropic's Data Processing Addendum in the Console if offered; counsel to confirm.]** |

---

## Proposed new Privacy Policy section

### Harvey Assistant (AI)

The Harvey Taxi rider and driver apps include Harvey Assistant, an optional in-app assistant that answers questions about your rides, your account and our published policies. Some answers are written by an artificial intelligence (AI) model.

**What the assistant uses.** When you use the assistant, we use:
- the message you type;
- up to your last six messages in the current conversation, which stay on your device, so the assistant can understand follow-up questions;
- the account and trip details needed to answer. These are the same details the app already shows you:
  - for riders: ride status, driver first name and vehicle, pickup estimate and fare;
  - for drivers: ride offers, trip steps and addresses, earnings and hours online.

**Our AI service provider.** The assistant uses Claude, an AI model provided by Anthropic, PBC, to write its answers. The information above is sent to Anthropic, which processes it on our behalf as our service provider.
- Anthropic does not use this information to train its AI models without our express permission. We have not given that permission.
- Anthropic deletes this information within 30 days.
- Anthropic may keep information longer where the law requires it, or if its automated safety systems flag a conversation as possibly violating its usage policy. In that case it may keep the conversation for up to 2 years, and its safety classification for up to 7 years.

**What Harvey Taxi keeps.**
- We don't store your assistant conversations on our servers. Your recent messages stay on your device for the current app session. They are deleted when you tap Clear chat, sign out, or close the app.
- For each assistant request we keep a record for security, quality and cost control: the time, your account, the type of question, which app you used, and the amount of AI processing used and its cost. This record does not include your message.
- When the assistant can't answer from our approved information, we keep a short excerpt of the question, with phone numbers, email addresses and card numbers removed, so our team can add an approved answer.
- If you choose to send a support request or lost-item report through the assistant, we keep the text you reviewed and approved and send it to our support team, as described in "Support requests" below.

**Support requests.** If you tap "Send a request to support" or "Report a lost item":
- the assistant prepares a draft;
- you can edit it, and nothing is sent until you tap Send;
- we keep the text you approved, your account and, if you choose, the trip it relates to, in our support records, and email a copy to support@harveytaxiservice.com;
- phone numbers, email addresses and card numbers you type are masked.

**What the assistant cannot do.**
- It cannot change your rides or your account on its own. Any change happens only after you confirm it in the app, for example cancelling a ride or accepting a ride offer.
- AI answers can be wrong. Our policies and your app screens are the authoritative source.
- The assistant is not an emergency service. In an emergency, call 911.

**Your choices.**
- Using the assistant is optional. Booking, your trips and our support page all work without it.
- Please don't share sensitive information in the assistant, such as payment card numbers, passwords or health details.
- For questions about this section, contact support@harveytaxiservice.com.

---

## Also update

1. **"3. Sharing of Information":** add "AI service providers (Anthropic, PBC) that help us answer your questions in Harvey Assistant, as described in 'Harvey Assistant (AI)'."
2. **"Last updated" date** on the Privacy Policy.
3. **App store privacy labels:**
   - **Apple App Privacy:** confirm the data types now processed by a third party, such as "Other User Content" and "Customer Support".
   - **Google Play Data safety:** declare data "shared" with a service provider. Data sent to a service provider acting on your behalf may be exempt as "not shared" under Google's definition. **[confirm with counsel]**
4. **Terms of Service** (optional): a sentence that assistant answers are informational and may contain mistakes.

The assistant quotes the published Privacy Policy as an approved source, so once this is published it can answer "Do you use AI?" with a source link.
