import { describe, it, expect } from "vitest";
import { statusKind, STATUS_LABEL } from "./types";

describe("statusKind", () => {
  it("maps healthy states to 'ok'", () => {
    for (const s of ["ok", "enabled", "UP"]) expect(statusKind(s)).toBe("ok");
  });

  it("maps degraded/warning states to 'warn'", () => {
    for (const s of ["degraded", "warning"]) expect(statusKind(s)).toBe("warn");
  });

  it("treats every other state as 'down'", () => {
    for (const s of ["unreachable", "error", "down", "disabled", "DOWN", ""]) {
      expect(statusKind(s)).toBe("down");
    }
  });
});

describe("STATUS_LABEL", () => {
  it("provides human-readable labels for known statuses", () => {
    expect(STATUS_LABEL.unreachable).toBe("Down");
    expect(STATUS_LABEL.enabled).toBe("Enabled");
    expect(STATUS_LABEL.degraded).toBe("Degraded");
  });
});
