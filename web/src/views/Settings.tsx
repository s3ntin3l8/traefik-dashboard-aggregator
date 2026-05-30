// Settings page: appearance controls (direction, theme, accent, density).
// Replaces the prototype's floating Tweaks panel.
import type { Tweaks } from "../lib/theme";
import { ACCENTS } from "../lib/theme";

export function Settings({ t, setTweak, lokiEnabled }: {
  t: Tweaks;
  setTweak: <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void;
  lokiEnabled: boolean;
}) {
  return (
    <div className="content-wide fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-desc">Appearance &amp; preferences · stored in your browser</div>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel">
          <div className="panel-head"><span className="panel-title">Appearance</span></div>
          <div className="panel-body settings-body">
            <SettingRow label="Visual style" hint="Two design directions">
              <div className="seg">
                <button className={t.dir === "a" ? "on" : ""} onClick={() => setTweak("dir", "a")}>Terminal</button>
                <button className={t.dir === "b" ? "on" : ""} onClick={() => setTweak("dir", "b")}>Console</button>
              </div>
            </SettingRow>

            <SettingRow label="Theme" hint="Light or dark">
              <div className="seg">
                <button className={t.theme === "light" ? "on" : ""} onClick={() => setTweak("theme", "light")}>Light</button>
                <button className={t.theme === "dark" ? "on" : ""} onClick={() => setTweak("theme", "dark")}>Dark</button>
              </div>
            </SettingRow>

            <SettingRow label="Density" hint="Table row height">
              <div className="seg">
                {(["compact", "regular", "comfy"] as const).map((d) => (
                  <button key={d} className={t.density === d ? "on" : ""} onClick={() => setTweak("density", d)} style={{ textTransform: "capitalize" }}>{d}</button>
                ))}
              </div>
            </SettingRow>

            <SettingRow label="Accent" hint="Highlight color">
              <div className="accent-swatches">
                {ACCENTS.map((c) => (
                  <button key={c} className={`accent-swatch ${t.accent === c ? "on" : ""}`} style={{ background: c }} onClick={() => setTweak("accent", c)} aria-label={`Accent ${c}`} />
                ))}
              </div>
            </SettingRow>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><span className="panel-title">About</span></div>
          <div className="panel-body settings-body">
            <div className="kv"><span>App</span><span>traefik-viewer</span></div>
            <div className="kv"><span>Logs (Loki)</span><span>{lokiEnabled ? "enabled" : "not configured"}</span></div>
            <div className="kv"><span>Data</span><span>live via SSE</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-label">
        <span>{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
