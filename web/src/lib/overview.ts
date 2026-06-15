// Pure health-aggregation helpers for the Overview dashboard, lifted out of
// views/Overview.tsx so the "needs attention" rules are unit-testable.
import type { Router, Service, Instance } from "./types";

export function countUnreachable(instances: Instance[]): number {
  return instances.filter((i) => i.status === "unreachable").length;
}

// Routers in any non-healthy state (warning/error/disabled).
export function problemRouters(routers: Router[]): Router[] {
  return routers.filter((r) => r.status !== "enabled");
}

// Services with at least one server down.
export function degradedServices(services: Service[]): Service[] {
  return services.filter((s) => s.serversUp < s.serversTotal);
}
