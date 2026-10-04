// Held-out questions (written 2026-10-04 after the matching was tuned on
// questions.js). Run them WITHOUT changing thresholds to estimate accuracy
// on questions the matcher has not seen. When one of these is used to fix
// the matcher, move it to questions.js and write a new held-out question.
//
// Expectations were written from the published pages before running.

const RIDER = [
  { q: "Will you tell my driver my home address?", intent: "policy_question", source: "/privacy-policy.html#3. Sharing of Information" },
  { q: "Can I get my information erased?", intent: "general_help", source: "/privacy-policy.html#7. Your Choices" },
  { q: "Who processes my card payments?", intent: "general_help", source: "/privacy-policy.html#4. Payment Information" },
  { q: "Is my information kept secure?", intent: "general_help", source: "/privacy-policy.html#5. Data Security" },
  { q: "Does Harvey Taxi collect information from children?", intent: "general_help", source: "/privacy-policy.html#8. Children’s Privacy" },
  { q: "What am I responsible for as a user?", intent: "general_help", source: "/terms.html#User Responsibilities" },
  { q: "Can Harvey Taxi reject my ride request?", intent: "general_help", source: "/terms.html#Ride Requests and Availability" },
  { q: "What is Harvey Taxi liable for?", intent: "policy_question", source: "/terms.html#Limitation of Liability" },
  { q: "What email do I use to reach the support team?", intent: "general_help", source: "/support.html#Contact Harvey Taxi" },
  { q: "Do you track where I am?", intent: "general_help", source: "/privacy-policy.html#1. Information We Collect" },
  { q: "Do you offer rides to the airport for a flat rate?", gap: true },
  { q: "How much do you charge per mile?", intent: "fare_info" },
  { q: "Is there a fee if my driver waits for me?", gap: true },
  { q: "Can I book a car seat for my child?", gap: true }
];

const DRIVER = [
  { q: "Am I close to the limit on my hours?", intent: "driver_hours", includes: ["12 h"] },
  { q: "When can I go back online after resting?", intent: "driver_hours", includes: ["6 h"] },
  { q: "Who sees my live location while I'm driving?", intent: "policy_question", source: "/privacy-policy.html#3. Sharing of Information" },
  { q: "What happens to my data if I close my driver account?", intent: "general_help", source: "/privacy-policy.html#6. Data Retention" },
  { q: "What insurance do I need to drive for Harvey Taxi?", gap: true },
  { q: "How old does my car need to be?", gap: true }
];

module.exports = { RIDER, DRIVER };
