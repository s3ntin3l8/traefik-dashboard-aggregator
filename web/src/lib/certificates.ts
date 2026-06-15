// Pure certificate expiry math, lifted out of views/Certificates.tsx and
// views/Overview.tsx so the (duplicated) day/status calculations live in one
// tested place. `now` is always passed in so the functions stay deterministic.
import type { Certificate } from "./types";

export type CertHealth = "valid" | "expiring" | "expired";

const MS_PER_DAY = 86400000;

// Whole days until expiry (negative once expired). Floored to match the prior
// inline `Math.floor((notAfter - now) / 86400000)`.
export function daysUntilExpiry(notAfter: number, now: number): number {
  return Math.floor((notAfter - now) / MS_PER_DAY);
}

export function certStatus(days: number): CertHealth {
  return days < 0 ? "expired" : days <= 21 ? "expiring" : "valid";
}

export interface CertCounts {
  total: number;
  valid: number;
  expiring: number;
  expired: number;
}

export function summarizeCerts(certs: Certificate[], now: number): CertCounts {
  const m: CertCounts = { total: certs.length, valid: 0, expiring: 0, expired: 0 };
  for (const c of certs) {
    m[certStatus(daysUntilExpiry(c.notAfter, now))]++;
  }
  return m;
}

// Count certs expiring within `withinDays` (includes already-expired). Equivalent
// to the Overview's `(notAfter - now) / 86400000 < 21` since floor(x) < n ⟺ x < n.
export function countExpiringSoon(certs: Certificate[], now: number, withinDays = 21): number {
  return certs.filter((c) => daysUntilExpiry(c.notAfter, now) < withinDays).length;
}
