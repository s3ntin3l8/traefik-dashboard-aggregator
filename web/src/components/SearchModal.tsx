import { useEffect } from "react";
import type { Snapshot } from "../lib/types";
import { statusKind } from "../lib/types";
import type { Sel } from "../lib/sel";

interface Props {
  snapshot: Snapshot;
  search: string;
  onNavigate: (tab: string, sel?: Sel) => void;
  onClose: () => void;
}

interface ResultItem {
  id: string;
  name: string;
  sub: string;
  instance: string;
  status: string;
  onSelect: () => void;
}

interface Group {
  label: string;
  items: ResultItem[];
  extra: number;
}

export function SearchModal({ snapshot, search, onNavigate, onClose }: Props) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const groups: Group[] = [];

  const httpRouters = (snapshot.httpRouters || []).filter((r) =>
    r.name.toLowerCase().includes(search) ||
    (r.rule || "").toLowerCase().includes(search) ||
    r.service.toLowerCase().includes(search) ||
    r.instance.toLowerCase().includes(search)
  );
  if (httpRouters.length > 0) groups.push({
    label: "HTTP Routers",
    extra: Math.max(0, httpRouters.length - 5),
    items: httpRouters.slice(0, 5).map((r) => ({
      id: r.id,
      name: r.shortName || r.name,
      sub: r.host || r.rule || r.service,
      instance: r.instance,
      status: r.status,
      onSelect: () => { onNavigate("http_routers", { kind: "router", data: r }); },
    })),
  });

  const httpServices = (snapshot.httpServices || []).filter((s) =>
    s.name.toLowerCase().includes(search) ||
    s.type.toLowerCase().includes(search) ||
    s.instance.toLowerCase().includes(search)
  );
  if (httpServices.length > 0) groups.push({
    label: "HTTP Services",
    extra: Math.max(0, httpServices.length - 5),
    items: httpServices.slice(0, 5).map((s) => ({
      id: s.id,
      name: s.shortName || s.name,
      sub: s.type,
      instance: s.instance,
      status: s.status,
      onSelect: () => { onNavigate("http_services", { kind: "service", data: s }); },
    })),
  });

  const middlewares = (snapshot.middlewares || []).filter((m) =>
    m.name.toLowerCase().includes(search) ||
    m.type.toLowerCase().includes(search) ||
    m.instance.toLowerCase().includes(search)
  );
  if (middlewares.length > 0) groups.push({
    label: "Middlewares",
    extra: Math.max(0, middlewares.length - 5),
    items: middlewares.slice(0, 5).map((m) => ({
      id: m.id,
      name: m.name,
      sub: m.type,
      instance: m.instance,
      status: m.error?.length ? "error" : "enabled",
      onSelect: () => { onNavigate("middlewares", { kind: "middleware", data: m }); },
    })),
  });

  const tcpRouters = (snapshot.tcpRouters || []).filter((r) =>
    r.name.toLowerCase().includes(search) ||
    (r.rule || "").toLowerCase().includes(search) ||
    r.instance.toLowerCase().includes(search)
  );
  if (tcpRouters.length > 0) groups.push({
    label: "TCP Routers",
    extra: Math.max(0, tcpRouters.length - 5),
    items: tcpRouters.slice(0, 5).map((r) => ({
      id: r.id,
      name: r.shortName || r.name,
      sub: r.rule || r.service,
      instance: r.instance,
      status: r.status,
      onSelect: () => { onNavigate("tcp_routers"); },
    })),
  });

  const udpRouters = (snapshot.udpRouters || []).filter((r) =>
    r.name.toLowerCase().includes(search) ||
    r.instance.toLowerCase().includes(search)
  );
  if (udpRouters.length > 0) groups.push({
    label: "UDP Routers",
    extra: Math.max(0, udpRouters.length - 5),
    items: udpRouters.slice(0, 5).map((r) => ({
      id: r.id,
      name: r.shortName || r.name,
      sub: r.service,
      instance: r.instance,
      status: r.status,
      onSelect: () => { onNavigate("udp_routers"); },
    })),
  });

  const certs = (snapshot.certificates || []).filter((c) =>
    c.domain.toLowerCase().includes(search) ||
    (c.sans || []).join(" ").toLowerCase().includes(search) ||
    c.instance.toLowerCase().includes(search)
  );
  if (certs.length > 0) groups.push({
    label: "Certificates",
    extra: Math.max(0, certs.length - 5),
    items: certs.slice(0, 5).map((c) => ({
      id: c.id,
      name: c.domain,
      sub: c.wildcard ? "wildcard" : (c.issuerCN || c.issuer),
      instance: c.instance,
      status: c.status,
      onSelect: () => { onNavigate("certificates"); },
    })),
  });

  return (
    <>
      <div className="search-modal-scrim" onClick={onClose} />
      <div className="search-modal">
        {groups.length === 0 && (
          <div className="search-modal-empty">No results for "{search}"</div>
        )}
        {groups.map((g) => (
          <div className="search-modal-group" key={g.label}>
            <div className="search-modal-group-label">{g.label}</div>
            {g.items.map((item) => (
              <div className="search-modal-item" key={item.id} onClick={item.onSelect}>
                <span className={`sdot s-${statusKind(item.status)}`}></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="search-modal-item-name">{item.name}</div>
                  {item.sub && <div className="search-modal-item-sub">{item.sub}</div>}
                </div>
                <span className="search-modal-item-inst">{item.instance}</span>
              </div>
            ))}
            {g.extra > 0 && (
              <div className="search-modal-more">+{g.extra} more in {g.label}</div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
