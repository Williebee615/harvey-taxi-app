# DRAFT: Privacy Policy addition for the AI assistant (for owner approval)

**Status:** draft only. Not published, and not in effect.
- The model must not be enabled for real riders or drivers until the owner approves this text and it is published in `/privacy-policy.html`, with the "Last updated" date changed.
- Recommend review by legal counsel before publishing; this draft is not legal advice.

**Facts the owner or counsel should confirm** before publishing are marked **[confirm]**.

---

## Proposed new section: "Harvey Assistant (AI)"

The Harvey Taxi rider and driver apps include Harvey Assistant, an optional in-app assistant that answers questions about your rides, your account and our published policies.

**What the assistant processes.** When you use the assistant, we process:
- the message you type;
- up to your last six messages in the current conversation (kept on your device, so the assistant can follow up);
- account and trip details needed to answer. These are the same details shown to you in the app, such as your ride status, driver name and vehicle, pickup estimate and fare, or for drivers, ride offers, trip steps, earnings and hours.

**AI service provider.** To write its answers, the assistant uses Claude, an AI model provided by Anthropic, PBC. The information above is sent to Anthropic to generate each answer.
- Anthropic processes it as our service provider under its commercial terms. **[confirm: data processing addendum accepted in the Anthropic Console]**
- Anthropic does not use this information to train its models without our express permission. We have not given that permission.
- Anthropic keeps data according to its commercial data retention policy **[confirm the current retention period at privacy.claude.com]**. It may keep data longer where required by law, or where its automated safety systems flag a conversation (up to 2 years, per Anthropic's published documentation).

**What Harvey Taxi keeps.**
- We do not store your assistant conversations on our servers. Your recent messages stay on your device for the current app session, and are deleted when you tap Clear chat, sign out, or close the app.
- For security, quality and cost control, we keep a record of each assistant request: the time, your account, the topic, and the number of model tokens and cost. This record does not contain your message.
- When the assistant can't answer a question from our approved information, we keep a short excerpt of the question, with phone numbers, emails and card numbers removed, so our team can add the answer.
- If you choose to send a support request or lost-item report through the assistant, we keep the text you reviewed and approved, as described in "Support requests".

**What the assistant cannot do.**
- The assistant cannot change your rides or account on its own. Any change, such as cancelling a ride or accepting an offer, happens only after you confirm it in the app.
- The assistant is not an emergency service. In an emergency, call 911.

**Your choices.**
- Using the assistant is optional. Booking, your trips and support all work without it.
- Please don't share sensitive information, such as payment card numbers or health details, in the assistant.

---

## Where it goes

- Add the section to `public/privacy-policy.html`, after "3. Sharing of Information".
- In "3. Sharing of Information", add Anthropic to the list of service providers (or add a sentence that refers to the new section).
- Update the "Last updated" date.
- The assistant then cites the new section like any other approved page.
- If the app store privacy labels (Apple App Privacy, Google Play Data safety) list data shared with third parties, review them for "Other user content" or "Customer support" data sent to an AI provider **[confirm]**.
