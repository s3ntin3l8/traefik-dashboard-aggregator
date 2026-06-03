// Animated gateway -> instances -> routers flow viz. Ported from tv-topology.jsx.
// Below 860px a vertical reflow kicks in (gateway left → nodes stacked → dots beneath each).
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import type { Snapshot } from "../lib/types";
import { Icons, statusKind, useIsMobile } from "../components/ui";
import type { Sel } from "../lib/sel";

export function Topology({ snapshot, dir, onSelect }: { snapshot: Snapshot; dir: string; onSelect: (s: Sel) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const H = 340;
  const mobile = useIsMobile();

  // useLayoutEffect measures the container synchronously before paint, eliminating
  // the first-paint flash that the original useEffect (async) caused on both desktop
  // and mobile. The ResizeObserver keeps it updated on every resize.
  useLayoutEffect(() => {
    if (wrap.current) setW(wrap.current.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width);
    });
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const model = useMemo(
    () => (mobile ? buildTopoV(snapshot, w) : buildTopo(snapshot, w, H)),
    [snapshot, w, mobile],
  );
  const height = mobile ? (model as VTopoModel).totalH : H;

  return (
    <div className="topo-wrap" ref={wrap}>
      <svg className="topo" width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
        {mobile ? (
          <>
            <VTopoEdges model={model as VTopoModel} />
            <VTopoNodes model={model as VTopoModel} onSelect={onSelect} />
            <FlowPackets model={model as VTopoModel} vertical />
          </>
        ) : (
          <>
            <TopoEdges model={model as TopoModel} />
            <TopoNodes model={model as TopoModel} onSelect={onSelect} />
            <FlowPackets model={model as TopoModel} dir={dir} />
          </>
        )}
      </svg>
      <div className="topo-cap">
        <div className="topo-leg"><span style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", background: "var(--ok)", boxShadow: "0 0 6px var(--ok)" }}></span> live packet</div>
        <div className="topo-leg"><span className="gw-circle" style={{ width: 10, height: 10, borderRadius: "50%", display: "inline-block", border: "1.6px solid var(--accent)" }}></span> gateway</div>
        <div className="topo-leg"><span className="sdot s-ok"></span> healthy node</div>
        <div className="topo-leg"><span style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", background: "var(--ok)" }}></span> healthy route</div>
      </div>
    </div>
  );
}

// ======= DESKTOP: horizontal flow (gateway left → nodes center → dot grid right) =======

type TopoModel = ReturnType<typeof buildTopo>;

function buildTopo(snapshot: Snapshot, W: number, H: number) {
  const cx = 60;
  const cyc = H / 2;
  const instX = W * 0.42;
  const routerX = W - 80;

  // Split off the designated gateway (role==="gateway"); the rest are the
  // downstream nodes that fan out from the hub. If none is designated, the hub
  // stays a generic decorative node and all instances become downstream nodes.
  const gw = (snapshot.instances || []).find((i) => i.role === "gateway");
  const insts = (snapshot.instances || []).filter((i) => i.role !== "gateway");

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
    routerCount: 0,
  }));

  // Router constellation: a wide dot grid to the right of each node, vertically
  // centered on the node. More columns keep tall instances (e.g. 71 routers) short;
  // the grid is shifted right of the node labels and uses wider horizontal spacing.
  const gridCols = 12;
  const dotGapX = 18;
  const dotGapY = 13;
  const dotX0 = Math.min(instX + 110, routerX - (gridCols - 1) * dotGapX);
  const routerDots: any[] = [];
  instNodes.forEach((node) => {
    const rs = (snapshot.httpRouters || []).filter((r) => r.instance === node.name);
    node.routerCount = rs.length;
    const rows = Math.ceil(rs.length / gridCols);
    rs.forEach((r, ri) => {
      routerDots.push({
        ...r,
        x: dotX0 + (ri % gridCols) * dotGapX,
        y: node.y - ((rows - 1) * dotGapY) / 2 + Math.floor(ri / gridCols) * dotGapY,
        node,
        k: statusKind(r.status),
      });
    });
  });
  return { gateway, instNodes, routerDots, dotX0, gridCols, dotGapX, dotGapY };
}

