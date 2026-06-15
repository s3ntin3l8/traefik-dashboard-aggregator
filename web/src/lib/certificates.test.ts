import { describe, it, expect } from "vitest";
import { daysUntilExpiry, certStatus, summarizeCerts, countExpiringSoon } from "./certificates";
import type { Certificate } from "./types";

const DAY = 86400000;
const NOW = new Date("2026-01-01T00:00:00Z").getTime();

function cert(daysFromNow: number, over: Partial<Certificate> = {}): Certificate {
  return {
    id: `c${daysFromNow}`,
    domain: "x.test",
    wildcard: false,
    sans: [],
    resolver: "le",
    issuer: "LE",
    issuerCN: "R3",
    serial: "00",
    keyType: "RSA",
    notBefore: NOW - DAY,
    notAfter: NOW + daysFromNow * DAY,
    instance: "edge",
    status: "valid",
    ...over,
  };
}

describe("daysUntilExpiry", () => {
  it("floors the day difference and goes negative once expired", () => {
    expect(daysUntilExpiry(NOW + 5 * DAY, NOW)).toBe(5);
    expect(daysUntilExpiry(NOW + 5 * DAY + DAY / 2, NOW)).toBe(5); // floored
    expect(daysUntilExpiry(NOW - 2 * DAY, NOW)).toBe(-2);
  });
});

describe("certStatus", () => {
  it("classifies by day thresholds (<0 expired, <=21 expiring, else valid)", () => {
    expect(certStatus(-1)).toBe("expired");
    expect(certStatus(0)).toBe("expiring");
    expect(certStatus(21)).toBe("expiring");
    expect(certStatus(22)).toBe("valid");
  });
});

describe("summarizeCerts", () => {
  it("counts totals and each health bucket", () => {
    const certs = [cert(-3), cert(0), cert(10), cert(21), cert(60)];
    expect(summarizeCerts(certs, NOW)).toEqual({ total: 5, valid: 1, expiring: 3, expired: 1 });
  });

  it("returns zeroed counts for an empty list", () => {
    expect(summarizeCerts([], NOW)).toEqual({ total: 0, valid: 0, expiring: 0, expired: 0 });
  });
});

describe("countExpiringSoon", () => {
  it("counts certs within the window (default 21d), including already-expired", () => {
    const certs = [cert(-5), cert(20), cert(21), cert(40)];
    // -5 and 20 are < 21; 21 is excluded; 40 excluded.
    expect(countExpiringSoon(certs, NOW)).toBe(2);
  });

  it("honors a custom withinDays threshold", () => {
    expect(countExpiringSoon([cert(3), cert(8)], NOW, 5)).toBe(1);
  });
});
