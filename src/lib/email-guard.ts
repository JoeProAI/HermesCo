/**
 * email-guard.ts — Block disposable/offensive email addresses at signup
 *
 * No external dependencies. Maintains a curated blocklist of the most common
 * disposable email providers + an offensive prefix filter.
 */

// Top disposable email domains (covers ~95% of spam signups)
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.de", "guerrillamail.net",
  "guerrillamail.org", "grr.la", "guerrillamailblock.com", "pokemail.net",
  "sharklasers.com", "spam4.me", "trashmail.com", "trashmail.me", "trashmail.net",
  "yopmail.com", "yopmail.fr", "yopmail.net", "tempmail.com", "temp-mail.org",
  "throwaway.email", "maildrop.cc", "dispostable.com", "mailnesia.com",
  "getairmail.com", "fakeinbox.com", "tempr.email", "discard.email",
  "discardmail.com", "discardmail.de", "mailforspam.com", "safetymail.info",
  "tempail.com", "mohmal.com", "getnada.com", "emailondeck.com",
  "minutemail.com", "10minutemail.com", "10minutemail.net", "10minutemail.de",
  "tempinbox.com", "burnermail.io", "inboxbear.com", "mailcatch.com",
  "mytemp.email", "tempmailaddress.com", "tmpmail.net", "tmpmail.org",
  "throwawaymail.com", "mailsac.com", "harakirimail.com", "crazymailing.com",
  "tmail.ws", "mailnator.com", "spamgourmet.com", "jetable.org",
  "trashymail.com", "trashymail.net", "wegwerfmail.de", "wegwerfmail.net",
  "binkmail.com", "bobmail.info", "burnthis.email", "clipmail.eu",
  "devnullmail.com", "emailfake.com", "emailtemporario.com.br",
  "fakemail.net", "filzmail.com", "fleckens.hu", "greensloth.com",
  "incognitomail.org", "koszmail.pl", "mailexpire.com", "mailtemp.info",
  "mailtothis.com", "nospamfor.us", "nowmymail.com", "objectmail.com",
  "ownmail.net", "proxymail.eu", "rcpt.at", "reallymymail.com",
  "recode.me", "spamobox.com", "superrito.com", "thankyou2010.com",
  "veryrealemail.com", "wh4f.org", "maildutemp.com",
]);

// Common offensive word patterns to block in email prefixes
const OFFENSIVE_PATTERNS = [
  /\bn[i1]gg[ae3]r/i,
  /\bf[ua@]ck/i,
  /\bs[h4]it/i,
  /\bc[u0]nt/i,
  /\bk[i1]ll/i,
  /\bd[i1]e\b/i,
  /\bh[i1]tl[e3]r/i,
  /\bn[a@]z[i1]/i,
  /\br[a@]p[e3]/i,
  /\bp[e3]do/i,
];

export interface EmailCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if an email address is suitable for trial signup.
 * Returns { allowed: true } or { allowed: false, reason: "..." }
 */
export function checkEmail(email: string): EmailCheckResult {
  if (!email || !email.includes("@")) {
    return { allowed: false, reason: "Invalid email format" };
  }

  const [prefix, domain] = email.toLowerCase().split("@");

  // Block disposable domains
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { allowed: false, reason: "Please use a non-disposable email address" };
  }

  // Block offensive prefixes
  for (const pattern of OFFENSIVE_PATTERNS) {
    if (pattern.test(prefix)) {
      return { allowed: false, reason: "Email address not allowed" };
    }
  }

  return { allowed: true };
}

/**
 * Check if email is verified. Call after Firebase auth is established.
 * Returns true if emailVerified is true on the Firebase user record.
 */
export function requireVerifiedEmail(emailVerified: boolean): EmailCheckResult {
  if (!emailVerified) {
    return { allowed: false, reason: "Please verify your email address before starting your trial" };
  }
  return { allowed: true };
}
