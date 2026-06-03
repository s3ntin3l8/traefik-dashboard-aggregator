// App shell: sidebar nav (grouped), topbar (search + node chips + live clock),
// view routing, SSE-driven snapshot, and the shared detail drawer.
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSnapshot, fetchFeatures, fetchMe } from "./lib/sse";
import type { Identity } from "./lib/sse";
import { useTweaks } from "./lib/theme";
import { statusKind } from "./lib/types";
import { Icons, clockHMS, instOK } from "./components/ui";
import type { Snapshot } from "./lib/types";
import type { Sel } from "./lib/sel";
import { Overview } from "./views/Overview";
import { RoutersTable, ServicesTable, MiddlewaresTable, Drawer } from "./views/Tables";
import { ProtocolView } from "./views/ProtocolView";
import { CertificatesView } from "./views/Certificates";
import { LogsView } from "./views/Logs";
import { InstancesPanel } from "./views/Instances";
import { Settings } from "./views/Settings";
import { SearchField } from "./components/SearchField";

const NAV_GROUPS: { label?: string; items: { id: string; label: string; icon: string; title?: string }[] }[] = [
  { items: [{ id: "overview", label: "Overview", icon: "grid" }] },
  { label: "HTTP", items: [
    { id: "http_routers", label: "Routers", icon: "route", title: "HTTP Routers" },
    { id: "http_services", label: "Services", icon: "server", title: "HTTP Services" },
    { id: "middlewares", label: "Middlewares", icon: "layers", title: "Middlewares" },
  ] },
  { label: "TCP", items: [
    { id: "tcp_routers", label: "Routers", icon: "tcp", title: "TCP Routers" },
    { id: "tcp_services", label: "Services", icon: "server", title: "TCP Services" },
    { id: "tcp_middlewares", label: "Middlewares", icon: "layers", title: "TCP Middlewares" },
  ] },
  { label: "UDP", items: [
    { id: "udp_routers", label: "Routers", icon: "udp", title: "UDP Routers" },
    { id: "udp_services", label: "Services", icon: "server", title: "UDP Services" },
  ] },
  { label: "TLS", items: [{ id: "certificates", label: "Certificates", icon: "cert", title: "Certificates" }] },
  { label: "Observe", items: [
    { id: "logs", label: "Logs", icon: "logs", title: "Logs" },
    { id: "instances", label: "Instances", icon: "pulse", title: "Instances" },
  ] },
];
const NAV = NAV_GROUPS.flatMap((g) => g.items).concat([{ id: "settings", label: "Settings", icon: "cog", title: "Settings" }]);

const APP_NAME = "Traefik Dashboard Aggregator";

