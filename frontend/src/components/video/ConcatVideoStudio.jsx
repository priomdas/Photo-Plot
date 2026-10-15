import React, { useEffect, useState } from "react";
import * as api from "../../api";
import { Icon } from "../Icon";

export function ConcatVideoStudio({ notify }) {
  const [engine, setEngine] = useState(null);
  const [projectPath, setProjectPath] = useState("");
  const [projectName, setProjectName] = useState("PhotoPilot Video");
  const [catalogue, setCatalogue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fileInputKey, setFileInputKey] = useState(0);

  useEffect(() => {
    api.getConcatEngineStatus().then(setEngine).catch((error) => {
      setEngine({ available: false, message: error.message });
    });
  }, []);

  const run = async (method, params, successMessage) => {
    setBusy(true);
    try {
      const result = await api.callConcatEngine(method, params);
      if (successMessage) notify(successMessage, "success");
      return result;
    } catch (error) {
      notify(error.message, "error");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const createProject = async () => {
    const result = await run("project.create", {
      location: engine?.projects_root || "",
      name: projectName.trim() || "PhotoPilot Video",
    }, "Video project created");
    if (result?.project?.path) setProjectPath(result.project.path);
  };

  const importClip = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !projectPath) {
      notify("Create or open a project before importing a clip", "error");
      return;
    }
    setBusy(true);
    try {
      const uploaded = await api.uploadVideoClip(file);
      await api.callConcatEngine("media.import", {
        path: projectPath,
        file: uploaded.path,
      });
      notify("Clip imported into the Concat project", "success");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
      setFileInputKey((key) => key + 1);
    }
  };

  const loadCatalogue = async () => {
    const result = await run("catalogue.list", { kind: "effect" });
    if (Array.isArray(result)) setCatalogue(result);
    else if (Array.isArray(result?.items)) setCatalogue(result.items);
  };

  return (
    <main className="concat-studio">
      <section className="concat-studio__hero">
        <div>
          <span className="concat-studio__eyebrow"><Icon name="film" size={14} /> Concat engine</span>
          <h2>Professional video workspace</h2>
          <p>Timeline editing, transitions, effects, audio and export powered by the local Rust engine.</p>
        </div>
        <span className={`concat-studio__status ${engine?.available ? "is-ready" : "is-missing"}`}>
          {engine?.available ? "Engine ready" : "Engine not built"}
        </span>
      </section>

      {!engine?.available && (
        <section className="concat-studio__notice">
          <strong>Build the Concat engine to enable video editing.</strong>
          <code>cargo build --release -p concat-cli</code>
          <span>{engine?.message || "Checking engine..."}</span>
        </section>
      )}

      <section className="concat-studio__card">
        <div className="concat-studio__card-head">
          <div><h3>Project</h3><span>{projectPath || "No project open"}</span></div>
          <button className="btn btn--ghost btn--sm" onClick={loadCatalogue} disabled={!engine?.available || busy}>
            <Icon name="sparkle" size={14} /> Load effects
          </button>
        </div>
        <div className="concat-studio__controls">
          <input className="input" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Project name" />
          <button className="btn btn--primary" onClick={createProject} disabled={!engine?.available || busy}>Create project</button>
          <label className="btn btn--secondary">
            Import video
            <input key={fileInputKey} type="file" accept="video/*" hidden onChange={importClip} disabled={!engine?.available || busy} />
          </label>
        </div>
      </section>

      <section className="concat-studio__card concat-studio__empty">
        <Icon name="film" size={28} />
        <h3>Timeline workspace</h3>
        <p>Create a project and import a clip to start editing with the Concat engine.</p>
        {catalogue.length > 0 && <span>{catalogue.length} effects available from the engine</span>}
      </section>
    </main>
  );
}
