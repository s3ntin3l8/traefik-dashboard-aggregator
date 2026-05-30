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
  openTab: (tab: string) => void;
}) {
  const insts = snapshot.instances;
  const probRouters = useMemo(() => snapshot.httpRouters.filter((r) => r.status !== "enabled").slice(0, 8), [snapshot]);

  const totalR = snapshot.httpRouters.length;
  const totalS = snapshot.httpServices.length;
  const certSoon = (snapshot.certificates || []).filter((c) => (c.notAfter - Date.now()) / 86400000 < 21).length;

  return (
    <div className="content-wide fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <div className="page-desc">{insts.length} instances · {totalR} routers · {totalS} services · {snapshot.domain}</div>
        </div>
        <div className="ov-actions">
          <button className="btn-ghost" onClick={() => openTab("certificates")}>{certSoon > 0 ? `${certSoon} certs expiring` : "Certs OK"}</button>
        </div>
      </div>

      <div className="hero-grid">
        {insts.map((i) => <InstanceHealthCard key={i.name} inst={i} onClick={() => goInstance(i.name)} />)}
      </div>

      <Topology snapshot={snapshot} dir={dir} onSelect={onSelect} />

      <div className="ov-cols">
        <div className="panel">
          <div className="panel-head"><h3>Routes needing attention</h3><span className="muted">{probRouters.length}</span></div>
          <div className="prob-list">
            {probRouters.length === 0 && <div className="empty-row">Everything healthy ✓</div>}
            {probRouters.map((r) => (
              <div className="prob-item" key={r.id} onClick={() => onSelect({ kind: "router", data: r })}>
                <span className={`sdot s-${statusKind(r.status)}`}></span>
                <span className="prob-name">{r.name}</span>
                <span className="prob-inst">{r.instance}</span>
                <Icons.chevright size={14} />
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-head"><h3>Instances</h3><span className="muted">{insts.length}</span></div>
          <div className="inst-mini-list">
            {insts.map((i) => (
              <div className="inst-mini" key={i.name} onClick={() => goInstance(i.name)}>
                <span className={`sdot s-${statusKind(i.status)}`}></span>
                <span className="inst-mini-name">{i.name}</span>
                <span className="inst-mini-meta">{i.version} · {i.counts.routers}r</span>
                <Icons.chevright size={14} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function InstanceHealthCard({ inst, onClick }: { inst: Instance; onClick: () => void }) {
  const k = statusKind(inst.status);
  const stale = inst.status === "unreachable";
  return (
    <div className={`hero-card ${k}`} onClick={onClick}>
      <div className="hero-card-top">
        <span className={`sdot s-${k}`}></span>
        <span className="hero-name">{inst.name}</span>
        <span className="hero-ver">{inst.version}</span>
      </div>
      <div className="hero-stat">
        <div className="hero-num">{inst.counts.routers}</div>
        <div className="hero-lbl">routers</div>
      </div>
      <div className="hero-foot">
        {stale ? <span className="stale">last seen {timeAgo(inst.lastScrape)}</span>
               : <span className="ok-line">{inst.counts.services} services · {inst.counts.middlewares} mw</span>}
      </div>
    </div>
  );
}
