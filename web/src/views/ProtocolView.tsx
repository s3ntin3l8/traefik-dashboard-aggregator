// TCP / UDP routers, services, middlewares + drawer. Ported from tv-tables.jsx ProtocolView.
import { useState } from "react";
import type { Snapshot, Router, Service, Middleware } from "../lib/types";
import { Icons, Badge, InstanceTag, NodeLine, statusKind, safeHref, useIsMobile, DataCard, instOK } from "../components/ui";
import { HostRule } from "./Tables";
import type { Sel } from "../lib/sel";

type Proto = "tcp" | "udp";
type Kind = "routers" | "services" | "middlewares";

function summarize(cfg: Record<string, unknown> | undefined): string {
  if (!cfg) return "—";
  return Object.entries(cfg)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(",") : typeof v === "object" ? JSON.stringify(v) : v}`)
    .join("  ·  ");
}

export function ProtocolView({ proto, kind, snapshot, search, fInstance, fStatus, setFStatus }: {
  proto: Proto;
  kind: Kind;
  snapshot: Snapshot;
  search: string;
  fInstance: string[];
  fStatus: string | null;
  setFStatus: (s: string | null) => void;
}) {
  const P = proto.toUpperCase();
  const isRouters = kind === "routers";
  const isMw = kind === "middlewares";
  const Noun = isMw ? "Middlewares" : isRouters ? "Routers" : "Services";
  const noun = isMw ? "middleware" : isRouters ? "router" : "service";
  const [sel, setSel] = useState<(Sel & { proto: Proto }) | null>(null);
  const q = (search || "").trim().toLowerCase();

  const all: any[] = isMw
    ? snapshot.tcpMiddlewares
    : proto === "tcp"
      ? isRouters ? snapshot.tcpRouters : snapshot.tcpServices
      : isRouters ? snapshot.udpRouters : snapshot.udpServices;

  const rows = (all || []).filter((r) =>
    instOK(fInstance, r.instance) &&
    (isMw || !fStatus || statusKind(r.status) === fStatus) &&
    (!q ||
      r.name.toLowerCase().includes(q) ||
      (r.rule || "").toLowerCase().includes(q) ||
      (r.type || "").toLowerCase().includes(q) ||
      (r.service || "").toLowerCase().includes(q) ||
      (r.servers || []).some((s: any) => (s.address || "").includes(q))));

  return (
    <div className="content-wide fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">{P} {Noun}</h1>
          <div className="page-desc">{rows.length} {P} {noun}{rows.length === 1 ? "" : "s"}{fInstance.length || fStatus || q ? " · filtered" : " · across all nodes"}</div>
        </div>
        <div className="chips">
          {!isMw && ["ok", "warn", "down"].map((s) => (
            <button key={s} className={`chip ${fStatus === s ? "on" : ""}`} onClick={() => setFStatus(fStatus === s ? null : s)}>
              <span className={`sdot s-${s}`}></span>{s === "ok" ? "Healthy" : s === "warn" ? "Warning" : "Down"}
            </button>
          ))}
        </div>
      </div>

      {useIsMobile() ? (
        <div className="mcard-list">
          {isRouters && rows.map((r: Router) => (
            <DataCard key={r.id} status={r.status} title={r.name.replace(/@.*/, "")} titleSub={`@${r.name.split("@")[1] || "docker"}`}
              onClick={() => setSel({ kind: "router", proto, data: r })}
              rows={[
                { label: "Service", value: <span className="mono">{(r.service || "").replace(/@.*/, "")}</span> },
                { label: "Entrypoint", value: (r.entryPoints || []).join(", ") || "—" },
                { label: "Node", value: <InstanceTag name={r.instance} snapshot={snapshot} /> },
              ]}
            />
          ))}
          {!isRouters && !isMw && rows.map((s: Service) => (
            <DataCard key={s.id} status={s.status} title={s.shortName} titleSub={`@${s.provider}`}
              onClick={() => setSel({ kind: "service", proto, data: s })}
              rows={[
                { label: "Backend", value: <span className="mono">{(s.servers && s.servers[0] && s.servers[0].address) || "—"}{s.servers && s.servers.length > 1 ? ` +${s.servers.length - 1}` : ""}</span> },
                { label: "Node", value: <InstanceTag name={s.instance} snapshot={snapshot} /> },
              ]}
            />
          ))}
          {isMw && rows.map((m: Middleware) => (
            <DataCard key={m.id} title={m.name} badge={<span className="badge neutral">{m.type}</span>}
              onClick={() => setSel({ kind: "middleware", proto, data: m })}
              rows={[
                { label: "Used by", value: <span className="mono">{m.usedBy}</span> },
                { label: "Node", value: <InstanceTag name={m.instance} snapshot={snapshot} /> },
              ]}
            />
          ))}
          {!rows.length && <div className="empty-row">No {P} {noun}s discovered yet.</div>}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="tv-table">
            {isMw ? (
              <thead><tr><th>Middleware</th><th>Type</th><th>Config</th><th>Used by</th><th>Node</th></tr></thead>
            ) : isRouters ? (
              <thead><tr>
                <th style={{ width: 26 }}></th><th>Router</th>
                {proto === "tcp" && <th>Rule</th>}<th>Service</th><th>Entrypoint</th>
                {proto === "tcp" && <th>TLS</th>}<th>Node</th><th>Status</th>
              </tr></thead>
            ) : (
              <thead><tr>
                <th style={{ width: 26 }}></th><th>Service</th><th>Type</th><th>Backend</th><th>Used by</th><th>Node</th><th>Status</th>
              </tr></thead>
            )}
            <tbody>
              {isRouters && rows.map((r: Router) => (
                <tr key={r.id} onClick={() => setSel({ kind: "router", proto, data: r })}>
                  <td><span className={`sdot s-${statusKind(r.status)}`}></span></td>
                  <td className="cell-name cell-mono">{r.name.replace(/@.*/, "")}<span className="faint" style={{ fontWeight: 400, fontSize: 11 }}> @{r.name.split("@")[1] || "docker"}</span></td>
                  {proto === "tcp" && <td className="cell-mono muted"><HostRule rule={r.rule} /></td>}
                  <td className="cell-mono muted">{(r.service || "").replace(/@.*/, "")}</td>
                  <td>{(r.entryPoints || []).map((e) => <span className="ep" key={e}>{e}</span>)}</td>
                  {proto === "tcp" && <td>{r.tls ? <span className="itag"><Icons.lock size={12} /> passthrough</span> : <span className="faint">—</span>}</td>}
                  <td><InstanceTag name={r.instance} snapshot={snapshot} /></td>
                  <td><Badge status={r.status} /></td>
                </tr>
              ))}
              {!isRouters && !isMw && rows.map((s: Service) => (
                <tr key={s.id} onClick={() => setSel({ kind: "service", proto, data: s })}>
                  <td><span className={`sdot s-${statusKind(s.status)}`}></span></td>
                  <td className="cell-name cell-mono">{s.shortName}<span className="faint" style={{ fontWeight: 400, fontSize: 11 }}> @{s.provider}</span></td>
                  <td><span className="badge neutral">{proto}</span></td>
                  <td className="cell-mono muted">{(s.servers && s.servers[0] && s.servers[0].address) || "—"}{s.servers && s.servers.length > 1 ? ` +${s.servers.length - 1}` : ""}</td>
                  <td className="cell-mono muted tabnum">{(s.usedBy || []).length}</td>
                  <td><InstanceTag name={s.instance} snapshot={snapshot} /></td>
                  <td><Badge status={s.status} /></td>
                </tr>
              ))}
              {isMw && rows.map((m: Middleware) => (
                <tr key={m.id} onClick={() => setSel({ kind: "middleware", proto, data: m })}>
                  <td className="cell-name cell-mono">{m.name}</td>
                  <td><span className="badge neutral">{m.type}</span></td>
                  <td className="cell-mono faint" style={{ fontSize: 11, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summarize(m.config)}</td>
                  <td className="cell-mono muted tabnum">{m.usedBy}</td>
                  <td><InstanceTag name={m.instance} snapshot={snapshot} /></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="empty">No {P} {noun}s discovered yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {sel && <ProtoDrawer item={sel} snapshot={snapshot} onClose={() => setSel(null)} onSelect={setSel} />}
    </div>
  );
}

function ProtoDrawer({ item, snapshot, onClose, onSelect }: { item: Sel & { proto: Proto }; snapshot: Snapshot; onClose: () => void; onSelect: (s: Sel & { proto: Proto }) => void }) {
  const { proto, kind, data } = item;
  const clean = (n: string) => n.replace(/@.*/, "");
  const svcList = [...snapshot.httpServices, ...snapshot.tcpServices, ...snapshot.udpServices];
  const inst = snapshot.instances.find((i) => i.name === data.instance);
  const svc = kind === "router" ? (svcList || []).find((s) => s.instance === data.instance && clean(s.name) === clean(data.service)) : data;
  return (
    <>
      <div className="scrim" onClick={onClose}></div>
      <aside className="drawer">
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 7 }}>
              <span className="badge neutral" style={{ textTransform: "uppercase" }}>{proto} {kind}</span>
              {data.status && <Badge status={data.status} />}
            </div>
            <div className="drawer-title">{data.name}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icons.x size={16} /></button>
        </div>
        <div className="drawer-body">
          {kind === "router" ? (
            <>
              <div className="kv"><span>Open</span>{data.host ? <span className="cell-host"><a href={data.tls ? `https://${data.host}` : `http://${data.host}`} target="_blank" rel="noreferrer">{data.host}</a></span> : <span className="muted">—</span>}</div>
              {data.rule && <div className="kv"><span>Rule</span><HostRule rule={data.rule} /></div>}
              <div className="kv"><span>Entrypoints</span><span>{(data.entryPoints || []).join(", ")}</span></div>
              {proto === "tcp" && <div className="kv"><span>TLS</span><span>{data.tls ? `enabled${data.certResolver ? ` (${data.certResolver})` : ""}` : <span className="muted">disabled</span>}</span></div>}
              {(data.priority || 0) > 0 && <div className="kv"><span>Priority</span><span>{data.priority}</span></div>}
              <div className="kv"><span>Provider</span><span>{data.provider || "docker"}</span></div>
              <div className="kv"><span>Node</span><NodeLine snapshot={snapshot} name={data.instance} /></div>

              <div className="sec-label">Stream chain</div>
              <div className="chain">
                <div className="chain-step"><span className="faint cell-mono" style={{ width: 64, fontSize: 11 }}>entry</span><div className="chain-node">{(data.entryPoints || []).join(", ")} <span className="faint">{proto}</span></div></div>
                {(data.middlewares || []).map((m: string) => {
                  const mw = (snapshot.tcpMiddlewares || []).find((x) => x.instance === data.instance && x.fullName === m);
                  return (
                    <div className="chain-step" key={m}><span className="faint cell-mono" style={{ width: 64, fontSize: 11 }}>mw</span>
                      <div className="chain-node" style={{ cursor: mw ? "pointer" : "default" }} onClick={() => mw && onSelect({ kind: "middleware", proto, data: mw })}>{m}</div>
                    </div>
                  );
                })}
                <div className="chain-step"><span className="faint cell-mono" style={{ width: 64, fontSize: 11 }}>service</span>
                  <div className="chain-node svc-node" style={{ cursor: svc ? "pointer" : "default", borderColor: "var(--accent)" }} onClick={() => svc && onSelect({ kind: "service", proto, data: svc })}>
                    {data.service.replace(/@.*/, "")} {svc && <span className={`sdot s-${statusKind(svc.status)}`} style={{ marginLeft: 6 }}></span>}
                  </div>
                </div>
              </div>
              {svc && <>
                <div className="sec-label">Backend servers</div>
                <pre className="code">{(svc.servers || []).map((s: any) => `${s.status === "DOWN" ? "✕" : "✓"} ${s.address || s.url}  ${s.status || "UP"}`).join("\n")}</pre>
              </>}
            </>
          ) : kind === "middleware" ? (
            <>
              <div className="kv"><span>Type</span><span>{data.type}</span></div>
              <div className="kv"><span>Provider</span><span>{data.provider}</span></div>
              <div className="kv"><span>Scope</span><span>tcp</span></div>
              <div className="kv"><span>Used by</span><span>{data.usedBy} router{data.usedBy === 1 ? "" : "s"}</span></div>
              <div className="kv"><span>Node</span><NodeLine snapshot={snapshot} name={data.instance} /></div>
              
              <div className="sec-label">Configuration</div>
              <pre className="code">{JSON.stringify(data.config, null, 2)}</pre>
              {(data.usedByRouters || []).length > 0 && (
                <>
                  <div className="sec-label">Attached routers</div>
                  <div className="usedby-list">
                    {data.usedByRouters.map((u: string) => <span className="usedby-item" key={u}>{u.replace(/@.*/, "")}</span>)}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="kv"><span>Type</span><span>{proto} loadbalancer</span></div>
              <div className="kv"><span>Health</span><span>{data.serversUp}/{data.serversTotal} servers up</span></div>
              <div className="kv"><span>Used by</span><span>{(data.usedBy || []).join(", ") || "—"}</span></div>
              <div className="kv"><span>Node</span><NodeLine snapshot={snapshot} name={data.instance} /></div>
              
              <div className="sec-label">Servers</div>
              <pre className="code">{(data.servers || []).map((s: any) => `${s.status === "DOWN" ? "✕" : "✓"} ${s.address || s.url}  ${s.status || "UP"}`).join("\n")}</pre>
            </>
          )}
          {inst && safeHref(inst.dashboardURL) && <a className="dlink" style={{ marginTop: 14 }} href={safeHref(inst.dashboardURL)} target="_blank" rel="noreferrer">Open {data.instance} dashboard <Icons.ext /></a>}
        </div>
      </aside>
    </>
  );
}
