// Animated gateway -> instances -> routers flow viz. Ported from tv-topology.jsx.
// Below 860px a vertical reflow kicks in (gateway left → nodes stacked → dots beneath each).
import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import type { Snapshot } from "../lib/types";
import { Icons, statusKind, useIsMobile } from "../components/ui";
import type { Sel } from "../lib/sel";
import { externalRoutesFor } from "../lib/topo";

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
  const height = mobile ? (model as VTopoModel).totalH : (model as TopoModel).height;

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
            <TopoEdges model={model as TopoModel} height={height} />
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
        <div className="topo-leg"><span style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block", background: "var(--warn)" }}></span> external route (via ingress)</div>
      </div>
    </div>
  );
}

// ======= DESKTOP: horizontal flow (gateway left → nodes center → dot grid right) =======

type TopoModel = ReturnType<typeof buildTopo>;

// An external group box: per-source dashed rectangle listing that source's external routes.
interface ExtBox {
  sourceLabel: string;
  rows: { router: any; ip: string; k: string }[];
  x: number;
  y: number;
  w: number;
  h: number;
}

function buildTopo(snapshot: Snapshot, W: number, H: number) {
  const cx = 60;
  const cyc = H / 2;
  const instX = W * 0.42;

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
  // centered on the node. More columns keep tall instances (e.g. 71 routers) short.
  const gridCols = 12;
  const dotGapX = 18;
  const dotGapY = 13;
  // Right gutter is reserved for the external boxes; keep the grid well left of it.
  const boxW = 148; // reserved column width for external boxes
  const dotX0 = Math.min(instX + 110, W - boxW - 16 - (gridCols - 1) * dotGapX);

  const routerDots: any[] = [];

  instNodes.forEach((node) => {
    const instIP = node.ip || "";
    const allRouters = (snapshot.httpRouters || []).filter((r) => r.instance === node.name);

    // Internal routers: all routers that have no external backends.
    const extRoutes = externalRoutesFor(snapshot, node.name, instIP);
    const extRouterIds = new Set(extRoutes.map((e) => e.router.id));
    const internal = allRouters.filter((r) => !extRouterIds.has(r.id));

    node.routerCount = internal.length;

    const rows = Math.ceil(internal.length / gridCols);
    internal.forEach((r, ri) => {
      routerDots.push({
        ...r,
        x: dotX0 + (ri % gridCols) * dotGapX,
        y: node.y - ((rows - 1) * dotGapY) / 2 + Math.floor(ri / gridCols) * dotGapY,
        node,
        k: statusKind(r.status),
      });
    });
  });

  // ---- External boxes: one per source (downstream nodes first, gateway last) ----
  // Each box lists the external routes for that source, stacked top-to-bottom in the
  // right gutter. The bottom rail runs from the gateway down and right to this region.
  const rowH = 16;        // height per IP row inside a box
  const titleH = 18;      // height of the box title row
  const boxPad = 6;       // vertical padding inside the box (top + bottom)
  const boxGap = 8;       // vertical gap between boxes
  const boxX = W - boxW - 4; // left edge of all boxes (right-anchored)

  // Collect per-source external route lists (node order then gateway).
  const sources: { label: string; routes: ReturnType<typeof externalRoutesFor> }[] = [];
  instNodes.forEach((node) => {
    const routes = externalRoutesFor(snapshot, node.name, node.ip || "");
    if (routes.length > 0) sources.push({ label: node.name + " → external", routes });
  });
  if (gw) {
    const gwRoutes = externalRoutesFor(snapshot, gw.name, gw.ip || "");
    if (gwRoutes.length > 0) sources.push({ label: "gateway → external", routes: gwRoutes });
  }

  const boxes: ExtBox[] = [];
  let boxTop = 12; // starting y for the first box
  sources.forEach(({ label, routes }) => {
    const h = titleH + routes.length * rowH + boxPad;
    boxes.push({
      sourceLabel: label,
      rows: routes.map(({ router, ips }) => ({
        router,
        ip: ips[0],
        k: statusKind(router.status),
      })),
      x: boxX,
      y: boxTop,
      w: boxW,
      h,
    });
    boxTop += h + boxGap;
  });

  const boxStackBottom = boxTop - boxGap + 12;
  const height = Math.max(H, boxStackBottom);

  return { gateway, instNodes, routerDots, boxes, dotX0, gridCols, dotGapX, dotGapY, height };
}

