// HTAF contact form (public/contact.html → POST /api/foundation/inquiry).
// Checks an inquiry and builds the email sent to HTAF's inbox. Nothing is
// stored: the inquiry exists only as that email. The form asks visitors
// not to send patient information or documents and takes no attachments.

const TOPICS = Object.freeze({
  partnership: "Partnership inquiry",
  donation: "Donation question",
  general: "General question"
});

const PARTNERSHIP_INTERESTS = Object.freeze({
  referrals: "Referring people for assistance",
  sponsorship: "Sponsoring transportation",
  community_programs: "Coordinating community programs",
  transportation_resources: "Providing transportation resources",
  other: "Something else"
});

const LIMITS = Object.freeze({ name: 100, organization: 150, email: 254, phone: 30, message: 1500 });
const MIN_MESSAGE = 10;

function text(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

// One line, for the email subject and field values that sit on one line.
function oneLine(value, max) {
  return text(value, max).replace(/\s+/g, " ");
}

function validateInquiry(body = {}) {
  const errors = {};
  const topic = Object.prototype.hasOwnProperty.call(TOPICS, body.topic) ? body.topic : "";
  const inquiry = {
    topic,
    name: oneLine(body.name, LIMITS.name),
    organization: oneLine(body.organization, LIMITS.organization),
    email: oneLine(body.email, LIMITS.email).toLowerCase(),
    phone: oneLine(body.phone, LIMITS.phone),
    interest: "",
    message: text(body.message, LIMITS.message)
  };

  if (!topic) errors.topic = "Choose what your message is about.";
  if (!inquiry.name) errors.name = "Enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inquiry.email)) errors.email = "Enter a valid email address.";
  if (inquiry.phone && !/^[0-9+().\-\s]{7,30}$/.test(inquiry.phone)) errors.phone = "Enter a valid phone number, or leave it blank.";
  if (inquiry.message.length < MIN_MESSAGE) errors.message = `Enter a short message (at least ${MIN_MESSAGE} characters).`;
  if (String(body.message || "").trim().length > LIMITS.message) errors.message = `Keep your message under ${LIMITS.message} characters.`;

  if (topic === "partnership") {
    if (!inquiry.organization) errors.organization = "Enter your organization.";
    if (Object.prototype.hasOwnProperty.call(PARTNERSHIP_INTERESTS, body.interest)) inquiry.interest = body.interest;
    else errors.interest = "Choose a partnership interest.";
  }

  return { ok: Object.keys(errors).length === 0, errors, inquiry };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function buildInquiryEmail(inquiry) {
  const topicLabel = TOPICS[inquiry.topic];
  const who = inquiry.organization || inquiry.name;
  const rows = [
    ["Topic", topicLabel],
    ["Name", inquiry.name],
    ["Organization", inquiry.organization || "Not given"],
    ["Email", inquiry.email],
    ["Phone", inquiry.phone || "Not given"]
  ];
  if (inquiry.topic === "partnership") rows.push(["Partnership interest", PARTNERSHIP_INTERESTS[inquiry.interest]]);
  const note = "Sent from the contact form on harveytransportationfoundation.com. Reply to this email to answer the sender.";
  return {
    subject: `HTAF ${topicLabel.toLowerCase()}: ${oneLine(who, 80)}`,
    text: `${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nMessage:\n${inquiry.message}\n\n${note}\n`,
    html:
      `<h2>Harvey Transportation Assistance Foundation: ${escapeHtml(topicLabel)}</h2>` +
      `<table cellpadding="4">${rows.map(([k, v]) => `<tr><th align="left">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</table>` +
      `<p><strong>Message</strong></p><p style="white-space:pre-wrap">${escapeHtml(inquiry.message)}</p>` +
      `<p style="color:#666">${escapeHtml(note)}</p>`
  };
}

module.exports = { TOPICS, PARTNERSHIP_INTERESTS, LIMITS, validateInquiry, buildInquiryEmail };
