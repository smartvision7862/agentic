import { chatJSON, assistantFastModel } from "./openrouter.js";

// Fixed category enum — the panel groups by these, so the LLM must pick one.
export const CATEGORIES = [
  "Food", "Groceries", "Travel", "Shopping", "Bills", "Subscription",
  "Entertainment", "Health", "Salary", "Investment", "Transfer", "Other",
];

// Currency amount anywhere in the text (₹, Rs, INR, $).
const AMOUNT_RE = /(?:₹|rs\.?|inr|usd|\$)\s?([\d,]+(?:\.\d{1,2})?)/i;
const EXPENSE_WORDS = /\b(debited|spent|paid|purchase|payment of|charged|withdrawn|order)\b/i;
const INCOME_WORDS = /\b(credited|received|refund|payout|salary|deposited|cashback)\b/i;

// Cheap pre-check: skip messages with no monetary signal at all.
export function looksTransactional(msg) {
  const blob = `${msg.subject || ""} ${msg.snippet || ""} ${msg.body || ""}`;
  if (!AMOUNT_RE.test(blob)) return false;
  return EXPENSE_WORDS.test(blob) || INCOME_WORDS.test(blob) || /transaction|invoice|receipt/i.test(blob);
}

const SYSTEM = `You extract a single financial transaction from an email. Respond ONLY with JSON:
{"is_transaction": boolean, "type": "expense"|"income", "amount": number, "currency": string,
 "category": one of [${CATEGORIES.join(", ")}], "merchant": string, "occurred_at": "YYYY-MM-DD"}
Rules:
- is_transaction is false for newsletters, promotions, OTPs, or anything with no real money movement.
- amount is the numeric value only (no currency symbol or commas).
- type: money leaving the user = "expense"; money arriving = "income".
- pick the single closest category from the provided list; use "Other" if unsure.
- occurred_at: the transaction date if stated, else the email date.`;

/**
 * Extract a structured transaction from one email message.
 * @param {{subject, from_name, from_addr, body, snippet, internal_date}} msg
 * @returns {Promise<null | {type, amount, currency, category, merchant, occurred_at}>}
 */
export async function extractTransaction(msg) {
  if (!looksTransactional(msg)) return null;

  const emailDate = msg.internal_date
    ? new Date(msg.internal_date).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const body = (msg.body || msg.snippet || "").slice(0, 4000);
  const userContent =
    `Email date: ${emailDate}\n` +
    `From: ${msg.from_name || ""} <${msg.from_addr || ""}>\n` +
    `Subject: ${msg.subject || ""}\n\n` +
    `Body:\n${body}`;

  let parsed;
  try {
    parsed = await chatJSON([
      { role: "system", content: SYSTEM },
      { role: "user", content: userContent },
    ], { model: assistantFastModel() });
  } catch {
    return null;
  }

  if (!parsed || parsed.is_transaction !== true) return null;
  const amount = Number(parsed.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const type = parsed.type === "income" ? "income" : "expense";
  const category = CATEGORIES.includes(parsed.category) ? parsed.category : "Other";

  return {
    type,
    amount,
    currency: (parsed.currency || "INR").toUpperCase().slice(0, 6),
    category,
    merchant: parsed.merchant || msg.from_name || null,
    occurred_at: /^\d{4}-\d{2}-\d{2}$/.test(parsed.occurred_at) ? parsed.occurred_at : emailDate,
  };
}
