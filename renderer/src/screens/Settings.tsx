import { useEffect, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, Key } from "lucide-react";
import { useStore } from "../store";

export function Settings() {
  const settings = useStore((s) => s.settings);
  const refreshSettings = useStore((s) => s.refreshSettings);

  const [key, setKey] = useState("");
  const [model, setModel] = useState("claude-opus-4-7");
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings) {
      setKey(settings.anthropicApiKey ?? "");
      setModel(settings.model);
    }
  }, [settings]);

  const save = async () => {
    await window.app.setSettings({ anthropicApiKey: key || null, model });
    await refreshSettings();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="h1">Settings</h1>
        <p className="mt-2 text-ink-300">
          The coaching guide and workouts are produced by Claude. Add your Anthropic API key
          to enable generation.
        </p>
      </div>

      <div className="card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Key size={16} className="text-accent-400" />
          <div className="h3 m-0">Anthropic API key</div>
        </div>
        <div className="relative">
          <input
            className="input pr-10 font-mono"
            type={show ? "text" : "password"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-ant-..."
          />
          <button
            onClick={() => setShow((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-100"
            type="button"
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <div className="text-xs text-ink-400">
          Stored encrypted on your device only.{" "}
          <button
            className="text-accent-400 hover:text-accent-300 inline-flex items-center gap-1"
            onClick={() => window.app.openExternal("https://console.anthropic.com/settings/keys")}
          >
            Get an API key <ExternalLink size={10} />
          </button>
        </div>

        <div>
          <div className="label mb-2">Model</div>
          <select
            className="input"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="claude-opus-4-7">Claude Opus 4.7 (best reasoning)</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6 (balanced)</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 (fast)</option>
          </select>
        </div>

        <div className="flex items-center justify-end gap-3 pt-2">
          {saved && (
            <div className="text-xs text-ok flex items-center gap-1">
              <Check size={12} /> Saved
            </div>
          )}
          <button className="btn-primary" onClick={save}>
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}
