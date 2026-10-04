// Catches mistyped email addresses at well-known providers ("gmial.com",
// "yahho.com", "gmail.con") so the person can fix them before the link is
// sent to nowhere. It only ever suggests; the address is never changed for
// them, because a company's own domain can look like a typo of a big one.
const KNOWN_DOMAINS = [
  // Google
  "gmail.com",
  "googlemail.com",
  // Microsoft
  "outlook.com",
  "outlook.in",
  "outlook.co.uk",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.it",
  "hotmail.de",
  "live.com",
  "live.co.uk",
  "msn.com",
  // Yahoo
  "yahoo.com",
  "yahoo.in",
  "yahoo.co.in",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.es",
  "yahoo.it",
  "yahoo.com.br",
  "yahoo.com.au",
  "yahoo.ca",
  "ymail.com",
  "rocketmail.com",
  // Apple
  "icloud.com",
  "me.com",
  "mac.com",
  // Privacy-focused
  "proton.me",
  "protonmail.com",
  "pm.me",
  "tutanota.com",
  "tuta.io",
  "hey.com",
  "fastmail.com",
  // Other big ones
  "aol.com",
  "zoho.com",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "web.de",
  "yandex.com",
  "yandex.ru",
  "mail.ru",
  "rediffmail.com",
  "qq.com",
  "163.com",
  "126.com",
  "naver.com",
  "daum.net",
  "comcast.net",
  "verizon.net",
  "att.net",
  "sbcglobal.net",
  "bellsouth.net",
  "cox.net",
  "charter.net",
  "btinternet.com",
  "sky.com",
  "virginmedia.com",
  "orange.fr",
  "free.fr",
  "laposte.net",
  "libero.it",
  "t-online.de",
  "bol.com.br",
  "uol.com.br",
  "terra.com.br",
  "rogers.com",
  "shaw.ca",
  "optusnet.com.au",
];

const KNOWN = new Set(KNOWN_DOMAINS);

// Ways people mistype the ending of an address.
const TLD_FIXES: Record<string, string> = {
  con: "com",
  cim: "com",
  vom: "com",
  xom: "com",
  cpm: "com",
  ocm: "com",
  om: "com",
  cm: "com",
  comm: "com",
  coom: "com",
  "co.in": "com",
  net: "com",
};

// Edit distance where swapping two neighbouring letters counts as one slip.
function distance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(
        grid[i - 1][j] + 1,
        grid[i][j - 1] + 1,
        grid[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        grid[i][j] = Math.min(grid[i][j], grid[i - 2][j - 2] + 1);
      }
    }
  }
  return grid[a.length][b.length];
}

// Returns a corrected full address, or null when it looks fine.
export function suggestEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain.includes(".") || KNOWN.has(domain)) return null;

  let best: { domain: string; score: number } | null = null;
  const consider = (candidate: string, score: number) => {
    if (!best || score < best.score) best = { domain: candidate, score };
  };

  // "gmail.con" -> "gmail.com": right name, wrong ending.
  const firstDot = domain.indexOf(".");
  const name = domain.slice(0, firstDot);
  const ending = domain.slice(firstDot + 1);
  const fixedEnding = TLD_FIXES[ending];
  if (fixedEnding) {
    const repaired = `${name}.${fixedEnding}`;
    if (KNOWN.has(repaired)) consider(repaired, 0);
  }

  for (const candidate of KNOWN_DOMAINS) {
    // Longer names tolerate two slips, short ones only one, so "me.com"
    // doesn't swallow every short domain.
    const allowed = candidate.length >= 9 ? 2 : 1;
    const score = distance(domain, candidate);
    if (score <= allowed) consider(candidate, score);
  }

  return best ? `${local}@${(best as { domain: string }).domain}` : null;
}
