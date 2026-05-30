// Theme/appearance state, persisted to localStorage and applied to <html>.
import { useEffect, useState } from "react";

export interface Tweaks {
  dir: "a" | "b"; // a = Terminal, b = Console
  theme: "light" | "dark";
  density: "compact" | "regular" | "comfy";
  accent: string;
}

export const TWEAK_DEFAULTS: Tweaks = {
  dir: "b",
  theme: "dark",
  density: "regular",
  accent: "#7c6cff",
};

export const ACCENTS = ["#7c6cff", "#19c37d", "#18b6d6", "#f0a82a", "#f0436a"];

const KEY = "tv-tweaks";

function relLum(hex: string): number {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function useTweaks(): [Tweaks, <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void] {
  const [t, setT] = useState<Tweaks>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { ...TWEAK_DEFAULTS, ...JSON.parse(raw) };
    } catch { /* ignore */ }
    return TWEAK_DEFAULTS;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-dir", t.dir);
    root.setAttribute("data-theme", t.theme);
    root.setAttribute("data-density", t.density);
    const a = t.accent || TWEAK_DEFAULTS.accent;
    root.style.setProperty("--accent", a);
    root.style.setProperty("--accent-soft", a + "26");
    root.style.setProperty("--accent-contrast", relLum(a) > 0.55 ? "#0c0f16" : "#ffffff");
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* ignore */ }
  }, [t]);

  const setTweak = <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => setT((prev) => ({ ...prev, [k]: v }));
  return [t, setTweak];
}
