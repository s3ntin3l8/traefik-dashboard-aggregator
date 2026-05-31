// Overview: health hero, topology embed, problems, instances. Ported from tv-overview.jsx.
import { useMemo } from "react";
import type { Snapshot, Instance } from "../lib/types";
import { Icons, statusKind, timeAgo } from "../components/ui";
import { Topology } from "./Topology";
import type { Sel } from "../lib/sel";

export function Overview({ snapshot, dir, goInstance, onSelect, openTab }: {
  snapshot: Snapshot;
  dir: string;
  goInstance: (name?: string) => void;
  onSelect: (s: Sel) => void;
  openTab: (tab: string, instance?: string) => void;
}) {
  const insts = snapshot.instances || [];
  const unreachable = insts.filter((i) => i.status === "unreachable").length;
  const probRouters = useMemo(() => (snapshot.httpRouters || []).filter((r) => r.status !== "enabled"), [snapshot]);
  const probServices = useMemo(() => (snapshot.httpServices || []).filter((s) => s.serversUp < s.serversTotal), [snapshot]);

  const totalR = (snapshot.httpRouters || []).length;
  const totalS = (snapshot.httpServices || []).length;
  const totalM = (snapshot.middlewares || []).length;
  const certSoon = (snapshot.certificates || []).filter((c) => (c.notAfter - Date.now()) / 86400000 < 21).length;

  return (
    <div className="content-wide fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <div className="page-desc">{snapshot.domain} · Monitoring {insts.length} nodes</div>
        </div>
        <div className="ov-actions">
          <button className="btn-ghost" onClick={() => openTab("certificates")}>
            {certSoon > 0 ? <><span className="sdot s-warn" style={{ marginRight: 8 }}></span>{certSoon} certs expiring</> : "Certs OK"}
          </button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <div className="stat-k">Instances</div>
          <div className="stat-v">{insts.length - unreachable}/{insts.length}</div>
          <div className="stat-sub">{unreachable > 0 ? `${unreachable} unreachable` : "All nodes online"}</div>
          <div className="stat-accent"></div>
        </div>
        <div className="stat">
          <div className="stat-k">HTTP Routers</div>
          <div className="stat-v">{totalR}</div>
          <div className="stat-sub">{probRouters.length > 0 ? `${probRouters.length} need attention` : "Healthy"}</div>
          <div className="stat-accent"></div>
        </div>
        <div className="stat">
          <div className="stat-k">Services</div>
          <div className="stat-v">{totalS}</div>
          <div className="stat-sub">{probServices.length > 0 ? `${probServices.length} node degraded` : "Healthy"}</div>
          <div className="stat-accent"></div>
        </div>
        <div className="stat">
          <div className="stat-k">Middlewares</div>
          <div className="stat-v">{totalM}</div>
          <div className="stat-sub">in use across nodes</div>
          <div className="stat-accent"></div>
        </div>
      </div>

      <div className="ov-grid">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Instance health</div>
            <button className="chip" onClick={() => goInstance()}>View all <Icons.chevright size={13} /></button>
          </div>
          <div className="panel-body">
            <div className="health-list">
              {insts.map((i) => <InstanceHealthCard key={i.name} inst={i} onClick={() => goInstance(i.name)} onFilter={(tab) => openTab(tab, i.name)} />)}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Routes needing attention</div>
            <span className="muted">{probRouters.length}</span>
          </div>
          <div className="prob-list">
            {probRouters.length === 0 && <div className="empty-row">Everything healthy ✓</div>}
            {probRouters.slice(0, 10).map((r) => (
              <div className="prob-item" key={r.id} onClick={() => onSelect({ kind: "router", data: r })}>
                <span className={`sdot s-${statusKind(r.status)}`}></span>
                <span className="prob-name">{r.name}</span>
                <span className="prob-inst">{r.instance}</span>
                <Icons.chevright size={14} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">Topology · live request flow</div>
          <span className="faint" style={{ fontSize: "11.5px" }}>gateway → {insts.length} nodes → {totalR} routers</span>
        </div>
        <Topology snapshot={snapshot} dir={dir} onSelect={onSelect} />
      </div>
    </div>
  );
}

function InstanceHealthCard({ inst, onClick, onFilter }: { inst: Instance; onClick: () => void; onFilter: (tab: string) => void }) {
  const k = statusKind(inst.status);
  const stale = inst.status === "unreachable";
  return (
    <div className={`hcard ${k}`} onClick={onClick}>
      <div className="hcard-main">
        <div className="hcard-name">
          <span className={`sdot s-${k}`}></span>
          {inst.name}
        </div>
        <div className="hcard-meta">
          <span>{inst.ip}</span>
          <span>{inst.version}</span>
          <span>scraped {inst.lastScrape ? timeAgo(inst.lastScrape) : "—"}{inst.scrapeMs != null ? ` · ${inst.scrapeMs}ms` : ""}</span>
        </div>
        {stale && inst.error && <div className="hcard-err">{inst.error}</div>}
      </div>
      {!stale && (
        <div className="hcard-counts">
          <div onClick={(e) => { e.stopPropagation(); onFilter("http_routers"); }}>
            <div className="hc-num">{inst.counts.routers}</div>
            <div className="hc-lab">routers</div>
          </div>
          <div onClick={(e) => { e.stopPropagation(); onFilter("http_services"); }}>
            <div className="hc-num">{inst.counts.services}</div>
            <div className="hc-lab">services</div>
          </div>
          <div onClick={(e) => { e.stopPropagation(); onFilter("http_routers"); }}>
            <div className="hc-num" style={inst.counts.warnings ? { color: "var(--warn)" } : undefined}>{inst.counts.warnings}</div>
            <div className="hc-lab">warnings</div>
          </div>
        </div>
      )}
    </div>
  );
}
