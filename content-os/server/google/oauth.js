import { google } from "googleapis";
import { config } from "../config.js";
import { getGmailTokens, saveGmailTokens } from "../db.js";

export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export function gmailConfigured() {
  return Boolean(config.googleClientId && config.googleClientSecret);
}

function requireConfig() {
  if (!gmailConfigured()) {
    throw new Error(
      "Gmail not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env"
    );
  }
}

// A bare OAuth2 client (no credentials set). Used for building the consent URL
// and exchanging the authorization code.
export function makeOAuthClient() {
  requireConfig();
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );
}

// access_type:offline + prompt:consent are required to receive a refresh_token.
export function buildAuthUrl() {
  return makeOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
  });
}

// Exchange the ?code from the callback, persist tokens, and capture the email.
export async function exchangeCode(code) {
  const client = makeOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  let email = null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const me = await oauth2.userinfo.get();
    email = me.data?.email ?? null;
  } catch {
    /* email is best-effort; gmail.readonly alone may not include profile */
  }

  saveGmailTokens({
    email,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    scope: tokens.scope,
    token_type: tokens.token_type,
    expiry_date: tokens.expiry_date,
  });
  return getGmailTokens();
}

// An authorized client built from stored tokens. Persists silently-refreshed
// tokens back to the DB via the client "tokens" event.
export function getAuthorizedClient() {
  requireConfig();
  const stored = getGmailTokens();
  if (!stored || !stored.refresh_token) {
    throw new Error("Gmail not connected — connect it from the dashboard first");
  }
  const client = makeOAuthClient();
  client.setCredentials({
    access_token: stored.access_token,
    refresh_token: stored.refresh_token,
    scope: stored.scope,
    token_type: stored.token_type,
    expiry_date: stored.expiry_date,
  });
  client.on("tokens", (tokens) => {
    saveGmailTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token, // undefined on refresh → COALESCE keeps old
      scope: tokens.scope,
      token_type: tokens.token_type,
      expiry_date: tokens.expiry_date,
    });
  });
  return client;
}