function TopoEdges({ model }: { model: TopoModel }) {
  const { gateway, instNodes, dotX0 } = model;
  return (
    <g className="topo-edges">
      {instNodes.map((n) => (
        <path key={"ge" + n.name} className={`edge e-${n.k}`} d={`M${gateway.x},${gateway.y} C${(gateway.x + n.x) / 2},${gateway.y} ${(gateway.x + n.x) / 2},${n.y} ${n.x},${n.y}`} />
      ))}
      {instNodes.filter((n) => n.routerCount > 0).map((n) => (
        <path key={"conn" + n.name} d={`M${n.x + 14},${n.y} H${dotX0 - 8}`} fill="none" stroke={`var(--${n.k})`} strokeWidth="1" strokeOpacity="0.4" strokeDasharray="2 3" />
      ))}
    </g>
  );
}

function TopoNodes({ model, onSelect }: { model: TopoModel; onSelect: (s: Sel) => void }) {
  const { gateway, instNodes, routerDots, dotX0, gridCols, dotGapX, dotGapY } = model;
  return (
    <g>
      <g
        className="topo-node gw"
        transform={`translate(${gateway.x},${gateway.y})`}
        onClick={() => gateway.inst && onSelect({ kind: "instance", data: gateway.inst })}
        style={{ cursor: gateway.inst ? "pointer" : "default" }}
      >
        <circle r="22" className={`gw-circle nc-${gateway.k}`} />
        <text className="gw-label" y="38" textAnchor="middle" style={{ fontWeight: 600 }}>{gateway.label}</text>
        {gateway.inst && <text className="gw-label faint" y="49" textAnchor="middle" style={{ fontSize: 9 }}>{gateway.inst.ip}</text>}
        <g transform="translate(-9,-9)"><Icons.globe size={18} /></g>
      </g>
      {instNodes.map((n) => (
        <g key={n.name} className="topo-node" transform={`translate(${n.x},${n.y})`} onClick={() => onSelect({ kind: "instance", data: n })} style={{ cursor: "pointer" }}>
          <circle r="13" className={`node-circle nc-${n.k}`} />
          <g transform="translate(-6.5,-6.5)" style={{ color: `var(--${n.k})` }}><Icons.server size={13} /></g>
          <text className="node-label" x="22" y="-1" style={{ fontWeight: 600 }}>{n.name}</text>
          <text className="node-label faint" x="22" y="11" style={{ fontSize: 9 }}>{n.ip}</text>
        </g>
      ))}
      {instNodes.filter((n) => n.routerCount > 0).map((n) => {
        const rows = Math.ceil(n.routerCount / gridCols);
        return (
          <text key={"rc" + n.name} className="node-label" fill="var(--text-faint)"
            x={dotX0 + ((Math.min(n.routerCount, gridCols) - 1) * dotGapX) / 2}
            y={n.y + ((rows - 1) * dotGapY) / 2 + 18} textAnchor="middle" style={{ fontSize: 9 }}>
            {n.routerCount} routers
          </text>
        );
      })}
      {routerDots.map((r, i) => (
        <circle key={i} className={`rdot rdot-${r.k}`} cx={r.x} cy={r.y} r="3.5" onClick={() => onSelect({ kind: "router", data: r })}>
          <title>{r.name}</title>
        </circle>
      ))}
    </g>
  );
}

// ======= MOBILE: vertical flow (gateway left-edge → nodes stacked → dots beneath each) =======

type VTopoModel = ReturnType<typeof buildTopoV>;

function buildTopoV(snapshot: Snapshot, W: number) {
  const gw = (snapshot.instances || []).find((i) => i.role === "gateway");
  const insts = (snapshot.instances || []).filter((i) => i.role !== "gateway");

  const gx = 22, gy = 34;   // gateway at the far left, left of the node column
  const nodeX = 46;          // node circles, shifted right of the gateway/trunk
  const gateway = { x: gx, y: gy, label: gw ? gw.name : "gateway", inst: gw || null, k: gw ? statusKind(gw.status) : "ok" };

  const dotX0 = 72;          // labels + router dots, right of the node circles
  const nodeLabelX = dotX0 - nodeX;  // node label offset → content column at abs dotX0
  const dotGapX = 16, dotGapY = 14;
  const cols = Math.max(6, Math.floor((W - dotX0 - 12) / dotGapX));
  const headerGap = 64;      // gap from gateway down to the first node
  const labelH = 34;         // node marker + 2 label lines
  const sectionPad = 24;     // breathing room below each node's dots

  let y = gy + headerGap;
  const instNodes = insts.map((inst) => {
    const rs = (snapshot.httpRouters || []).filter((r) => r.instance === inst.name);
    const rows = Math.max(1, Math.ceil(rs.length / cols));
    const nodeY = y;
    const dotsY0 = nodeY + labelH;
    const dots = rs.map((r, ri) => ({
      ...r,
      x: dotX0 + (ri % cols) * dotGapX,
      y: dotsY0 + Math.floor(ri / cols) * dotGapY,
      k: statusKind(r.status),
    }));
    const node = { ...inst, x: nodeX, y: nodeY, k: statusKind(inst.status), routerCount: rs.length, dots, rows, dotsY0 };
    y += labelH + rows * dotGapY + sectionPad;
    return node;
  });
  const routerDots = instNodes.flatMap((n) => n.dots.map((d: any) => ({ ...d, node: n })));
  return { gateway, instNodes, routerDots, dotX0, nodeLabelX, cols, dotGapX, dotGapY, totalH: y + 6 };
}

