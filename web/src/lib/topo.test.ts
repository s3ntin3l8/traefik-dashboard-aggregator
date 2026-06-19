import { describe, it, expect } from "vitest";
import { hostFromServer, isIPv4, sameSubnet24, externalBackends, findService } from "./topo";
import type { Service, Server, Snapshot } from "./types";

// ---------------------------------------------------------------------------
// hostFromServer
// ---------------------------------------------------------------------------
describe("hostFromServer", () => {
  it("extracts host from http url", () => {
    expect(hostFromServer({ url: "http://10.0.0.11:80", status: "UP" })).toBe("10.0.0.11");
  });
  it("extracts host from https url", () => {
    expect(hostFromServer({ url: "https://192.168.100.50:8443", status: "UP" })).toBe("192.168.100.50");
  });
  it("extracts host from bare host:port address", () => {
    expect(hostFromServer({ address: "10.0.0.5:9000", status: "UP" })).toBe("10.0.0.5");
  });
  it("returns bare address when no port suffix", () => {
    expect(hostFromServer({ address: "myservice", status: "UP" })).toBe("myservice");
  });
  it("returns null when both url and address are absent", () => {
    expect(hostFromServer({ status: "UP" })).toBeNull();
  });
  it("returns null for empty strings", () => {
    expect(hostFromServer({ url: "", address: "", status: "UP" })).toBeNull();
  });
  it("prefers url over address when both present", () => {
    expect(
      hostFromServer({ url: "http://10.0.0.1:80", address: "10.0.0.2:80", status: "UP" }),
    ).toBe("10.0.0.1");
  });
});