// FilterSheet — slide-up bottom sheet for node multi-select on mobile.
function FilterSheet({ snapshot, fInstance, setFInstance, onClose }: {
  snapshot: Snapshot;
  fInstance: string[];
  setFInstance: (fn: (prev: string[]) => string[]) => void;
  onClose: () => void;
}) {
  const all = fInstance.length === 0;
  const toggle = (name: string) =>
    setFInstance((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div className="filter-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Filter by node">
        <div className="sheet-handle"></div>
        <div className="sheet-head">
          <h3>Filter by node</h3>
          {!all && (
            <button className="sheet-clear" onClick={() => setFInstance(() => [])}>Clear</button>
          )}
        </div>
        <div className="sheet-section">
          <button className={`sheet-row${all ? " on" : ""}`} onClick={() => setFInstance(() => [])}>
            <span className="sheet-row-label">All nodes</span>
            {all && <span className="sheet-check">✓</span>}
          </button>
          {snapshot.instances.map((i) => {
            const on = fInstance.includes(i.name);
            return (
              <button key={i.name} className={`sheet-row${on ? " on" : ""}`} onClick={() => toggle(i.name)}>
                <span className={`sdot s-${statusKind(i.status)}`}></span>
                <span className="sheet-row-label">{i.name}</span>
                <span className="sheet-row-ip">{i.ip}</span>
                <span className={`sheet-tick${on ? " on" : ""}`}>{on ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
        <button className="sheet-done" onClick={onClose}>
          {fInstance.length > 0 ? `Show ${fInstance.length} node${fInstance.length > 1 ? "s" : ""}` : "Done"}
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [t, setTweak] = useTweaks();
  const { snapshot, connected, authExpired } = useSnapshot();
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [fInstance, setFInstance] = useState<string[]>([]);  // multi-select; empty = all nodes
  const [fStatus, setFStatus] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [lokiEnabled, setLokiEnabled] = useState(false);
  const [me, setMe] = useState<Identity | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { fetchFeatures().then((f) => setLokiEnabled(f.lokiEnabled)); }, []);
  useEffect(() => { fetchMe().then(setMe); }, []);

  // Reflect the active view in the tab title, e.g. "HTTP Routers · Traefik Dashboard Aggregator".
  useEffect(() => {
    const item = NAV.find((n) => n.id === tab);
    const label = item?.title || item?.label || "";
    document.title = label ? `${label} · ${APP_NAME}` : APP_NAME;
  }, [tab]);

  // "/" focuses the desktop search input
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        if (navOpen) setNavOpen(false);
        if (filterOpen) setFilterOpen(false);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [navOpen, filterOpen]);

  // Scroll-lock: prevent the page from scrolling behind open overlays.
  useEffect(() => {
    const locked = navOpen || filterOpen || sel !== null;
    document.body.classList.toggle("no-scroll", locked);
    return () => document.body.classList.remove("no-scroll");
  }, [navOpen, filterOpen, sel]);

  const goInstance = (name?: string) => {
    setTab("instances");
    if (name) setFInstance([name]);
  };

  useEffect(() => { setModalVisible(search.trim().length > 0); }, [search]);

  const handleModalNavigate = useCallback((targetTab: string, s?: Sel) => {
    setTab(targetTab);
    if (s) setSel(s);
    else setModalVisible(false);
  }, []);

  const handleModalClose = useCallback(() => setModalVisible(false), []);

  const q = search.trim().toLowerCase();
  const matchInst = (x: { instance: string }) => instOK(fInstance, x.instance);
  const matchStat = (x: { status: string }) => !fStatus || statusKind(x.status) === fStatus;

  const rRows = useMemo(() => (snapshot?.httpRouters || []).filter((r) => matchInst(r) && matchStat(r) &&
    (!q || r.name.toLowerCase().includes(q) || (r.rule || "").toLowerCase().includes(q) || r.service.toLowerCase().includes(q) || r.middlewares.join(" ").toLowerCase().includes(q))), [snapshot, q, fInstance, fStatus]);
  const sRows = useMemo(() => (snapshot?.httpServices || []).filter((s) => matchInst(s) && matchStat(s) &&
    (!q || s.name.toLowerCase().includes(q) || s.type.toLowerCase().includes(q))), [snapshot, q, fInstance, fStatus]);
  const mRows = useMemo(() => (snapshot?.middlewares || []).filter((m) => matchInst(m) &&
    (!q || m.name.toLowerCase().includes(q) || m.type.toLowerCase().includes(q))), [snapshot, q, fInstance]);

  if (!snapshot) {
    if (authExpired) {
      return <div className="app"><div className="boot">Session expired — <a href="" onClick={(e) => { e.preventDefault(); location.reload(); }}>reload to sign in</a></div></div>;
    }
    return <div className="app"><div className="boot">Connecting…</div></div>;
  }

  const counts: Record<string, number | null> = {
    http_routers: (snapshot.httpRouters || []).length,
    http_services: (snapshot.httpServices || []).length,
    middlewares: (snapshot.middlewares || []).filter((m) => m.usedBy > 0).length,
    tcp_routers: (snapshot.tcpRouters || []).length,
    tcp_services: (snapshot.tcpServices || []).length,
    tcp_middlewares: (snapshot.tcpMiddlewares || []).length,
    udp_routers: (snapshot.udpRouters || []).length,
    udp_services: (snapshot.udpServices || []).length,
    certificates: (snapshot.certificates || []).length,
    instances: (snapshot.instances || []).length,
  };

  const isHttpTable = ["http_routers", "http_services", "middlewares"].includes(tab);
  const showNodeChips = isHttpTable || ["tcp_routers", "tcp_services", "tcp_middlewares", "udp_routers", "udp_services", "certificates", "logs"].includes(tab);
  const unreachable = snapshot.instances.filter((i) => i.status === "unreachable");
  const title = (NAV.find((n) => n.id === tab) || {}).title || "";

  // Navigate and close the mobile off-canvas sidebar.
  const go = (id: string) => { setTab(id); setNavOpen(false); setFilterOpen(false); };

  return (
    <div className="app">
      {/* sidebar — off-canvas on mobile (navOpen drives the "open" class) */}
      <aside className={`sidebar${navOpen ? " open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Icons.pulse size={17} /></div>
          <div>
            <div className="brand-name">Traefik</div>
            <div className="brand-sub">Dashboard Aggregator</div>
          </div>
        </div>
        <nav className="nav">
          {NAV_GROUPS.map((g, gi) => (
            <div className={`nav-group ${gi > 0 ? "divided" : ""}`} key={gi}>
              {g.label && <div className="nav-label">{g.label}</div>}
              {g.items.map((n) => {
                const I = Icons[n.icon];
                return (
                  <button key={n.id} className={`nav-item ${tab === n.id ? "active" : ""}`} onClick={() => go(n.id)}>
                    {I && <I size={17} />}<span>{n.label}</span>
                    {counts[n.id] != null && <span className="nav-count">{counts[n.id]}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="nav-group divided">
            <button className={`nav-item ${tab === "settings" ? "active" : ""}`} onClick={() => go("settings")}>
              <Icons.cog size={17} /><span>Settings</span>
            </button>
          </div>
        </nav>
        <div className="sidebar-foot">
          {me?.user && (
            <div className="user">
              <span className="user-id" title={me.email || me.user}>{me.name || me.user}</span>
              {me.signOutPath && <a className="user-out" href={me.signOutPath}>Sign out</a>}
            </div>
          )}
          <div className="seg">
            <button className={t.theme === "light" ? "on" : ""} onClick={() => setTweak("theme", "light")}><Icons.sun size={14} /> Light</button>
            <button className={t.theme === "dark" ? "on" : ""} onClick={() => setTweak("theme", "dark")}><Icons.moon size={14} /> Dark</button>
          </div>
        </div>
      </aside>

      <main className="main">
        {/* Desktop topbar: search + node chips + live clock.
            Hidden on mobile via CSS; the mobile bottom bar takes over. */}
        <div className="topbar">
          <SearchField
            search={search}
            setSearch={setSearch}
            snapshot={snapshot}
            tab={tab}
            modalVisible={modalVisible}
            setModalVisible={setModalVisible}
            onNavigate={handleModalNavigate}
            onClose={handleModalClose}
            inputRef={searchRef}
          />
          {showNodeChips && (
            <div className="chips">
              {snapshot.instances.map((i) => (
                <button key={i.name} className={`chip ${fInstance.includes(i.name) ? "on" : ""}`}
                  onClick={() => setFInstance((prev) => prev.includes(i.name) ? prev.filter((n) => n !== i.name) : [...prev, i.name])}>
                  <span className={`sdot s-${statusKind(i.status)}`}></span>{i.name.replace("pve-", "")}
                </button>
              ))}
            </div>
          )}
          <div className="live">
            <span className={connected ? "live-dot" : "live-dot paused"}></span>
            <span>{connected ? "live" : "offline"}</span>
            <span className="live-time">{clockHMS(snapshot.generatedAt)}</span>
          </div>
        </div>

        <div className="content">
          {tab === "overview" && <Overview snapshot={snapshot} dir={t.dir} goInstance={goInstance} onSelect={setSel} openTab={(t, inst) => { setTab(t); if (inst) setFInstance([inst]); }} />}
          {tab === "logs" && <LogsView snapshot={snapshot} globalSearch={search} fInstance={fInstance} />}
          {tab === "tcp_routers" && <ProtocolView proto="tcp" kind="routers" snapshot={snapshot} search={search} fInstance={fInstance} fStatus={fStatus} setFStatus={setFStatus} />}
          {tab === "tcp_services" && <ProtocolView proto="tcp" kind="services" snapshot={snapshot} search={search} fInstance={fInstance} fStatus={fStatus} setFStatus={setFStatus} />}
          {tab === "tcp_middlewares" && <ProtocolView proto="tcp" kind="middlewares" snapshot={snapshot} search={search} fInstance={fInstance} fStatus={fStatus} setFStatus={setFStatus} />}
          {tab === "udp_routers" && <ProtocolView proto="udp" kind="routers" snapshot={snapshot} search={search} fInstance={fInstance} fStatus={fStatus} setFStatus={setFStatus} />}
          {tab === "udp_services" && <ProtocolView proto="udp" kind="services" snapshot={snapshot} search={search} fInstance={fInstance} fStatus={fStatus} setFStatus={setFStatus} />}
          {tab === "certificates" && <CertificatesView snapshot={snapshot} search={search} fInstance={fInstance} />}
          {tab === "instances" && <InstancesPanel snapshot={snapshot} openTab={(t, inst) => { setTab(t); if (inst) setFInstance([inst]); }} />}
          {tab === "settings" && <Settings t={t} setTweak={setTweak} lokiEnabled={lokiEnabled} />}

          {isHttpTable && (
            <div className="content-wide fade-in">
              <div className="page-head">
                <div>
                  <h1 className="page-title">{title}</h1>
                  <div className="page-desc">
                    {tab === "http_routers" && `${rRows.length} of ${snapshot.httpRouters.length} routers`}
                    {tab === "http_services" && `${sRows.length} of ${snapshot.httpServices.length} services`}
                    {tab === "middlewares" && `${mRows.length} of ${snapshot.middlewares.length} middlewares`}
                    {(fInstance.length || fStatus || q) ? " · filtered" : " · across all nodes"}
                  </div>
                </div>
                <div className="chips">
                  {["ok", "warn", "down"].map((s) => (
                    <button key={s} className={`chip ${fStatus === s ? "on" : ""}`} onClick={() => setFStatus(fStatus === s ? null : s)}>
                      <span className={`sdot s-${s}`}></span>{s === "ok" ? "Healthy" : s === "warn" ? "Warning" : "Down"}
                    </button>
                  ))}
                  {(fInstance.length || fStatus || q) && <button className="chip" onClick={() => { setFInstance([]); setFStatus(null); setSearch(""); }}>Clear <span className="x">×</span></button>}
                </div>
              </div>

              {unreachable.length > 0 && (
                <div className="stale-banner">
                  <Icons.alert size={16} />
                  <span><b>{unreachable.map((i) => i.name).join(", ")}</b> unreachable — showing last-good data for {unreachable.length === 1 ? "this node" : "these nodes"}. Live nodes update every poll.</span>
                </div>
              )}

              {tab === "http_routers" && <RoutersTable rows={rRows} snapshot={snapshot} onSelect={setSel} selId={sel?.data.id} />}
              {tab === "http_services" && <ServicesTable rows={sRows} snapshot={snapshot} onSelect={setSel} selId={sel?.data.id} />}
              {tab === "middlewares" && <MiddlewaresTable rows={mRows} snapshot={snapshot} onSelect={setSel} selId={sel?.data.id} />}
            </div>
          )}
        </div>

        {/* Mobile bottom bar (Apple-style floating pill, overlaid on content).
            Hidden on desktop via CSS. Layout: [menu] [search] [filter?] */}
        <div className="mobilebar">
          <button className="mobilebar-btn" aria-label="Open menu" onClick={() => setNavOpen(true)}>
            <Icons.menu size={20} />
          </button>
          <SearchField
            search={search}
            setSearch={setSearch}
            snapshot={snapshot}
            tab={tab}
            modalVisible={modalVisible}
            setModalVisible={setModalVisible}
            onNavigate={handleModalNavigate}
            onClose={handleModalClose}
            anchorClassName="mobilebar-search"
            placeholder="Search routers, services, hosts…"
          />
          {showNodeChips && (
            <button
              className={`mobilebar-btn${fInstance.length ? " on" : ""}`}
              aria-label="Filter by node"
              onClick={() => setFilterOpen(true)}
            >
              <Icons.filter size={18} />
              {fInstance.length > 0 && <span className="mobilebar-badge">{fInstance.length}</span>}
            </button>
          )}
        </div>
      </main>

      {/* Nav scrim — tap to close the off-canvas sidebar on mobile */}
      {navOpen && <div className="nav-scrim" onClick={() => setNavOpen(false)} />}

      {/* Node filter sheet — mobile only, opened by the filter button */}
      {filterOpen && (
        <FilterSheet
          snapshot={snapshot}
          fInstance={fInstance}
          setFInstance={setFInstance}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {sel && <Drawer item={sel} snapshot={snapshot} onClose={() => setSel(null)} onSelect={setSel} />}
    </div>
  );
}
