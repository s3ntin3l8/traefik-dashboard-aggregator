// TLS certificates view with expiry tracking. Ported from tv-certs.jsx.
import { useState, useMemo } from "react";
import type { Snapshot, Certificate } from "../lib/types";
import { Icons, Badge, InstanceTag, SortHead } from "../components/ui";
import type { Sort } from "../components/ui";

type CertRowData = Certificate & { days: number; cstatus: string; challenge?: string };

export function CertificatesView({ snapshot, search, fInstance }: { snapshot: Snapshot; search: string; fInstance: string | null }) {
  const [sort, setSort] = useState<Sort>({ key: "notAfter", dir: "asc" });
  const [fStatus, setFStatus] = useState<string | null>(null);
  const [sel, setSel] = useState<CertRowData | null>(null);

  const now = Date.now();
  const rows = useMemo<CertRowData[]>(() => {
    let cs = snapshot.certificates || [];
    if (fInstance) cs = cs.filter((c) => c.instance === fInstance);
    const q = (search || "").trim().toLowerCase();
    if (q) cs = cs.filter((c) => c.domain.toLowerCase().includes(q) || (c.sans || []).some((s) => s.toLowerCase().includes(q)));
    const statusOf = (d: number) => (d < 0 ? "expired" : d <= 21 ? "expiring" : "valid");
    let r = cs.map((c) => {
      const days = Math.floor((c.notAfter - now) / 86400000);
      return { ...c, days, cstatus: statusOf(days) } as CertRowData;
    });
    if (fStatus) r = r.filter((c) => c.cstatus === fStatus);
    r.sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "notAfter") return (a.notAfter - b.notAfter) * dir;
      if (sort.key === "domain") return a.domain.localeCompare(b.domain) * dir;
      if (sort.key === "instance") return a.instance.localeCompare(b.instance) * dir;
      return 0;
    });
    return r;
  }, [snapshot, search, fInstance, fStatus, sort, now]);

  const counts = useMemo(() => {
    const cs = (snapshot.certificates || []).filter((c) => !fInstance || c.instance === fInstance);
    const m = { total: cs.length, valid: 0, expiring: 0, expired: 0 };
    cs.forEach((c) => {
      const d = Math.floor((c.notAfter - now) / 86400000);
      if (d < 0) m.expired++;
      else if (d <= 21) m.expiring++;
      else m.valid++;
    });
    return m;
  }, [snapshot, fInstance, now]);

  return (
    <div className="content-wide fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Certificates</h1>
          <div className="page-desc">{rows.length} of {counts.total} certificates{fInstance || fStatus || search ? " · filtered" : " · across all nodes"}</div>
        </div>
      </div>

      <div className="cert-tiles">
        <Tile label="Total" value={counts.total} kind="" />
        <Tile label="Valid" value={counts.valid} kind="ok" />
        <Tile label="Expiring ≤21d" value={counts.expiring} kind="warn" />
        <Tile label="Expired" value={counts.expired} kind="down" />
      </div>

      <div className="filter-row">
        <div className="chips">
          {["valid", "expiring", "expired"].map((s) => (
            <button key={s} className={`chip ${fStatus === s ? "on" : ""}`} onClick={() => setFStatus(fStatus === s ? null : s)}>
              <span className={`sdot s-${s === "valid" ? "ok" : s === "expiring" ? "warn" : "down"}`}></span>{s}
            </button>
          ))}
          {(fStatus || search) && <button className="chip" onClick={() => setFStatus(null)}>Clear</button>}
        </div>
      </div>

      <div className="table-wrap">
        <table className="dtable cert-table">
          <thead>
            <tr>
              <SortHead col="domain" label="Domain" sort={sort} setSort={setSort} />
              <th>SANs</th>
              <SortHead col="notAfter" label="Expires" sort={sort} setSort={setSort} />
              <th>Resolver</th>
              <th>Issuer</th>
              <SortHead col="instance" label="Node" sort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => <CertRow key={c.id} c={c} snapshot={snapshot} onSelect={() => setSel(c)} />)}
          </tbody>
        </table>
      </div>

      {sel && <CertDrawer cert={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function Tile({ label, value, kind }: { label: string; value: number; kind: string }) {
  return <div className={`ctile ${kind}`}><div className="ctile-val">{value}</div><div className="ctile-lbl">{label}</div></div>;
}

function CertRow({ c, snapshot, onSelect }: { c: CertRowData; snapshot: Snapshot; onSelect: () => void }) {
  const k = c.cstatus === "valid" ? "ok" : c.cstatus === "expiring" ? "warn" : "down";
  const pct = Math.max(0, Math.min(100, (c.days / 90) * 100));
  const sans = c.sans || [];
  return (
    <tr onClick={onSelect} className="crow">
      <td><span className="cert-domain">{c.wildcard && <span className="wild">✲</span>}{c.domain}</span></td>
      <td className="faint">{sans.length} SAN{sans.length !== 1 ? "s" : ""}</td>
      <td>
        <div className="exp-cell">
          <span className={`exp-days ${k}`}>{c.days < 0 ? `expired ${-c.days}d ago` : `${c.days}d`}</span>
          <div className="exp-bar"><div className={`exp-fill f-${k}`} style={{ width: pct + "%" }}></div></div>
        </div>
      </td>
      <td><span className="pill-soft">{c.resolver || "—"}</span></td>
      <td className="faint">{c.issuer} {c.issuerCN}</td>
      <td><InstanceTag name={c.instance} snapshot={snapshot} /></td>
    </tr>
  );
}

function CertDrawer({ cert, onClose }: { cert: CertRowData; onClose: () => void }) {
  const now = Date.now();
  const days = Math.floor((cert.notAfter - now) / 86400000);
  const k = days < 0 ? "down" : days <= 21 ? "warn" : "ok";
  const sans = cert.sans || [];
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">{cert.domain}</div>
            <div className="drawer-sub">{cert.wildcard ? "Wildcard certificate" : "Certificate"}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icons.x size={18} /></button>
        </div>
        <div className="drawer-body">
          <div className="kv"><span>Status</span><span><Badge status={k === "ok" ? "ok" : k === "warn" ? "warning" : "error"} label={days < 0 ? "Expired" : days <= 21 ? "Expiring" : "Valid"} /></span></div>
          <div className="kv"><span>Expires</span><span>{new Date(cert.notAfter).toLocaleString()} ({days}d)</span></div>
          <div className="kv"><span>Issued</span><span>{new Date(cert.notBefore).toLocaleString()}</span></div>
          <div className="kv"><span>Resolver</span><span>{cert.resolver || "—"}</span></div>
          {cert.challenge && <div className="kv"><span>Challenge</span><span>{cert.challenge}</span></div>}
          <div className="kv"><span>Issuer</span><span>{cert.issuer} {cert.issuerCN}</span></div>
          <div className="kv"><span>Serial</span><span className="mono">{cert.serial}</span></div>
          <div className="kv"><span>Key</span><span>{cert.keyType}</span></div>
          <div className="kv"><span>Node</span><span>{cert.instance}</span></div>
          <div className="drawer-section">SANs</div>
          <div className="san-list">{sans.map((s) => <span className="san" key={s}>{s}</span>)}</div>
        </div>
      </div>
    </div>
  );
}
