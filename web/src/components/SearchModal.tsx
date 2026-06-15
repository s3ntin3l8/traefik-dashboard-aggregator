import { useEffect } from "react";
import type { Snapshot } from "../lib/types";
import { statusKind } from "../lib/types";
import type { Sel } from "../lib/sel";
import { searchSnapshot } from "../lib/search";

interface Props {
  snapshot: Snapshot;
  search: string;
  onNavigate: (tab: string, sel?: Sel) => void;
  onClose: () => void;
}

export function SearchModal({ snapshot, search, onNavigate, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".search-modal-anchor")) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [onClose]);

  const groups = searchSnapshot(snapshot, search);

  return (
    <>
      <div className="search-modal">
        {groups.length === 0 && (
          <div className="search-modal-empty">No results for "{search}"</div>
        )}
        {groups.map((g) => (
          <div className="search-modal-group" key={g.label}>
            <div className="search-modal-group-label">{g.label}</div>
            {g.items.map((item) => (
              <div className="search-modal-item" key={item.id} onClick={() => onNavigate(item.tab, item.sel)}>
                <span className={`sdot s-${statusKind(item.status)}`}></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="search-modal-item-name">{item.name}</div>
                  {item.sub && <div className="search-modal-item-sub">{item.sub}</div>}
                </div>
                <span className="search-modal-item-inst">{item.instance}</span>
              </div>
            ))}
            {g.extra > 0 && (
              <div className="search-modal-more">+{g.extra} more in {g.label}</div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
