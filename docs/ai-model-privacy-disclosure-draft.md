# DRAFT: Harvey Assistant AI disclosure (for owner approval)

Status: **draft. Not published and not in the apps.** The model stays off for real users until the owner approves this text and `AGENT_MODEL_PUBLIC_APPROVED=true` is set (`docs/ai-model.md`).

Items marked **[VERIFY]** must be checked against Anthropic's current Commercial Terms and Privacy Center before publishing. Counsel should review the final text.

---

## A. Privacy Policy section (proposed)

**Harvey Assistant and AI service providers**

Harvey Assistant is the in-app helper in the Harvey Taxi and Harvey Taxi Driver apps. Some Harvey Assistant answers are written with help from an AI model provided by Anthropic, PBC ("Anthropic"), acting as our service provider.

When you use Harvey Assistant, we may send Anthropic:
- the question you type;
- up to six of your most recent messages in the same assistant conversation, so the assistant can follow up;
- only the account information needed to answer your question. For riders, examples are your current ride's status, ride type, pickup estimate, fare, and your driver's name and vehicle. For drivers, examples are ride offers, the active trip's status with its pickup and drop-off addresses, hours online, or recorded earnings.

We do not send Anthropic your password, payment card details, full phone number, email address, or government ID or driver documents.

Questions about emergencies, fraud, disputed charges, refunds, account actions or driver screening are handled by fixed Harvey Taxi responses and are not sent to the AI model. **If you are in danger, call 911.**

Anthropic processes this information to generate the response on our behalf. [VERIFY: Anthropic's commercial terms do not permit training its models on API customer data by default, and state how long API inputs and outputs are retained.]

Harvey Taxi does not store the text of your questions with the AI usage records. We keep counts of AI usage and cost to manage our service. Our existing assistant audit records apply as described elsewhere in this policy. [VERIFY: the current Privacy Policy describes those records.]

The AI never takes actions on your account. Any change, such as cancelling a ride or accepting an offer, requires you to confirm it in the app. AI-written answers can be wrong. For anything important, check the ride details in the app or contact Harvey Taxi support.

## B. In-app notice (proposed, shown once above the assistant chat)

> Harvey Assistant may use AI (provided by Anthropic) to answer. Your question and the ride details needed to answer it are shared to write the reply. Don't share passwords or card numbers. Emergencies: call 911. [Learn more → Privacy Policy]

## C. Owner decisions needed

1. Approve, or edit, sections A and B.
2. Confirm the [VERIFY] items, or ask us to research them with sources.
3. Decide whether riders and drivers get an opt-out that keeps rules-only answers. This is not built yet.
4. Decide whether HTAF's privacy page (`public/htaf-privacy.html`) also needs this section. This depends on whether HTAF programs use the assistant.
