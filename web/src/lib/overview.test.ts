import { describe, it, expect } from "vitest";
import { countUnreachable, problemRouters, degradedServices } from "./overview";
import type { Router, Service, Instance } from "./types";

function inst(status: Instance["status"]): Instance {
  return {
    name: "n-" + status, url: "", ip: "", dashboardURL: "", status,
    version: "v3", lastScrape: 0, scrapeMs: null,
    counts: { routers: 0, services: 0, middlewares: 0, warnings: 0 },
  };
}

function router(status: Router["status"]): Router {
  return {
    id: "r-" + status, name: "r", shortName: "r", service: "svc",
    middlewares: [], entryPoints: [], tls: false, provider: "docker",
    instance: "edge", status,
  };
}

function service(up: number, total: number): Service {
  return {
    id: `s-${up}-${total}`, name: "s", shortName: "s", provider: "docker",
    type: "loadbalancer", instance: "edge", servers: [],
    serversUp: up, serversTotal: total, status: "ok", usedBy: [],
  };
}

describe("countUnreachable", () => {
  it("counts only instances with status 'unreachable'", () => {
    expect(countUnreachable([inst("ok"), inst("unreachable"), inst("degraded"), inst("unreachable")])).toBe(2);
    expect(countUnreachable([])).toBe(0);
  });
});

describe("problemRouters", () => {
  it("returns every router not in the 'enabled' state", () => {
    const rs = [router("enabled"), router("warning"), router("error"), router("disabled")];
    expect(problemRouters(rs).map((r) => r.status)).toEqual(["warning", "error", "disabled"]);
  });
});

describe("degradedServices", () => {
  it("returns services with fewer servers up than total", () => {
    const ss = [service(2, 2), service(1, 3), service(0, 1)];
    expect(degradedServices(ss).map((s) => s.id)).toEqual(["s-1-3", "s-0-1"]);
  });
});
