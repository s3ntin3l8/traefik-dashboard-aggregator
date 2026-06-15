// HTTP tables (routers/services/middlewares) + detail drawer. Ported from tv-tables.jsx.
import { useState, useMemo } from "react";
import type { Snapshot, Router, Service, Middleware } from "../lib/types";
import { Icons, Badge, InstanceTag, NodeLine, MwList, SortHead, safeHref, useIsMobile, DataCard } from "../components/ui";
import { statusKind } from "../lib/types";
import type { Sort } from "../components/ui";
import type { Sel } from "../lib/sel";
import { sortRows } from "../lib/sort";

export function useSorted<T extends Record<string, any>>(rows: T[], sort: Sort): T[] {
  return useMemo(() => sortRows(rows, sort), [rows, sort]);
}

export function HostRule({ rule }: { rule?: string }) {
  if (!rule) return null;
  // Naive parser for Host(`domain.com`) or HostRegexp(`...`)
  const parts = rule.split(/([`'])(.*?)\1/g);
  return (
    <span className="cell-host">
      {parts.map((p, i) => {
        if (i % 3 === 2) {
          // This is the captured group (the domain/regex)
          const isDomain = !p.includes("^") && !p.includes("$") && !p.includes("[");
          if (isDomain) {
            return <a key={i} href={`http://${p}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{p}</a>;
          }
          return <span key={i} className="mono">{p}</span>;
        }
        return <span key={i}>{p}</span>;
      })}
    </span>
  );
}

