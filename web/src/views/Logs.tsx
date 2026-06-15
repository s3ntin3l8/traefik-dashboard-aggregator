// Logs view: histogram, live tail, filters, detail drawer. Source: Loki.
// Ported from tv-logs.jsx; the mock generator is replaced by the backend
// /api/logs/query (window) + /api/logs/tail (SSE) endpoints.
import { useState, useEffect, useMemo } from "react";
import type { Snapshot, LogEntry } from "../lib/types";
import { Icons } from "../components/ui";
import { fetchLogs, fetchFeatures } from "../lib/sse";
import { filterLogs, countLogLevels, logText } from "../lib/logfilter";

export function LogsView({ snapshot, globalSearch, fInstance }: { snapshot: Snapshot; globalSearch: string; fInstance: string[] }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [live, setLive] = useState(true);
  const [level, setLevel] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<LogEntry | null>(null);
  const [range, setRange] = useState(30 * 60 * 1000);
  const [zoom, setZoom] = useState<{ start: number; end: number } | null>(null);
  const [lokiEnabled, setLokiEnabled] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Use a ref for 'now' to avoid constant re-renders from advancing time,
  // but still allow it to refresh when needed.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live || zoom) return;
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, [live, zoom]);

  useEffect(() => {
    fetchFeatures().then((f) => setLokiEnabled(f.lokiEnabled));
  }, []);

  const winStart = zoom ? zoom.start : now - range;
  const winEnd = zoom ? zoom.end : now;

  // When exactly one instance is selected pass it to the backend; if multiple
  // or none are selected, fetch all and filter client-side via fInstance.
  const singleInstance = fInstance.length === 1 ? fInstance[0] : null;

  // load the selected window whenever range/zoom/instance changes. The backend
  // builds the Loki selector; we only pass the (optional) instance filter.
  useEffect(() => {
    if (!lokiEnabled) return;
    let cancelled = false;
    fetchLogs({
      instance: singleInstance,
      startMs: zoom ? zoom.start : Date.now() - range,
      endMs: zoom ? zoom.end : Date.now(),
      limit: 1000
    })
      .then((rows) => !cancelled && setLogs(rows))
      .catch((e) => !cancelled && setErr(String(e)));
    return () => { cancelled = true; };
  }, [range, zoom, lokiEnabled, singleInstance]);

  // live tail via SSE
  useEffect(() => {
    if (!lokiEnabled || !live || zoom) return;
    const url = singleInstance
      ? `/api/logs/tail?instance=${encodeURIComponent(singleInstance)}`
      : `/api/logs/tail`;
    const es = new EventSource(url);
    es.addEventListener("log", (e) => {
      try {
        const entry = JSON.parse((e as MessageEvent).data) as LogEntry;
        setLogs((prev) => {
          // avoid duplicates if the tail overlaps with the initial fetch
          if (prev.some(p => p.id === entry.id)) return prev;
          return [entry, ...prev].slice(0, 2000);
        });
      } catch { /* ignore */ }
    });
    return () => es.close();
  }, [live, zoom, lokiEnabled, singleInstance]);

  const filtered = useMemo(
    () => filterLogs(logs, { level, kind, instances: fInstance, search: q, globalSearch, winStart, winEnd }),
    [logs, level, kind, fInstance, q, globalSearch, winStart, winEnd],
  );

  // Level chips show each level's count regardless of the active level filter.
  const counts = useMemo(
    () => countLogLevels(logs, { kind, instances: fInstance, search: q, globalSearch, winStart, winEnd }),
    [logs, kind, fInstance, q, globalSearch, winStart, winEnd],
  );

  if (lokiEnabled === false) {
    return (
      <div className="content-wide fade-in">
        <div className="page-head"><div><h1 className="page-title">Logs</h1><div className="page-desc">via Loki</div></div></div>
        <div className="panel"><div className="empty-row">Logs are not configured. Set <span className="mono">loki.url</span> in the config to enable the Logs view (the Traefik API does not expose logs).</div></div>
      </div>
    );
  }

  return (
    <div className="content-wide fade-in logs-view">
      <div className="page-head">
        <div>
          <h1 className="page-title">Logs</h1>
          <div className="page-desc">via Loki · {filtered.length} lines · {live && !zoom ? "live" : "paused"}{err ? " · error" : ""}</div>
        </div>
        <div className="logs-actions">
          <button className={`live-toggle ${live && !zoom ? "on" : ""}`} onClick={() => { setLive(!live); if (zoom) setZoom(null); }}>
            <span className="live-dot"></span>{live && !zoom ? "Live tail" : "Paused"}
          </button>
        </div>
      </div>

      <LogHistogram logs={filtered} winStart={winStart} winEnd={winEnd} onZoom={setZoom} zoom={zoom} />

      <div className="logs-filters-area">
        <div className="filter-row">
          <div className="logql" style={{ width: "100%", maxWidth: "none" }}>
            <span className="logql-brace">{`{`}</span>job=<span className="logql-val">"docker"</span>, container=<span className="logql-val">"traefik"</span>{fInstance.length === 1 && <>, instance=<span className="logql-val">"{fInstance[0]}"</span></>}{fInstance.length > 1 && <>, instance=~<span className="logql-val">"{fInstance.join("|")}"</span></>}<span className="logql-brace">{`}`}</span>
            <input className="logql-input" placeholder="|= filter expression…" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="src-tag">via Loki</span>
          </div>
        </div>
        <div className="filter-row" style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="row" style={{ gap: 16 }}>
            <div className="chips">
              {["info", "warning", "error"].map((lv) => (
                <button key={lv} className={`chip ${level === lv ? "on" : ""}`} onClick={() => setLevel(level === lv ? null : lv)}>
                  <span className={`sdot s-${lv === "info" ? "ok" : lv === "warning" ? "warn" : "down"}`}></span>{lv} <b>{counts[lv] || 0}</b>
                </button>
              ))}
            </div>
            <div className="seg kind-seg">
              {([["all", null], ["access", "access"], ["system", "system"]] as [string, string | null][]).map(([lbl, v]) => (
                <button key={lbl} className={kind === v ? "on" : ""} onClick={() => setKind(v)}>{lbl}</button>
              ))}
            </div>
          </div>
          <div className="range-seg seg">
            {([["15m", 9e5], ["1h", 36e5], ["6h", 216e5], ["24h", 864e5]] as [string, number][]).map(([lbl, ms]) => (
              <button key={lbl} className={range === ms && !zoom ? "on" : ""} onClick={() => { setRange(ms); setZoom(null); }}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="log-stream">
        {filtered.length === 0 && <div className="empty-row">No log lines match.</div>}
        {filtered.slice(0, 500).map((l) => <LogLine key={l.id} l={l} onClick={() => setSel(l)} />)}
      </div>

      {sel && <LogDrawer log={sel} onClose={() => setSel(null)} />}
    </div>
  );
}

function LogHistogram({ logs, winStart, winEnd, onZoom, zoom }: { logs: LogEntry[]; winStart: number; winEnd: number; onZoom: (z: { start: number; end: number } | null) => void; zoom: { start: number; end: number } | null }) {
  const BUCKETS = 60;
  const buckets = useMemo(() => {
    const span = winEnd - winStart;
    const bw = span / BUCKETS;
    const arr = Array.from({ length: BUCKETS }, () => ({ info: 0, warning: 0, error: 0, t0: 0 } as Record<string, number>));
    logs.forEach((l) => {
      const idx = Math.min(BUCKETS - 1, Math.max(0, Math.floor((l.ts - winStart) / bw)));
      arr[idx][l.level] = (arr[idx][l.level] || 0) + 1;
    });
    arr.forEach((b, i) => (b.t0 = winStart + i * bw));
    return arr;
  }, [logs, winStart, winEnd]);
  const max = Math.max(1, ...buckets.map((b) => b.info + b.warning + b.error));
  const fmt = (t: number) => new Date(t).toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" });

  return (
    <div className="panel histo-panel">
      <div className="histo-head">
        <div className="row" style={{ gap: 10 }}>
          <span className="muted">{zoom ? "zoomed" : "volume"} · {logs.length} lines{!zoom && <span className="faint"> · click a bar to zoom</span>}</span>
          {zoom && <button className="zoom-out" onClick={() => onZoom(null)}>← zoom out</button>}
        </div>
        <div className="row" style={{ gap: 14 }}>
          <span className="topo-leg"><span className="sdot s-down"></span>error</span>
          <span className="topo-leg"><span className="sdot s-warn"></span>warn</span>
          <span className="topo-leg"><span className="sdot" style={{ background: "color-mix(in oklab, var(--accent) 55%, var(--text-faint))" }}></span>info</span>
        </div>
      </div>
      <div className="histo">
        {buckets.map((b, i) => {
          const total = b.info + b.warning + b.error;
          const h = (total / max) * 100;
          return (
            <div className="histo-bar" key={i} style={{ height: "100%" }}
                 onClick={() => { const bw = (winEnd - winStart) / BUCKETS; onZoom({ start: b.t0, end: b.t0 + bw * 4 }); }}
                 title={`${fmt(b.t0)} · ${total} lines`}>
              <div className="hb-stack" style={{ height: h + "%" }}>
                <div className="hb hb-error" style={{ flex: b.error }}></div>
                <div className="hb hb-warn" style={{ flex: b.warning }}></div>
                <div className="hb hb-info" style={{ flex: b.info }}></div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="histo-axis"><span>{fmt(winStart)}</span><span>{fmt((winStart + winEnd) / 2)}</span><span>now</span></div>
    </div>
  );
}

function LogLine({ l, onClick }: { l: LogEntry; onClick: () => void }) {
  const lvlClass = l.level === "error" ? "ll-error" : l.level === "warning" ? "ll-warn" : "ll-info";
  return (
    <div className={`log-line ${lvlClass}`} onClick={onClick}>
      <span className="ll-time">{new Date(l.ts).toLocaleTimeString("en-GB", { hour12: false })}</span>
      <span className={`ll-badge b-${l.level}`}>{l.level.slice(0, 4)}</span>
      <span className="ll-node">{l.instance.replace("pve-", "")}</span>
      <span className="ll-app">{l.app}</span>
      {l.kind === "access" ? (
        <span className="ll-msg">
          <span className={`m-${l.method}`}>{l.method}</span> {l.path}
          <span className={`st st-${String(l.status)[0]}xx`}>{l.status}</span>
          <span className="faint">{l.durationMs}ms · {l.clientIP}</span>
        </span>
      ) : (
        <span className="ll-msg">{l.msg}</span>
      )}
    </div>
  );
}

function LogDrawer({ log, onClose }: { log: LogEntry; onClose: () => void }) {
  const fields: Record<string, unknown> = log.kind === "access"
    ? { ClientAddr: log.clientIP, RequestMethod: log.method, RequestPath: log.path, RequestHost: log.host, DownstreamStatus: log.status, Duration: log.durationMs + "ms", RouterName: log.router, ServiceName: log.service, RequestProtocol: log.proto, OriginContentSize: log.size }
    : (log.fields || {});
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <div className="drawer-title">{log.kind === "access" ? `${log.method} ${log.path}` : "Log entry"}</div>
            <div className="drawer-sub">{new Date(log.ts).toLocaleString()} · {log.instance}</div>
          </div>
          <button className="icon-btn" onClick={onClose}><Icons.x size={18} /></button>
        </div>
        <div className="drawer-body">
          <div className="raw-line">{logText(log)}</div>
          <div className="drawer-section">{log.kind === "access" ? "Access log fields" : "Fields"}</div>
          {Object.entries(fields).map(([k, v]) => (
            <div className="kv" key={k}><span>{k}</span><span className="mono">{String(v)}</span></div>
          ))}
          <div className="drawer-section">Loki</div>
          <div className="kv"><span>Selector</span><span className="mono">{`{job="docker", container="traefik", instance="${log.instance}"}`}</span></div>
        </div>
      </div>
    </div>
  );
}