function TopoEdges({ model, height }: { model: TopoModel; height: number }) {
  const { gateway, instNodes, dotX0, boxes } = model;
  // Bottom rail: drops from gateway (starting below its name/ip labels at ~y+52),
  // runs along the bottom edge, then rises to the LAST (bottommost) box.
  // The last box is the gateway's own external box when present, matching the ASCII viz.
  const railStartY = gateway.y + 56;  // clear of gw circle (r22) + two label lines (~y+49)
  const railY = height - 14;
  const lastBox = boxes[boxes.length - 1];
  const railTargetX = lastBox ? lastBox.x - 4 : 0;
  const railTargetY = lastBox ? lastBox.y + lastBox.h / 2 : railY;
  return (
    <g className="topo-edges">
      {instNodes.map((n) => (
        <path key={"ge" + n.name} className={`edge e-${n.k}`} d={`M${gateway.x},${gateway.y} C${(gateway.x + n.x) / 2},${gateway.y} ${(gateway.x + n.x) / 2},${n.y} ${n.x},${n.y}`} />
      ))}
      {instNodes.filter((n) => n.routerCount > 0).map((n) => (
        <path key={"conn" + n.name} d={`M${n.x + 14},${n.y} H${dotX0 - 8}`} fill="none" stroke={`var(--${n.k})`} strokeWidth="1" strokeOpacity="0.4" strokeDasharray="2 3" />
      ))}
      {boxes.length > 0 && (
        <path
          d={`M${gateway.x},${railStartY} V${railY} H${railTargetX} V${railTargetY}`}
          fill="none" stroke="var(--warn)" strokeWidth="1.2" strokeOpacity="0.45"
          strokeDasharray="5 3" strokeLinejoin="round"
        />
      )}
    </g>
  );
}

function TopoNodes({ model, onSelect }: { model: TopoModel; onSelect: (s: Sel) => void }) {
  const { gateway, instNodes, routerDots, boxes, dotX0, gridCols, dotGapX, dotGapY } = model;
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
      {/* Per-source dashed external group boxes */}
      {boxes.map((box, bi) => {
        const dotX = box.x + 10;
        const labelX = box.x + 22;
        const rowH = 16;
        const titleH = 18;
        const rowY0 = box.y + titleH + 2;
        return (
          <g key={"extbox" + bi}>
            <rect className="ext-box" x={box.x} y={box.y} width={box.w} height={box.h} rx="5" />
            <text className="ext-box-title" x={box.x + 6} y={box.y + 12}>{box.sourceLabel}</text>
            {box.rows.map((row, ri) => (
              <g key={"extrow" + ri} className="rdot" onClick={() => onSelect({ kind: "router", data: row.router })} style={{ cursor: "pointer" }}>
                <circle cx={dotX} cy={rowY0 + ri * rowH} r="3.5" className={`rdot-ext rdot-${row.k}`} />
                <text x={labelX} y={rowY0 + ri * rowH + 3.5} className="ext-dot-label">{row.ip}</text>
                <title>{row.router.shortName} → {row.ip}</title>
              </g>
            ))}
          </g>
        );
      })}
    </g>
  );
}

// ======= MOBILE: vertical flow (gateway left-edge → nodes stacked → dots beneath each) =======

type VTopoModel = ReturnType<typeof buildTopoV>;

