// Animated gateway -> instances -> routers flow viz. Ported from tv-topology.jsx.
import { useState, useEffect, useRef, useMemo } from "react";
import type { Snapshot } from "../lib/types";
import { Icons, statusKind } from "../components/ui";
import type { Sel } from "../lib/sel";

export function Topology({ snapshot, dir, onSelect }: { snapshot: Snapshot; dir: string; onSelect: (s: Sel) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const H = 340;
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width);
    });
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(() => buildTopo(snapshot, w, H), [snapshot, w]);

  return (
    <div className="panel topo-panel" ref={wrap}>
      <div className="panel-head">
        <h3>Live topology</h3>
        <span className="muted">{model.gateway.label} → {model.instNodes.length} nodes → {model.routerDots.length} routes</span>
      </div>
      <svg className="topo" width={w} height={H} viewBox={`0 0 ${w} ${H}`}>
        <TopoEdges model={model} />
        <TopoNodes model={model} onSelect={onSelect} />
        <FlowPackets model={model} dir={dir} />
      </svg>
      <div className="topo-cap">
        <div className="topo-leg"><span className="packet p-ok" style={{ position: "relative", top: 0, left: 0, width: 6, height: 6, borderRadius: "50%", display: "inline-block" }}></span> live packet</div>
        <div className="topo-leg"><span className="gw-circle" style={{ width: 10, height: 10, borderRadius: "50%", display: "inline-block", border: "1.6px solid var(--accent)" }}></span> gateway</div>
        <div className="topo-leg"><span className="sdot s-ok"></span> healthy node</div>
        <div className="topo-leg"><span className="rdot-ok" style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block" }}></span> healthy route</div>
      </div>
    </div>
  );
}

type TopoModel = ReturnType<typeof buildTopo>;

function buildTopo(snapshot: Snapshot, W: number, H: number) {
  const cx = 60;
  const cyc = H / 2;
  const instX = W * 0.42;
  const routerX = W - 80;

  // Split off the designated gateway (role==="gateway"); the rest are the
  // downstream nodes that fan out from the hub. If none is designated, the hub
  // stays a generic decorative node and all instances become downstream nodes.
  const gw = snapshot.instances.find((i) => i.role === "gateway");
  const insts = snapshot.instances.filter((i) => i.role !== "gateway");

  const gateway = {
    x: cx,
    y: cyc,
    label: gw ? gw.name : "gateway",
    inst: gw || null,
    k: gw ? statusKind(gw.status) : "ok",
  };

  const instGap = Math.min(90, (H - 40) / Math.max(insts.length, 1));
  const instY0 = cyc - ((insts.length - 1) * instGap) / 2;
  const instNodes = insts.map((inst, i) => ({
    ...inst,
    x: instX,
    y: instY0 + i * instGap,
    k: statusKind(inst.status),
  }));
  const routerDots: any[] = [];
  insts.forEach((inst, ii) => {
    const rs = snapshot.httpRouters.filter((r) => r.instance === inst.name);
    const node = instNodes[ii];
    const n = rs.length;
    const spread = Math.min(80, n * 6);
    rs.forEach((r, ri) => {
      const t = n <= 1 ? 0.5 : ri / (n - 1);
      routerDots.push({
        ...r,
        x: routerX - (ri % 4) * 10,
        y: node.y - spread / 2 + t * spread,
        node,
        k: statusKind(r.status),
      });
    });
  });
  return { gateway, instNodes, routerDots };
}

function TopoEdges({ model }: { model: TopoModel }) {
  const { gateway, instNodes, routerDots } = model;
  return (
    <g className="topo-edges">
      {instNodes.map((n) => (
        <path key={"ge" + n.name} className={`edge e-${n.k}`} d={`M${gateway.x},${gateway.y} C${(gateway.x + n.x) / 2},${gateway.y} ${(gateway.x + n.x) / 2},${n.y} ${n.x},${n.y}`} />
      ))}
      {routerDots.map((r, i) => (
        <path key={"re" + i} className={`edge-thin e-${r.k}`} d={`M${r.node.x},${r.node.y} L${r.x},${r.y}`} />
      ))}
    </g>
  );
}

function TopoNodes({ model, onSelect }: { model: TopoModel; onSelect: (s: Sel) => void }) {
  const { gateway, instNodes, routerDots } = model;
  return (
    <g>
      <g
        className="topo-node gw"
        transform={`translate(${gateway.x},${gateway.y})`}
        onClick={() => gateway.inst && onSelect({ kind: "instance", data: gateway.inst })}
        style={{ cursor: gateway.inst ? "pointer" : "default" }}
      >
        <circle r="22" className={`gw-circle nc-${gateway.k}`} />
        <text className="gw-label" y="38">{gateway.label}</text>
        <g transform="translate(-9,-9)"><Icons.globe size={18} /></g>
      </g>
      {instNodes.map((n) => (
        <g key={n.name} className="topo-node" transform={`translate(${n.x},${n.y})`} onClick={() => onSelect({ kind: "instance", data: n })} style={{ cursor: "pointer" }}>
          <circle r="13" className={`node-circle nc-${n.k}`} />
          <text className="node-label" x="22" y="-1" style={{ fontWeight: 600 }}>{n.name}</text>
          <text className="node-label faint" x="22" y="11" style={{ fontSize: 9 }}>{n.ip}</text>
        </g>
      ))}
      {routerDots.map((r, i) => (
        <circle key={i} className={`rdot rdot-${r.k}`} cx={r.x} cy={r.y} r="3.5" onClick={() => onSelect({ kind: "router", data: r })}>
          <title>{r.name}</title>
        </circle>
      ))}
    </g>
  );
}

function FlowPackets({ model }: { model: TopoModel; dir: string }) {
  const [, force] = useState(0);
  const packets = useRef<{ t: number; node: any; id: number }[]>([]);
  const raf = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    const tick = (ts: number) => {
      if (!last.current) last.current = ts;
      const dt = ts - last.current;
      last.current = ts;
      if (Math.random() < dt / 600) {
        const n = model.instNodes[Math.floor(Math.random() * model.instNodes.length)];
        if (n) packets.current.push({ t: 0, node: n, id: Math.random() });
      }
      packets.current = packets.current.filter((p) => p.t < 1);
      packets.current.forEach((p) => (p.t += dt / 1400));
      force((x) => x + 1);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [model]);

  const { gateway } = model;
  return (
    <g className="flow">
      {packets.current.map((p) => {
        const t = p.t;
        const n = p.node;
        const mx = (gateway.x + n.x) / 2;
        const x = cubic(gateway.x, mx, mx, n.x, t);
        const y = cubic(gateway.y, gateway.y, n.y, n.y, t);
        return <circle key={p.id} className={`packet p-${n.k}`} cx={x} cy={y} r="2.6" />;
      })}
    </g>
  );
}

function cubic(a: number, b: number, c: number, d: number, t: number) {
  const mt = 1 - t;
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}
