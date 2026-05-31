// Instances health panel. Ported from tv-overview.jsx InstancesPanel.
import type { Snapshot } from "../lib/types";
import { Icons, Badge, statusKind, timeAgo, safeHref } from "../components/ui";

export function InstancesPanel({ snapshot }: { snapshot: Snapshot }) {
  return (
    <div className="content-wide fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Instances</h1>
          <div className="page-desc">Per-node reachability, version &amp; scrape status</div>
        </div>
      </div>
      <div className="inst-grid">
        {snapshot.instances.map((inst) => (
          <div className="inst-card" key={inst.name}>
            <div className="inst-top">
              <span className={`sdot s-${statusKind(inst.status)}`} style={{ width: 12, height: 12, marginTop: 4 }}></span>
              <div style={{ flex: 1 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="cell-mono" style={{ fontWeight: 700, fontSize: 14 }}>{inst.name}</span>
                  <Badge status={inst.status} />
                </div>
                <div className="hcard-meta" style={{ marginTop: 6 }}>
                  <span>{inst.ip}</span><span>{inst.version}</span>
                </div>
                {safeHref(inst.dashboardURL) && <a className="dlink" style={{ marginTop: 8 }} href={safeHref(inst.dashboardURL)} target="_blank" rel="noreferrer">Open dashboard <Icons.ext /></a>}
              </div>
            </div>
            <div className="inst-body">
              {inst.error
                ? <div className="hcard-err" style={{ marginBottom: 10 }}>{inst.error}</div>
                : <div className="inst-stat-row">
                    <div className="inst-stat"><div className="hc-num">{inst.counts.routers}</div><div className="hc-lab">routers</div></div>
                    <div className="inst-stat"><div className="hc-num">{inst.counts.services}</div><div className="hc-lab">services</div></div>
                    <div className="inst-stat"><div className="hc-num" style={inst.counts.warnings ? { color: "var(--warn)" } : undefined}>{inst.counts.warnings}</div><div className="hc-lab">warnings</div></div>
                  </div>}
              <div className="hcard-meta" style={{ marginTop: 12, justifyContent: "space-between" }}>
                <span>last scrape</span>
                <span className="cell-mono" style={{ color: "var(--text-dim)" }}>{inst.lastScrape ? timeAgo(inst.lastScrape) : "—"}{inst.scrapeMs != null ? ` · ${inst.scrapeMs}ms` : ""}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
