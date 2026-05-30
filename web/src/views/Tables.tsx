// HTTP tables (routers/services/middlewares) + detail drawer. Ported from tv-tables.jsx.
import { useState, useMemo } from "react";
import type { Snapshot, Router, Service, Middleware } from "../lib/types";
import { Icons, Badge, InstanceTag, MwList, SortHead } from "../components/ui";
import type { Sort } from "../components/ui";
import type { Sel } from "../lib/sel";

export function useSorted<T extends Record<string, any>>(rows: T[], sort: Sort): T[] {
  return useMemo(() => {
    const r = [...rows];
    const dir = sort.dir === "asc" ? 1 : -1;
    r.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return ((av || 0) - (bv || 0)) * dir;
    });
    return r;
  }, [rows, sort]);
}

export function RoutersTable({ rows, snapshot, onSelect, selId }: { rows: Router[]; snapshot: Snapshot; onSelect: (s: Sel) => void; selId?: string }) {
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const sorted = useSorted(rows, sort);
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
              <td className="mono rule-cell">{r.rule}</td>
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
  return (
    <div className="table-wrap">
      <table className="dtable">
        <thead>
          <tr>
            <SortHead col="name" label="Service" sort={sort} setSort={setSort} />
            <th>Type</th>
            <th>Servers</th>
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
              <td><InstanceTag name={s.instance} snapshot={snapshot} /></td>
              <td style={{ textAlign: "right" }}><Badge status={s.status} /></td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={5} className="empty-row">No services match.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function MiddlewaresTable({ rows, snapshot, onSelect, selId }: { rows: Middleware[]; snapshot: Snapshot; onSelect: (s: Sel) => void; selId?: string }) {
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const sorted = useSorted(rows, sort);
  return (
    <div className="table-wrap">
      <table className="dtable">
        <thead>
          <tr>
            <SortHead col="name" label="Middleware" sort={sort} setSort={setSort} />
            <th>Type</th>
            <SortHead col="instance" label="Node" sort={sort} setSort={setSort} />
            <th style={{ textAlign: "right" }}>Used by</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr key={m.id} className={`drow ${selId === m.id ? "sel" : ""}`} onClick={() => onSelect({ kind: "middleware", data: m })}>
              <td><span className="cell-name">{m.name}</span></td>
              <td><span className="pill-soft">{m.type}</span></td>
              <td><InstanceTag name={m.instance} snapshot={snapshot} /></td>
              <td style={{ textAlign: "right" }}>{m.usedBy > 0 ? <span className="usedby">{m.usedBy}</span> : <span className="faint">unused</span>}</td>
            </tr>
          ))}
          {sorted.length === 0 && <tr><td colSpan={4} className="empty-row">No middlewares match.</td></tr>}
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
          <div>
            <div className="drawer-title">{data.shortName || data.name}</div>
            <div className="drawer-sub">{kind} · {data.instance}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icons.x size={18} /></button>
        </div>
        <div className="drawer-body">
          {kind === "router" && <RouterDetail r={data} snapshot={snapshot} onSelect={onSelect} />}
          {kind === "service" && <ServiceDetail s={data} />}
          {kind === "middleware" && <MiddlewareDetail m={data} />}
          {kind === "instance" && <InstanceDetail i={data} snapshot={snapshot} />}
        </div>
      </div>
    </div>
  );
}

function RouterDetail({ r, snapshot, onSelect }: { r: Router; snapshot: Snapshot; onSelect: (s: Sel) => void }) {
  const svc =
    snapshot.httpServices.find((s) => s.name === r.service && s.instance === r.instance) ||
    snapshot.tcpServices.find((s) => s.name === r.service && s.instance === r.instance) ||
    snapshot.udpServices.find((s) => s.name === r.service && s.instance === r.instance);
  return (
    <>
      <div className="kv"><span>Status</span><span><Badge status={r.status} /></span></div>
      {r.rule && <div className="kv"><span>Rule</span><span className="mono">{r.rule}</span></div>}
      <div className="kv"><span>Entrypoints</span><span>{(r.entryPoints || []).join(", ")}</span></div>
      <div className="kv"><span>Provider</span><span>{r.provider}</span></div>
      {(r.priority || 0) > 0 && <div className="kv"><span>Priority</span><span>{r.priority}</span></div>}
      {r.tls && <div className="kv"><span>TLS</span><span><Icons.lock size={13} /> enabled</span></div>}
      <div className="drawer-section">Request chain</div>
      <div className="chain">
        <div className="chain-node"><span className="chain-ic">⊕</span> {(r.entryPoints || []).join(", ") || "—"}</div>
        {(r.middlewares || []).map((m) => <div className="chain-node mw-node" key={m}>{m.replace(/@.*/, "")}</div>)}
        <div className="chain-node svc-node" onClick={() => { if (svc) onSelect({ kind: "service", data: svc }); }}>{r.service.replace(/@.*/, "")}</div>
      </div>
      {svc && <div className="chain-servers">{(svc.servers || []).map((sv, i) => <div className="chain-srv" key={i}><span className={`sdot s-${sv.status === "UP" ? "ok" : "down"}`}></span><span className="mono">{sv.url || sv.address}</span></div>)}</div>}
    </>
  );
}

function ServiceDetail({ s }: { s: Service }) {
  return (
    <>
      <div className="kv"><span>Status</span><span><Badge status={s.status} /></span></div>
      <div className="kv"><span>Type</span><span>{s.type}</span></div>
      <div className="kv"><span>Provider</span><span>{s.provider}</span></div>
      <div className="kv"><span>Health</span><span>{s.serversUp}/{s.serversTotal} up</span></div>
      <div className="drawer-section">Servers</div>
      <div className="srv-list">{(s.servers || []).map((sv, i) => <div className="srv-item" key={i}><span className={`sdot s-${sv.status === "UP" ? "ok" : "down"}`}></span><span className="mono">{sv.url || sv.address}</span></div>)}</div>
      <div className="drawer-section">Used by</div>
      <div className="usedby-list">{(s.usedBy || []).map((u) => <span className="usedby-item" key={u}>{u.replace(/@.*/, "")}</span>)}</div>
    </>
  );
}

function MiddlewareDetail({ m }: { m: Middleware }) {
  return (
    <>
      <div className="kv"><span>Type</span><span>{m.type}</span></div>
      <div className="kv"><span>Provider</span><span>{m.provider}</span></div>
      <div className="kv"><span>Used by</span><span>{m.usedBy} router{m.usedBy !== 1 ? "s" : ""}</span></div>
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
  const rc = snapshot.httpRouters.filter((r) => r.instance === i.name).length;
  return (
    <>
      <div className="kv"><span>Status</span><span><Badge status={i.status} /></span></div>
      <div className="kv"><span>Version</span><span>{i.version}</span></div>
      <div className="kv"><span>URL</span><span className="mono">{i.url}</span></div>
      {i.error && <div className="kv"><span>Error</span><span className="err-text">{i.error}</span></div>}
      <div className="drawer-section">Counts</div>
      <div className="kv"><span>Routers</span><span>{rc}</span></div>
    </>
  );
}
