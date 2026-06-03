// SearchField — shared search input + clear button + SearchModal.
// Used in both the desktop topbar and the mobile bottom bar so both stay in sync.
import type { Ref } from "react";
import type { Snapshot } from "../lib/types";
import { Icons } from "./ui";
import { SearchModal } from "./SearchModal";
import type { Sel } from "../lib/sel";

export function SearchField({
  search,
  setSearch,
  snapshot,
  tab,
  modalVisible,
  setModalVisible,
  onNavigate,
  onClose,
  anchorClassName = "",
  inputRef,
  placeholder = "Search routers, services, hosts, middlewares…",
}: {
  search: string;
  setSearch: (s: string) => void;
  snapshot: Snapshot;
  tab: string;
  modalVisible: boolean;
  setModalVisible: (v: boolean) => void;
  onNavigate: (tab: string, sel?: Sel) => void;
  onClose: () => void;
  anchorClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
}) {
  const q = search.trim().toLowerCase();
  return (
    <div className={`search-modal-anchor${anchorClassName ? " " + anchorClassName : ""}`}>
      <div className="search">
        <Icons.search size={16} />
        <input
          ref={inputRef}
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search ? (
          <button
            className="search-clear"
            onClick={() => {
              setSearch("");
              if (inputRef && typeof inputRef === "object" && "current" in inputRef) {
                (inputRef as { current: HTMLInputElement | null }).current?.focus();
              }
            }}
          >
            ×
          </button>
        ) : (
          <span className="kbd">/</span>
        )}
      </div>
      {tab === "overview" && q.length > 0 && modalVisible && (
        <SearchModal
          snapshot={snapshot}
          search={q}
          onNavigate={onNavigate}
          onClose={onClose}
        />
      )}
    </div>
  );
}