// Mobile external group box (same structure as desktop ExtBox but placed inline).
interface VExtBox {
  sourceLabel: string;
  rows: { router: any; ip: string; k: string }[];
  x: number;
  y: number;
  w: number;
  h: number;
}

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
  // Box sizing constants (mobile external boxes)
  const boxRowH = 16, boxTitleH = 18, boxPad = 6, boxMarginTop = 6;
  const boxX = dotX0, boxW = Math.min(W - dotX0 - 8, 148);

  // Gateway external box — rendered above the node list, just below the gw header.
  let y = gy + headerGap;
  const gwExtRoutes = gw ? externalRoutesFor(snapshot, gw.name, gw.ip || "") : [];
  let gwExtBox: VExtBox | null = null;
  if (gwExtRoutes.length > 0) {
    const boxH = boxTitleH + gwExtRoutes.length * boxRowH + boxPad;
    gwExtBox = {
      sourceLabel: "gateway → external",
      rows: gwExtRoutes.map(({ router, ips }) => ({ router, ip: ips[0], k: statusKind(router.status) })),
      x: boxX, y, w: boxW, h: boxH,
    };
    y += boxH + boxMarginTop;
  }

  const instNodes = insts.map((inst) => {
    const instIP = inst.ip || "";
    const extRoutes = externalRoutesFor(snapshot, inst.name, instIP);
    const extRouterIds = new Set(extRoutes.map((e) => e.router.id));
    const allRouters = (snapshot.httpRouters || []).filter((r) => r.instance === inst.name);
    const internal = allRouters.filter((r) => !extRouterIds.has(r.id));

    const rows = Math.max(1, Math.ceil(internal.length / cols));
    const nodeY = y;
    const dotsY0 = nodeY + labelH;
    const dots = internal.map((r, ri) => ({
      ...r,
      x: dotX0 + (ri % cols) * dotGapX,
      y: dotsY0 + Math.floor(ri / cols) * dotGapY,
      k: statusKind(r.status),
    }));

    // Per-source dashed box for this node's external routes.
    let extBox: VExtBox | null = null;
    if (extRoutes.length > 0) {
      const extY0 = dotsY0 + rows * dotGapY + boxMarginTop;
      const boxH = boxTitleH + extRoutes.length * boxRowH + boxPad;
      extBox = {
        sourceLabel: inst.name + " → external",
        rows: extRoutes.map(({ router, ips }) => ({ router, ip: ips[0], k: statusKind(router.status) })),
        x: boxX, y: extY0, w: boxW, h: boxH,
      };
    }

    const node = {
      ...inst,
      x: nodeX,
      y: nodeY,
      k: statusKind(inst.status),
      routerCount: internal.length,
      dots,
      extBox,
      rows,
      dotsY0,
    };
    // Advance cursor: internal grid + optional external box.
    y += labelH + rows * dotGapY + (extBox ? boxMarginTop + extBox.h : 0) + sectionPad;
    return node;
  });

  const routerDots = instNodes.flatMap((n) => n.dots.map((d: any) => ({ ...d, node: n })));
  return { gateway, instNodes, routerDots, gwExtBox, dotX0, nodeLabelX, cols, dotGapX, dotGapY, totalH: y + 6 };
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
  const { gateway: g, instNodes, routerDots, gwExtBox, nodeLabelX } = model;
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
      {/* Gateway's own external box, if any, sits between the gw header and first node */}
      {gwExtBox && <VExtBoxGroup box={gwExtBox} onSelect={onSelect} />}
      {instNodes.map((n) => (
        <g key={n.name}>
          <g className="topo-node" transform={`translate(${n.x},${n.y})`} onClick={() => onSelect({ kind: "instance", data: n })} style={{ cursor: "pointer" }}>
            <circle r="13" className={`node-circle nc-${n.k}`} />
            <g transform="translate(-6.5,-6.5)" style={{ color: `var(--${n.k})` }}><Icons.server size={13} /></g>
            <text className="node-label" x={nodeLabelX} y="-2" style={{ fontWeight: 600, fontSize: 12 }}>{n.name}</text>
            <text className="node-label faint" x={nodeLabelX} y="11" style={{ fontSize: 10 }}>{n.routerCount} routers · {n.ip}</text>
          </g>
          {n.extBox && <VExtBoxGroup box={n.extBox} onSelect={onSelect} />}
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

/** Shared renderer for a per-source external box (mobile). */
function VExtBoxGroup({ box, onSelect }: { box: { sourceLabel: string; rows: { router: any; ip: string; k: string }[]; x: number; y: number; w: number; h: number }; onSelect: (s: Sel) => void }) {
  const dotX = box.x + 10;
  const labelX = box.x + 22;
  const titleH = 18;
  const rowH = 16;
  const rowY0 = box.y + titleH + 2;
  return (
    <g>
      <rect className="ext-box" x={box.x} y={box.y} width={box.w} height={box.h} rx="5" />
      <text className="ext-box-title" x={box.x + 6} y={box.y + 12}>{box.sourceLabel}</text>
      {box.rows.map((row, ri) => (
        <g key={"vextrow" + ri} className="rdot" onClick={() => onSelect({ kind: "router", data: row.router })} style={{ cursor: "pointer" }}>
          <circle cx={dotX} cy={rowY0 + ri * rowH} r="4" className={`rdot-ext rdot-${row.k}`} />
          <text x={labelX} y={rowY0 + ri * rowH + 3.5} className="ext-dot-label">{row.ip}</text>
          <title>{row.router.shortName} → {row.ip}</title>
        </g>
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
