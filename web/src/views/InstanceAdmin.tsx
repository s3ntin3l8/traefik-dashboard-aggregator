// Instance admin panel: add/edit/delete Traefik instances at runtime, layered
// on top of the config.yaml/.env bootstrap (see internal/config.Merge on the
// backend). Only rendered when the signed-in user's forward-auth group
// membership matches the server's configured admin group (isAdmin prop) --
// display-only gating; the server re-checks the same header on every write
// and is the sole enforcement point (see docs/authentik.md).
import { useEffect, useState } from "react";
import { createInstance, deleteInstance, fetchInstances, updateInstance, ApiError } from "../lib/sse";
import type { InstanceWriteFields } from "../lib/sse";
import type { EditableInstance } from "../lib/types";
import { Icons } from "../components/ui";

type FormState = {
  name: string;
  role: string;
  url: string;
  host: string;
  dashboardURL: string;
  insecureSkipVerify: boolean;
};

const NEW = "__new__";
const emptyForm: FormState = { name: "", role: "", url: "", host: "", dashboardURL: "", insecureSkipVerify: false };

function toForm(inst: EditableInstance): FormState {
  return {
    name: inst.name,
    role: inst.role || "",
    url: inst.url,
    host: inst.host || "",
    dashboardURL: inst.dashboardURL || "",
    insecureSkipVerify: inst.insecureSkipVerify,
  };
}

export function InstanceAdmin() {
  const [instances, setInstances] = useState<EditableInstance[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // instance name, or NEW, or null (closed)
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetchInstances()
      .then((list) => { setInstances(list); setLoadError(null); })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "failed to load instances"));
  };

  useEffect(() => { load(); }, []);

  const startAdd = () => { setEditing(NEW); setForm(emptyForm); setSaveError(null); };
  const startEdit = (inst: EditableInstance) => { setEditing(inst.name); setForm(toForm(inst)); setSaveError(null); };
  const cancel = () => { setEditing(null); setSaveError(null); };

  const submit = async () => {
    const name = form.name.trim();
    const url = form.url.trim();
    if (!name || !url) return;
    setBusy(true);
    setSaveError(null);
    const fields: InstanceWriteFields = {
      name,
      url,
      role: form.role.trim() || undefined,
      host: form.host.trim() || undefined,
      dashboardURL: form.dashboardURL.trim() || undefined,
      insecureSkipVerify: form.insecureSkipVerify,
    };
    try {
      const updated = editing === NEW ? await createInstance(fields) : await updateInstance(editing as string, fields);
      setInstances(updated);
      setEditing(null);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (name: string) => {
    if (!window.confirm(`Remove instance "${name}"? This only removes it from traefik-viewer's polling list — nothing on the node itself is touched.`)) return;
    setBusy(true);
    setSaveError(null);
    try {
      setInstances(await deleteInstance(name));
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "delete failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title">Instances</span>
        {editing === null && (
          <button className="icon-btn" onClick={startAdd} aria-label="Add instance" title="Add instance">
            <Icons.plus size={16} />
          </button>
        )}
      </div>
      <div className="panel-body settings-body">
        {loadError && (
          <div className="stale-banner banner-danger">
            <Icons.alert size={16} /><span>{loadError}</span>
          </div>
        )}

        {instances && (
          <div className="instance-list">
            {instances.map((inst) => (
              <div key={inst.name} className="instance-row">
                <div className="instance-row-info">
                  <div className="instance-row-head">
                    <span className="cell-name">{inst.name}</span>
                    <span className={`badge ${inst.source === "file" ? "neutral" : "ok"}`}>
                      {inst.source === "file" ? "config.yaml" : "UI-managed"}
                    </span>
                    {inst.role && <span className="pill-soft">{inst.role}</span>}
                  </div>
                  <div className="instance-row-sub muted cell-mono">
                    {inst.url}{inst.host ? ` · Host: ${inst.host}` : ""}
                  </div>
                </div>
                <div className="instance-row-actions">
                  <button className="icon-btn" onClick={() => startEdit(inst)} disabled={busy} aria-label={`Edit ${inst.name}`} title="Edit">
                    <Icons.edit size={14} />
                  </button>
                  <button className="icon-btn" onClick={() => remove(inst.name)} disabled={busy} aria-label={`Delete ${inst.name}`} title="Delete">
                    <Icons.trash size={14} />
                  </button>
                </div>
              </div>
            ))}
            {instances.length === 0 && <div className="muted">No instances configured.</div>}
          </div>
        )}

        {editing !== null && (
          <div className="instance-form">
            {saveError && (
              <div className="stale-banner banner-danger">
                <Icons.alert size={16} /><span>{saveError}</span>
              </div>
            )}
            <div className="setting-row">
              <div className="setting-label"><span>Name</span></div>
              <input
                className="tv-input"
                value={form.name}
                disabled={editing !== NEW}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="node-02"
              />
            </div>
            <div className="setting-row">
              <div className="setting-label"><span>URL</span></div>
              <input
                className="tv-input"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="https://10.0.0.5"
              />
            </div>
            <div className="setting-row">
              <div className="setting-label"><span>Host</span><span className="setting-hint">Host header / SNI override</span></div>
              <input
                className="tv-input"
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                placeholder="traefik.node.example.test"
              />
            </div>
            <div className="setting-row">
              <div className="setting-label"><span>Dashboard URL</span></div>
              <input
                className="tv-input"
                value={form.dashboardURL}
                onChange={(e) => setForm((f) => ({ ...f, dashboardURL: e.target.value }))}
                placeholder="https://traefik.node.example.test/dashboard/"
              />
            </div>
            <div className="setting-row">
              <div className="setting-label"><span>Role</span></div>
              <input
                className="tv-input"
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                placeholder="node"
              />
            </div>
            <div className="setting-row">
              <div className="setting-label"><span>Insecure TLS</span><span className="setting-hint">Skip certificate verification</span></div>
              <input
                type="checkbox"
                checked={form.insecureSkipVerify}
                onChange={(e) => setForm((f) => ({ ...f, insecureSkipVerify: e.target.checked }))}
              />
            </div>
            <div className="form-actions">
              <button className="tv-btn" onClick={cancel} disabled={busy}>Cancel</button>
              <button className="tv-btn tv-btn-primary" onClick={submit} disabled={busy || !form.name.trim() || !form.url.trim()}>
                {busy ? "Saving…" : editing === NEW ? "Add instance" : "Save changes"}
              </button>
            </div>
          </div>
        )}

        {!instances && !loadError && <div className="muted">Loading…</div>}
      </div>
    </div>
  );
}