// ---------------------------------------------------------------------------
// isIPv4
// ---------------------------------------------------------------------------
describe("isIPv4", () => {
  it("accepts canonical IPv4", () => {
    expect(isIPv4("192.168.100.10")).toBe(true);
    expect(isIPv4("10.0.0.1")).toBe(true);
    expect(isIPv4("0.0.0.0")).toBe(true);
    expect(isIPv4("255.255.255.255")).toBe(true);
  });
  it("rejects simple hostnames", () => {
    expect(isIPv4("myhost")).toBe(false);
    expect(isIPv4("my.host.local")).toBe(false);
  });
  it("rejects IPv6 notation", () => {
    expect(isIPv4("::1")).toBe(false);
    expect(isIPv4("2001:db8::1")).toBe(false);
  });
  it("rejects out-of-range octets", () => {
    expect(isIPv4("256.1.1.1")).toBe(false);
    expect(isIPv4("1.1.1.999")).toBe(false);
  });
  it("rejects too few or too many octets", () => {
    expect(isIPv4("192.168.1")).toBe(false);
    expect(isIPv4("1.2.3.4.5")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sameSubnet24
// ---------------------------------------------------------------------------
describe("sameSubnet24", () => {
  it("matches IPs in the same /24", () => {
    expect(sameSubnet24("192.168.100.10", "192.168.100.50")).toBe(true);
    expect(sameSubnet24("10.0.0.1", "10.0.0.254")).toBe(true);
  });
  it("differs when third octet differs", () => {
    expect(sameSubnet24("192.168.100.10", "192.168.3.10")).toBe(false);
  });
  it("differs when first octet differs", () => {
    expect(sameSubnet24("10.0.0.1", "192.168.100.1")).toBe(false);
  });
  it("same IP counts as same subnet", () => {
    expect(sameSubnet24("192.168.100.10", "192.168.100.10")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// externalBackends
// ---------------------------------------------------------------------------
function makeSvc(servers: Server[]): Service {
  return {
    id: "t:s",
    name: "s@docker",
    shortName: "s",
    provider: "docker",
    type: "loadbalancer",
    instance: "t",
    servers,
    serversUp: 1,
    serversTotal: 1,
    status: "ok",
    usedBy: [],
  };
}

describe("externalBackends", () => {
  const instIP = "192.168.100.10";

  it("identifies an external IP on the same /24", () => {
    const s = makeSvc([{ url: "http://192.168.100.50:80", status: "UP" }]);
    expect(externalBackends(s, instIP)).toEqual(["192.168.100.50"]);
  });

  it("excludes the instance's own IP", () => {
    const s = makeSvc([{ url: "http://192.168.100.10:8080", status: "UP" }]);
    expect(externalBackends(s, instIP)).toEqual([]);
  });

  it("excludes Docker bridge range (different /24 from LAN)", () => {
    const s = makeSvc([{ url: "http://172.18.0.5:80", status: "UP" }]);
    expect(externalBackends(s, instIP)).toEqual([]);
  });

  it("excludes 10.x range when not same /24 as instance", () => {
    const s = makeSvc([{ url: "http://10.0.0.11:80", status: "UP" }]);
    expect(externalBackends(s, instIP)).toEqual([]);
  });

  it("excludes hostname-only backends", () => {
    const s = makeSvc([{ address: "whoami:8080", status: "UP" }]);
    expect(externalBackends(s, instIP)).toEqual([]);
  });

  it("deduplicates multiple servers on the same external IP", () => {
    const s = makeSvc([
      { url: "http://192.168.100.50:80", status: "UP" },
      { url: "http://192.168.100.50:8080", status: "DOWN" },
    ]);
    expect(externalBackends(s, instIP)).toEqual(["192.168.100.50"]);
  });

  it("returns multiple distinct external IPs", () => {
    const s = makeSvc([
      { url: "http://192.168.100.50:80", status: "UP" },
      { url: "http://192.168.100.51:80", status: "UP" },
    ]);
    expect(externalBackends(s, instIP)).toEqual(["192.168.100.50", "192.168.100.51"]);
  });

  it("returns [] when instanceIP is not IPv4 (hostname-configured endpoint)", () => {
    const s = makeSvc([{ url: "http://192.168.100.50:80", status: "UP" }]);
    expect(externalBackends(s, "my-traefik-host")).toEqual([]);
  });

  it("returns [] for a service with no servers", () => {
    const s = makeSvc([]);
    expect(externalBackends(s, instIP)).toEqual([]);
  });

  it("handles address field (TCP-style)", () => {
    const s = makeSvc([{ address: "192.168.100.55:443", status: "UP" }]);
    expect(externalBackends(s, instIP)).toEqual(["192.168.100.55"]);
  });
});

// ---------------------------------------------------------------------------
// findService
// ---------------------------------------------------------------------------
function makeSnapshot(partial: Partial<Snapshot>): Snapshot {
  return {
    generatedAt: 0,
    domain: "",
    instances: [],
    entryPoints: [],
    httpRouters: [],
    httpServices: [],
    middlewares: [],
    tcpRouters: [],
    tcpServices: [],
    tcpMiddlewares: [],
    udpRouters: [],
    udpServices: [],
    certificates: [],
    ...partial,
  };
}

describe("findService", () => {
  const svc: Service = {
    id: "node1:whoami@docker",
    name: "whoami@docker",
    shortName: "whoami",
    provider: "docker",
    type: "loadbalancer",
    instance: "node1",
    servers: [],
    serversUp: 1,
    serversTotal: 1,
    status: "ok",
    usedBy: [],
  };

  it("finds service by stripping @provider and matching instance", () => {
    const snap = makeSnapshot({ httpServices: [svc] });
    const router = {
      id: "node1:app@docker",
      name: "app@docker",
      shortName: "app",
      service: "whoami@docker",
      instance: "node1",
      middlewares: [],
      entryPoints: [],
      tls: false,
      provider: "docker",
      status: "enabled" as const,
    };
    expect(findService(snap, router)).toBe(svc);
  });

  it("returns undefined when service is on a different instance", () => {
    const snap = makeSnapshot({ httpServices: [svc] });
    const router = {
      id: "node2:app@docker",
      name: "app@docker",
      shortName: "app",
      service: "whoami@docker",
      instance: "node2",
      middlewares: [],
      entryPoints: [],
      tls: false,
      provider: "docker",
      status: "enabled" as const,
    };
    expect(findService(snap, router)).toBeUndefined();
  });

  it("strips @provider from router.service before matching", () => {
    const snap = makeSnapshot({ httpServices: [svc] });
    const router = {
      id: "node1:app@docker",
      name: "app@docker",
      shortName: "app",
      service: "whoami@docker",  // both have @docker — both stripped → match
      instance: "node1",
      middlewares: [],
      entryPoints: [],
      tls: false,
      provider: "docker",
      status: "enabled" as const,
    };
    expect(findService(snap, router)?.shortName).toBe("whoami");
  });
});