export function RoutersTable({ rows, snapshot, onSelect, selId }: { rows: Router[]; snapshot: Snapshot; onSelect: (s: Sel) => void; selId?: string }) {
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const sorted = useSorted(rows, sort);
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="mcard-list">
        {sorted.map((r) => (
          <DataCard key={r.id} selected={selId === r.id} status={r.status} title={r.shortName}
            onClick={() => onSelect({ kind: "router", data: r })}
            rows={[
              r.host ? { label: "Host", value: <HostRule rule={r.rule} /> } : (r.rule ? { label: "Rule", value: <span className="mono">{r.rule}</span> } : null),
              { label: "Service", value: <span className="mono">{r.service.replace(/@.*/, "")}</span> },
              { label: "Node", value: <InstanceTag name={r.instance} snapshot={snapshot} /> },
            ]}
          />
        ))}
        {sorted.length === 0 && <div className="empty-row">No routers match.</div>}
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="dtable">
        <thead>
          <tr>
            <SortHead col="name" label="Router" sort={sort} setSort={setSort} />
            <SortHead col="rule" label="Rule" sort={sort} setSort={setSort} />
            <th>Entrypoints</th>
            <th>Middlewares</th>
            <SortHead col="service" label="Service" sort={sort} setSort={setSort} />
            <SortHead col="instance" label="Node" sort={sort} setSort={setSort} />
            <SortHead col="status" label="Status" sort={sort} setSort={setSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className={`drow ${selId === r.id ? "sel" : ""}`} onClick={() => onSelect({ kind: "router", data: r })}>
              <td><span className="cell-name">{r.shortName}</span></td>
              <td className="mono rule-cell"><HostRule rule={r.rule} /></td>
              <td>{(r.entryPoints || []).map((e) => <span className="ep" key={e}>{e}</span>)}</td>
              <td><MwList items={r.middlewares} /></td>
              <td><span className="svc-link">{r.service.replace(/@.*/, "")}</span></td>
              <td><InstanceTag name={r.instance} snapshot={snapshot} /></td>
              <td style={{ textAlign: "right" }}><Badge status={r.status} /></td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={7} className="empty-row">No routers match.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function ServicesTable({ rows, snapshot, onSelect, selId }: { rows: Service[]; snapshot: Snapshot; onSelect: (s: Sel) => void; selId?: string }) {
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const sorted = useSorted(rows, sort);
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="mcard-list">
        {sorted.map((s) => (
          <DataCard key={s.id} selected={selId === s.id} status={s.status} title={s.shortName}
            onClick={() => onSelect({ kind: "service", data: s })}
            rows={[
              { label: "Type", value: <span className="pill-soft">{s.type}</span> },
              { label: "Servers", value: <span className={`srv-up${s.serversUp < s.serversTotal ? " warn" : ""}`}>{s.serversUp}/{s.serversTotal}</span> },
              { label: "Node", value: <InstanceTag name={s.instance} snapshot={snapshot} /> },
            ]}
          />
        ))}
        {sorted.length === 0 && <div className="empty-row">No services match.</div>}
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="dtable">
        <thead>
          <tr>
            <SortHead col="name" label="Service" sort={sort} setSort={setSort} />
            <th>Type</th>
            <th>Servers</th>
            <th>Load balancer</th>
            <SortHead col="instance" label="Node" sort={sort} setSort={setSort} />
            <SortHead col="status" label="Status" sort={sort} setSort={setSort} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => (
            <tr key={s.id} className={`drow ${selId === s.id ? "sel" : ""}`} onClick={() => onSelect({ kind: "service", data: s })}>
              <td><span className="cell-name">{s.shortName}</span></td>
              <td><span className="pill-soft">{s.type}</span></td>
              <td>
                <span className="srv-health">
                  <span className={`srv-up ${s.serversUp < s.serversTotal ? "warn" : ""}`}>{s.serversUp}/{s.serversTotal}</span>
                  <span className="srv-bar">{Array.from({ length: s.serversTotal }).map((_, i) => <span key={i} className={`srv-seg ${i < s.serversUp ? "up" : "down"}`}></span>)}</span>
                </span>
              </td>
              <td className="mono faint" style={{ fontSize: 11 }}>round-robin</td>
              <td><InstanceTag name={s.instance} snapshot={snapshot} /></td>
              <td style={{ textAlign: "right" }}><Badge status={s.status} /></td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={6} className="empty-row">No services match.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

// AkBadge marks an authentik forward-auth middleware (backend sets
// middleware.authentik when the forwardAuth address points at an outpost).
export function AkBadge({ title, style }: { title?: string; style?: React.CSSProperties }) {
  return (
    <span className="ak-pill" style={style} title={title || "authentik forward-auth"}>
      <Icons.lock size={10} /> authentik
    </span>
  );
}

const AK_MODE_LABEL: Record<string, string> = {
  forward_single: "forward auth (single application)",
  forward_domain: "forward auth (domain level)",
};

function summarizeConfig(cfg: Record<string, unknown>): string {
  if (!cfg || Object.keys(cfg).length === 0) return "—";
  return Object.entries(cfg)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(",") : typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("  ·  ");
}

export function MiddlewaresTable({ rows, snapshot, onSelect, selId }: { rows: Middleware[]; snapshot: Snapshot; onSelect: (s: Sel) => void; selId?: string }) {
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const sorted = useSorted(rows, sort);
  const isMobile = useIsMobile();
  if (isMobile) {
    return (
      <div className="mcard-list">
        {sorted.map((m) => (
          <DataCard key={m.id} selected={selId === m.id} title={m.name}
            badge={<span className="row" style={{ gap: 6 }}><span className="pill-soft">{m.type}</span>{m.authentik && <AkBadge />}</span>}
            onClick={() => onSelect({ kind: "middleware", data: m })}
            rows={[
              { label: "Used by", value: m.usedBy > 0 ? <span className="usedby">{m.usedBy}</span> : <span className="faint">unused</span> },
              { label: "Node", value: <InstanceTag name={m.instance} snapshot={snapshot} /> },
            ]}
          />
        ))}
        {sorted.length === 0 && <div className="empty-row">No middlewares match.</div>}
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="dtable">
        <thead>
          <tr>
            <SortHead col="name" label="Middleware" sort={sort} setSort={setSort} />
            <th>Type</th>
            <th>Config</th>
            <th>Used by</th>
            <SortHead col="instance" label="Node" sort={sort} setSort={setSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr key={m.id} className={`drow ${selId === m.id ? "sel" : ""}`} onClick={() => onSelect({ kind: "middleware", data: m })}>
              <td><span className="cell-name">{m.name}</span></td>
              <td><span className="pill-soft">{m.type}</span>{m.authentik && <AkBadge style={{ marginLeft: 6 }} />}</td>
              <td className="mono faint" style={{ fontSize: 11, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summarizeConfig(m.config)}</td>
              <td>{m.usedBy > 0 ? <span className="usedby">{m.usedBy}</span> : <span className="faint">unused</span>}</td>
              <td><InstanceTag name={m.instance} snapshot={snapshot} /></td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={5} className="empty-row">No middlewares match.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Drawer({ item, snapshot, onClose, onSelect }: { item: Sel; snapshot: Snapshot; onClose: () => void; onSelect: (s: Sel) => void }) {
  const { kind, data } = item;
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 7 }}>
              <span className="badge neutral" style={{ textTransform: "uppercase" }}>{kind}</span>
              {data.status && <Badge status={data.status} />}
            </div>
            <div className="drawer-title">{data.shortName || data.name}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icons.x size={18} /></button>
        </div>
        <div className="drawer-body">
          {kind === "router" && <RouterDetail r={data} snapshot={snapshot} onSelect={onSelect} />}
          {kind === "service" && <ServiceDetail s={data} snapshot={snapshot} />}
          {kind === "middleware" && <MiddlewareDetail m={data} snapshot={snapshot} />}
          {kind === "instance" && <InstanceDetail i={data} snapshot={snapshot} />}
        </div>
      </div>
    </div>
  );
}

function RouterDetail({ r, snapshot, onSelect }: { r: Router; snapshot: Snapshot; onSelect: (s: Sel) => void }) {
  const clean = (n: string) => n.replace(/@.*/, "");
  const svc = [...snapshot.httpServices, ...snapshot.tcpServices, ...snapshot.udpServices]
    .find((s) => clean(s.name) === clean(r.service) && s.instance === r.instance);
  const inst = snapshot.instances.find((i) => i.name === r.instance);
  return (
    <>
      <div className="kv"><span>Open</span>{r.host ? <span className="cell-host"><a href={r.tls ? `https://${r.host}` : `http://${r.host}`} target="_blank" rel="noreferrer">{r.host}</a></span> : <span className="muted">—</span>}</div>
      {r.rule && <div className="kv"><span>Rule</span><HostRule rule={r.rule} /></div>}
      <div className="kv"><span>Entrypoints</span><span>{(r.entryPoints || []).join(", ")}</span></div>
      <div className="kv"><span>TLS</span><span>{r.tls ? `enabled${r.certResolver ? ` (${r.certResolver})` : ""}` : <span className="muted">disabled</span>}</span></div>
      {(r.priority || 0) > 0 && <div className="kv"><span>Priority</span><span>{r.priority}</span></div>}
      <div className="kv"><span>Provider</span><span>{r.provider}</span></div>
      <div className="kv"><span>Node</span><NodeLine snapshot={snapshot} name={r.instance} /></div>

      {(r.errors || []).length > 0 && (
        <>
          <div className="drawer-section">Configuration errors</div>
          {r.errors!.map((e, i) => <div key={i} className="kv err-row"><span className="err-text">{e}</span></div>)}
        </>
      )}
      <div className="drawer-section">Request chain</div>
      <div className="chain">
        <div className="chain-step">
          <span className="faint cell-mono" style={{ width: 64, fontSize: 11 }}>entry</span>
          <div className="chain-node">{(r.entryPoints || []).join(", ") || "—"} <span className="faint">http</span></div>
        </div>
        {(r.middlewares || []).map((m) => {
          const mw = snapshot.middlewares.find((x: Middleware) => x.fullName === m && x.instance === r.instance);
          return (
            <div className="chain-step" key={m}>
              <span className="faint cell-mono" style={{ width: 64, fontSize: 11 }}>mw</span>
              <div className="chain-node" style={{ cursor: mw ? "pointer" : "default" }} onClick={() => mw && onSelect({ kind: "middleware", data: mw })}>
                {m.replace(/@.*/, "")}
                {mw?.authentik && <AkBadge style={{ marginLeft: 6 }} />}
              </div>
            </div>
          );
        })}
        <div className="chain-step">
          <span className="faint cell-mono" style={{ width: 64, fontSize: 11 }}>service</span>
          <div className="chain-node svc-node" style={{ borderColor: "var(--accent)", cursor: svc ? "pointer" : "default" }} onClick={() => svc && onSelect({ kind: "service", data: svc })}>
            {r.service.replace(/@.*/, "")} {svc && <span className={`sdot s-${statusKind(svc.status)}`} style={{ marginLeft: 6 }}></span>}
          </div>
        </div>
      </div>

      {r.authentik && (
        <>
          <div className="drawer-section">Authentik</div>
          <div className="kv"><span>Application</span><span>{r.authentik.application || r.authentik.provider || "—"}</span></div>
          {r.authentik.provider && r.authentik.provider !== r.authentik.application && (
            <div className="kv"><span>Provider</span><span>{r.authentik.provider}</span></div>
          )}
          {r.authentik.outpost && <div className="kv"><span>Outpost</span><span>{r.authentik.outpost}</span></div>}
          {r.authentik.mode && <div className="kv"><span>Mode</span><span className="pill-soft">{AK_MODE_LABEL[r.authentik.mode] || r.authentik.mode}</span></div>}
        </>
      )}

      {svc && (
        <>
          <div className="drawer-section">Backend servers</div>
          <pre className="code">
            {(svc.servers || []).map((sv: any) => `${sv.status === "DOWN" ? "✕" : "✓"} ${sv.url || sv.address}  ${sv.status || "UP"}`).join("\n")}
          </pre>
        </>
      )}
      {inst && safeHref(inst.dashboardURL) && <a className="dlink" style={{ marginTop: 14 }} href={safeHref(inst.dashboardURL)} target="_blank" rel="noreferrer">Open {r.instance} dashboard <Icons.ext /></a>}
    </>
  );
}

function ServiceDetail({ s, snapshot }: { s: Service; snapshot: Snapshot }) {
  const inst = snapshot.instances.find((i) => i.name === s.instance);
  return (
    <>
      <div className="kv"><span>Type</span><span>{s.type}</span></div>
      <div className="kv"><span>Provider</span><span>{s.provider}</span></div>
      <div className="kv"><span>Health</span><span>{s.serversUp}/{s.serversTotal} servers up</span></div>
      <div className="kv"><span>Node</span><NodeLine snapshot={snapshot} name={s.instance} /></div>
      
      <div className="drawer-section">Servers</div>
      <pre className="code">
        {(s.servers || []).map((sv: any) => `${sv.status === "DOWN" ? "✕" : "✓"} ${sv.url || sv.address}  ${sv.status || "UP"}`).join("\n")}
      </pre>
      <div className="drawer-section">Used by</div>
      <div className="usedby-list">
        {(s.usedBy || []).map((u) => <span className="usedby-item" key={u}>{u.replace(/@.*/, "")}</span>)}
      </div>
      {inst && safeHref(inst.dashboardURL) && <a className="dlink" style={{ marginTop: 14 }} href={safeHref(inst.dashboardURL)} target="_blank" rel="noreferrer">Open {s.instance} dashboard <Icons.ext /></a>}
    </>
  );
}

function MiddlewareDetail({ m, snapshot }: { m: Middleware; snapshot: Snapshot }) {
  return (
    <>
      <div className="kv"><span>Type</span><span>{m.type}</span></div>
      <div className="kv"><span>Provider</span><span>{m.provider}</span></div>
      <div className="kv"><span>Used by</span><span>{m.usedBy} router{m.usedBy !== 1 ? "s" : ""}</span></div>
      <div className="kv"><span>Node</span><NodeLine snapshot={snapshot} name={m.instance} /></div>
      
      {m.authentik && (
        <>
          <div className="drawer-section">Authentik</div>
          <div className="kv"><span>Forward auth</span><AkBadge /></div>
          <div className="kv">
            <span>Applications</span>
            {(m.authentik.applications || []).length > 0
              ? <span className="usedby-list">{m.authentik.applications!.map((a) => <span className="usedby-item" key={a}>{a}</span>)}</span>
              : <span className="muted">none matched</span>}
          </div>
          {(m.authentik.outposts || []).length > 0 && (
            <div className="kv"><span>Outpost{m.authentik.outposts!.length > 1 ? "s" : ""}</span><span>{m.authentik.outposts!.join(", ")}</span></div>
          )}
        </>
      )}

      <div className="drawer-section">Configuration</div>
      <pre className="cfg-block">{JSON.stringify(m.config || {}, null, 2)}</pre>
      {(m.usedByRouters || []).length > 0 && (
        <>
          <div className="drawer-section">Attached routers</div>
          <div className="usedby-list">{m.usedByRouters.map((u) => <span className="usedby-item" key={u}>{u.replace(/@.*/, "")}</span>)}</div>
        </>
      )}
    </>
  );
}

function InstanceDetail({ i, snapshot }: { i: any; snapshot: Snapshot }) {
  return (
    <>
      <div className="kv"><span>Status</span><Badge status={i.status} /></div>
      <div className="kv"><span>Version</span><span>{i.version}</span></div>
      <div className="kv"><span>URL</span><span className="mono">{i.url}</span></div>
      <div className="kv"><span>Node</span><NodeLine snapshot={snapshot} name={i.name} /></div>
      {i.error && <div className="kv"><span>Error</span><span className="err-text">{i.error}</span></div>}
      {safeHref(i.dashboardURL) && <a className="dlink" style={{ marginTop: 14 }} href={safeHref(i.dashboardURL)} target="_blank" rel="noreferrer">Open dashboard <Icons.ext /></a>}
    </>
  );
}
