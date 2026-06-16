// Disposable / throwaway email domain blocklist.
// Keeps signup spam out without requiring captcha/reCAPTCHA infra.
// Curated from observed spam patterns + common temp-mail providers.
// Update by appending; do NOT remove entries without checking support tickets.

const DISPOSABLE_DOMAINS = new Set<string>([
  // Observed on clawd.run (the 48 purged on 2026-04-22)
  "linshiyou.com",
  "aipioneer.icu",
  "hkvtop.us",
  "hdcroom.us",
  "justdefinition.com",
  "mastermail.homes",
  "dollicons.com",
  "nigge.rs",

  // Major temp-mail providers
  "10minutemail.com", "10minutemail.net",
  "mailinator.com", "mailinator.net",
  "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz", "guerrillamail.de",
  "sharklasers.com",
  "tempmail.com", "tempmail.net", "tempmail.org", "temp-mail.org", "temp-mail.io", "tempmailo.com",
  "yopmail.com", "yopmail.net", "yopmail.fr",
  "throwawaymail.com",
  "dispostable.com",
  "maildrop.cc",
  "mailnesia.com",
  "getnada.com", "nada.email",
  "trashmail.com", "trashmail.net", "trashmail.de",
  "fakemailgenerator.com",
  "emailondeck.com",
  "spambog.com", "spambog.de", "spambog.ru",
  "mohmal.com",
  "mytemp.email",
  "inboxbear.com",
  "moakt.com", "moakt.cc",
  "mail-temp.com",
  "temp-inbox.me",
  "disposablemail.com",
  "mt2014.com", "mt2015.com",
  "emltmp.com",
  "tempm.com",
  "burnermail.io",
  "anonbox.net",
  "owlymail.com",
  "mintemail.com",
  "tmpmail.org", "tmpmail.net",
  "fakeinbox.com",
  "gettempmail.com",
  "getairmail.com",
  "mail-tester.com",
  "spamgourmet.com",
  "mailsac.com",
  "mailcatch.com",
  "mailchop.com",
  "jetable.org",
  "harakirimail.com",

  // High-abuse free-domain patterns
  "example.com", "example.net", "example.org",
  "test.com",
  "mail.com",

  // Disposable TLDs frequently abused (also checked via TLD logic below)
]);

// TLDs that are overwhelmingly disposable / throwaway on signup pages.
// Legitimate users almost never use these; allow exceptions via domain allowlist if needed.
const DISPOSABLE_TLDS = new Set<string>([
  "icu",
  "top",
  "click",
  "xyz",     // note: some legit users — see ALLOWLIST below
  "monster",
  "buzz",
  "cyou",
  "rest",
  "best",
]);

// Specific legitimate domains on otherwise-suspicious TLDs.
const TLD_ALLOWLIST = new Set<string>([
  // If a legit user on .xyz shows up, add here: "coolstartup.xyz"
]);

export interface DisposableCheck {
  ok: boolean;
  reason?: "disposable-domain" | "disposable-tld" | "invalid-email";
  domain?: string;
}

export function checkEmailDomain(email: string): DisposableCheck {
  if (!email || typeof email !== "string") return { ok: false, reason: "invalid-email" };
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at < 1 || at === normalized.length - 1) return { ok: false, reason: "invalid-email" };
  const domain = normalized.slice(at + 1);
  if (!domain.includes(".")) return { ok: false, reason: "invalid-email" };

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { ok: false, reason: "disposable-domain", domain };
  }

  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (DISPOSABLE_TLDS.has(tld) && !TLD_ALLOWLIST.has(domain)) {
    return { ok: false, reason: "disposable-tld", domain };
  }

  return { ok: true, domain };
}

// Gmail canonicalization: joe.smith+anything@gmail.com == joesmith@gmail.com.
// Use when checking for duplicate signups or abuse patterns.
export function canonicalizeEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const plusIdx = local.indexOf("+");
    const base = plusIdx >= 0 ? local.slice(0, plusIdx) : local;
    return `${base.replace(/\./g, "")}@gmail.com`;
  }
  return e;
}