function VTopoEdges({ model }: { model: VTopoModel }) {
  const { gateway: g, instNodes } = model;
  return (
    <g className="topo-edges">
      {instNodes.map((n) => (
        // trunk descends at the gateway's x (clear channel), then hooks right into the node
        <path key={"ge" + n.name} className={`edge e-${n.k}`} d={`M${g.x},${g.y} C${g.x},${n.y} ${g.x},${n.y} ${n.x},${n.y}`} />
      ))}
    </g>
  );
}

function VTopoNodes({ model, onSelect }: { model: VTopoModel; onSelect: (s: Sel) => void }) {
  const { gateway: g, instNodes, routerDots, nodeLabelX } = model;
  // match the node's icon-to-text gap (node r13 → label at nodeLabelX; gateway r16 → +3)
  const gwLabelX = nodeLabelX + 3;
  return (
    <g>
      <g
        className="topo-node gw"
        transform={`translate(${g.x},${g.y})`}
        onClick={() => g.inst && onSelect({ kind: "instance", data: g.inst })}
        style={{ cursor: g.inst ? "pointer" : "default" }}
      >
        <circle r="16" className={`gw-circle nc-${g.k}`} />
        <g transform="translate(-8,-8)"><Icons.globe size={16} /></g>
        <text className="gw-label" x={gwLabelX} y="-2" textAnchor="start" style={{ fontWeight: 600, fontSize: 12 }}>{g.label}</text>
        <text className="gw-label faint" x={gwLabelX} y="11" textAnchor="start" style={{ fontSize: 10 }}>gateway{g.inst ? ` · ${g.inst.ip}` : ""}</text>
      </g>
      {instNodes.map((n) => (
        <g key={n.name} className="topo-node" transform={`translate(${n.x},${n.y})`} onClick={() => onSelect({ kind: "instance", data: n })} style={{ cursor: "pointer" }}>
          <circle r="13" className={`node-circle nc-${n.k}`} />
          <g transform="translate(-6.5,-6.5)" style={{ color: `var(--${n.k})` }}><Icons.server size={13} /></g>
          <text className="node-label" x={nodeLabelX} y="-2" style={{ fontWeight: 600, fontSize: 12 }}>{n.name}</text>
          <text className="node-label faint" x={nodeLabelX} y="11" style={{ fontSize: 10 }}>{n.routerCount} routers · {n.ip}</text>
        </g>
      ))}
      {routerDots.map((r: any, i: number) => (
        <circle key={i} className={`rdot rdot-${r.k}`} cx={r.x} cy={r.y} r="4" onClick={() => onSelect({ kind: "router", data: r })}>
          <title>{r.name}</title>
        </circle>
      ))}
    </g>
  );
}

// ======= SHARED: animated flow packets =======

function FlowPackets({ model, vertical, dir: _dir }: { model: TopoModel | VTopoModel; vertical?: boolean; dir?: string }) {
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
        let x: number, y: number;
        if (vertical) {
          // match VTopoEdges exactly: M(g) C(g.x,n.y)(g.x,n.y)(n.x,n.y)
          x = cubic(gateway.x, gateway.x, gateway.x, n.x, t);
          y = cubic(gateway.y, n.y, n.y, n.y, t);
        } else {
          const mx = (gateway.x + n.x) / 2;
          x = cubic(gateway.x, mx, mx, n.x, t);
          y = cubic(gateway.y, gateway.y, n.y, n.y, t);
        }
        return <circle key={p.id} className={`packet p-${n.k}`} cx={x} cy={y} r="2.6" />;
      })}
    </g>
  );
}

function cubic(a: number, b: number, c: number, d: number, t: number) {
  const mt = 1 - t;
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d;
}
