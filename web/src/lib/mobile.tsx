// Mobile breakpoint context — provides useIsMobile() across the app from a
// single matchMedia subscription instead of one listener per consumer.
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

const BP = 860;
const MobileContext = createContext<boolean | null>(null);

export function MobileProvider({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(`(max-width:${BP}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${BP}px)`);
    const h = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", h);
    setIsMobile(mq.matches);
    return () => mq.removeEventListener("change", h);
  }, []);
  return <MobileContext.Provider value={isMobile}>{children}</MobileContext.Provider>;
}

// useIsMobile — reads the context when inside MobileProvider (one shared
// subscription), falls back to a local matchMedia listener otherwise
// (e.g. unit tests or stories that don't wrap with the provider).
export function useIsMobile(): boolean {
  const ctx = useContext(MobileContext);
  const [local, setLocal] = useState(() =>
    typeof window !== "undefined" && window.matchMedia(`(max-width:${BP}px)`).matches
  );
  useEffect(() => {
    if (ctx !== null) return; // context is active; don't spin up a second listener
    const mq = window.matchMedia(`(max-width:${BP}px)`);
    const h = (e: MediaQueryListEvent) => setLocal(e.matches);
    mq.addEventListener("change", h);
    setLocal(mq.matches);
    return () => mq.removeEventListener("change", h);
  }, [ctx]);
  return ctx !== null ? ctx : local;
}
