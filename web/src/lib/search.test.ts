import { describe, it, expect } from "vitest";
import { searchSnapshot } from "./search";
import type { Snapshot, Router, Service, Middleware, Certificate } from "./types";

function router(over: Partial<Router>): Router {
  return { id: "r", name: "r", shortName: "r", service: "svc", middlewares: [], entryPoints: [], tls: false, provider: "docker", instance: "edge", status: "enabled", ...over };
}
function service(over: Partial<Service>): Service {
  return { id: "s", name: "s", shortName: "s", provider: "docker", type: "loadbalancer", instance: "edge", servers: [], serversUp: 1, serversTotal: 1, status: "ok", usedBy: [], ...over };
}
function middleware(over: Partial<Middleware>): Middleware {
  return { id: "m", name: "m", fullName: "m@docker", type: "headers", provider: "docker", instance: "edge", config: {}, usedBy: 0, usedByRouters: [], ...over };
}
function cert(over: Partial<Certificate>): Certificate {
  return { id: "c", domain: "x.test", wildcard: false, sans: [], resolver: "le", issuer: "LE", issuerCN: "R3", serial: "0", keyType: "RSA", notBefore: 0, notAfter: 0, instance: "edge", status: "valid", ...over };
}

function snap(over: Partial<Snapshot>): Snapshot {
  return {
    generatedAt: 0, domain: "d", instances: [], entryPoints: [],
    httpRouters: [], httpServices: [], middlewares: [],
    tcpRouters: [], tcpServices: [], tcpMiddlewares: [],
    udpRouters: [], udpServices: [], certificates: [],
    ...over,
  };
}

describe("searchSnapshot", () => {
  it("returns [] for an empty/whitespace query without matching everything", () => {
    expect(searchSnapshot(snap({ httpRouters: [router({})] }), "")).toEqual([]);
    expect(searchSnapshot(snap({ httpRouters: [router({})] }), "   ")).toEqual([]);
  });

  it("matches HTTP routers by name, rule, service, or instance (case-insensitive)", () => {
    const s = snap({
      httpRouters: [
        router({ id: "r1", name: "API", rule: "Host(`a.io`)" }),
        router({ id: "r2", name: "web", rule: "Host(`zzz`)", service: "API-svc" }),
        router({ id: "r3", name: "web", instance: "API-node" }),
        router({ id: "r4", name: "nope", rule: "Host(`zzz`)", service: "other", instance: "edge" }),
      ],
    });
    const g = searchSnapshot(s, "api");
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe("HTTP Routers");
    expect(g[0].items.map((i) => i.id)).toEqual(["r1", "r2", "r3"]);
  });

  it("carries a navigation target: routers get a Sel, tcp/udp/cert do not", () => {
    const s = snap({
      httpRouters: [router({ id: "r1", name: "api" })],
      tcpRouters: [router({ id: "t1", name: "api" })],
      certificates: [cert({ id: "c1", domain: "api.test" })],
    });
    const g = searchSnapshot(s, "api");
    const http = g.find((x) => x.label === "HTTP Routers")!;
    const tcp = g.find((x) => x.label === "TCP Routers")!;
    const certs = g.find((x) => x.label === "Certificates")!;
    expect(http.items[0]).toMatchObject({ tab: "http_routers", sel: { kind: "router" } });
    expect(tcp.items[0]).toMatchObject({ tab: "tcp_routers" });
    expect(tcp.items[0].sel).toBeUndefined();
    expect(certs.items[0]).toMatchObject({ tab: "certificates" });
    expect(certs.items[0].sel).toBeUndefined();
  });

  it("matches services by type and middlewares by name", () => {
    const s = snap({
      httpServices: [service({ id: "s1", name: "x", type: "mirroring" })],
      middlewares: [middleware({ id: "m1", name: "mirror-mw" })],
    });
    const g = searchSnapshot(s, "mirror");
    expect(g.map((x) => x.label).sort()).toEqual(["HTTP Services", "Middlewares"]);
  });

  it("derives middleware status from the error field", () => {
    const s = snap({ middlewares: [middleware({ id: "m1", name: "auth", error: ["bad"] }), middleware({ id: "m2", name: "auth2" })] });
    const items = searchSnapshot(s, "auth")[0].items;
    expect(items.find((i) => i.id === "m1")!.status).toBe("error");
    expect(items.find((i) => i.id === "m2")!.status).toBe("enabled");
  });

  it("matches certificates by SAN", () => {
    const s = snap({ certificates: [cert({ id: "c1", domain: "main.test", sans: ["alt.example.io"] })] });
    const g = searchSnapshot(s, "alt.example");
    expect(g[0].label).toBe("Certificates");
    expect(g[0].items[0].id).toBe("c1");
  });

  it("caps each group at 5 items and reports the overflow count", () => {
    const routers = Array.from({ length: 7 }, (_, i) => router({ id: `r${i}`, name: `api-${i}` }));
    const g = searchSnapshot(snap({ httpRouters: routers }), "api");
    expect(g[0].items).toHaveLength(5);
    expect(g[0].extra).toBe(2);
  });
});
