import { Link } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/project-detail";
import { getApiUrl } from "~/lib/api";
import type { Project, Deployment } from "~/lib/api";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const [projectRes, deploymentsRes, previewEnvVarsRes, prodEnvVarsRes] = await Promise.all([
    fetch(`${getApiUrl()}/api/projects/${params.id}`),
    fetch(`${getApiUrl()}/api/projects/${params.id}/deployments`),
    fetch(`${getApiUrl()}/api/projects/${params.id}/env-vars?scope=preview`),
    fetch(`${getApiUrl()}/api/projects/${params.id}/env-vars?scope=production`),
  ]);

  const project = (await projectRes.json()).data as Project;
  const deployments = (await deploymentsRes.json()).data as Deployment[];
  const previewEnvVars = previewEnvVarsRes.ok ? (await previewEnvVarsRes.json()).data as string[] : [];
  const prodEnvVars = prodEnvVarsRes.ok ? (await prodEnvVarsRes.json()).data as string[] : [];

  return { project, deployments, previewEnvVars, prodEnvVars };
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    queued: "bg-yellow-100 text-yellow-800",
    building: "bg-blue-100 text-blue-800",
    ready: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    cancelled: "bg-gray-100 text-gray-800",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[status] ?? "bg-gray-100 text-gray-800"}`}
    >
      {status}
    </span>
  );
}

function EnvVarSection({
  scope,
  names,
  onAdd,
  onDelete,
  onCopyFromPreview,
}: {
  scope: "preview" | "production";
  names: string[];
  onAdd: (key: string, value: string) => Promise<string[] | null>;
  onDelete: (name: string) => Promise<boolean>;
  onCopyFromPreview?: () => Promise<void>;
}) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleAdd() {
    if (!newKey || !newValue) return;
    setAdding(true);
    const result = await onAdd(newKey, newValue);
    if (result) {
      setNewKey("");
      setNewValue("");
    }
    setAdding(false);
  }

  async function handleCopy() {
    if (!onCopyFromPreview) return;
    setCopied(false);
    await onCopyFromPreview();
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  const label = scope === "production" ? "Production" : "Preview";

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">{label} Environment Variables</h3>
        {onCopyFromPreview && names.length === 0 && (
          <button
            onClick={handleCopy}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            {copied ? "Copied!" : "Copy from Preview"}
          </button>
        )}
      </div>

      <div className="mb-3 space-y-2">
        {names.length === 0 ? (
          <p className="text-sm text-gray-400">No variables set.</p>
        ) : (
          names.map((name) => (
            <div key={name} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2">
              <span className="text-sm font-mono text-gray-700">{name}</span>
              <button
                onClick={() => onDelete(name)}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="MY_VAR"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 mb-1">Value</label>
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="********"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={adding || !newKey || !newValue}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {adding ? "..." : "Add"}
        </button>
      </div>
    </div>
  );
}

export default function ProjectDetail({ loaderData }: Route.ComponentProps) {
  const { project, deployments: initialDeployments, previewEnvVars: initialPreview, prodEnvVars: initialProd } = loaderData;
  const [deployments, setDeployments] = useState(initialDeployments);
  const [previewEnvVars, setPreviewEnvVars] = useState(initialPreview);
  const [prodEnvVars, setProdEnvVars] = useState(initialProd);
  const [deployType, setDeployType] = useState<"preview" | "production">("preview");
  const [deploying, setDeploying] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDeployments(initialDeployments);
    setPreviewEnvVars(initialPreview);
    setProdEnvVars(initialProd);
  }, [initialDeployments, initialPreview, initialProd]);

  const productionUrl = (project as any).productionUrl;

  async function handleDeploy() {
    setDeploying(true);
    setMessage("");
    try {
      const res = await fetch(`${getApiUrl()}/api/projects/${project.id}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: deployType }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setDeployments(prev => [json.data, ...prev]);
      } else {
        setMessage("Deploy failed: " + (json.error || "unknown error"));
      }
    } catch (e: any) {
      setMessage("Deploy error: " + e.message);
    }
    setDeploying(false);
  }

  async function handleAddEnvVar(scope: "preview" | "production", key: string, value: string): Promise<string[] | null> {
    setMessage("");
    try {
      const res = await fetch(`${getApiUrl()}/api/projects/${project.id}/env-vars?scope=${scope}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vars: { [key]: value } }),
      });
      const json = await res.json();
      if (json.success) {
        if (scope === "production") setProdEnvVars(json.data as string[]);
        else setPreviewEnvVars(json.data as string[]);
        return json.data as string[];
      }
      setMessage("Failed to add env var: " + (json.error || ""));
      return null;
    } catch (e: any) {
      setMessage("Error: " + e.message);
      return null;
    }
  }

  async function handleDeleteEnvVar(scope: "preview" | "production", name: string): Promise<boolean> {
    setMessage("");
    try {
      const res = await fetch(`${getApiUrl()}/api/projects/${project.id}/env-vars/${encodeURIComponent(name)}?scope=${scope}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (json.success) {
        if (scope === "production") setProdEnvVars(prev => prev.filter(n => n !== name));
        else setPreviewEnvVars(prev => prev.filter(n => n !== name));
        return true;
      }
      return false;
    } catch (e: any) {
      setMessage("Error: " + e.message);
      return false;
    }
  }

  async function handleCopyFromPreview() {
    setMessage("");
    try {
      const res = await fetch(`${getApiUrl()}/api/projects/${project.id}/env-vars/copy-to-production`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.success) {
        setProdEnvVars(json.data as string[]);
        setMessage("Copied preview env vars to production");
      } else {
        setMessage("Copy failed: " + (json.error || ""));
      }
    } catch (e: any) {
      setMessage("Error: " + e.message);
    }
  }

  return (
    <div>
      <div className="mb-8">
        <Link
          to="/"
          className="text-sm text-blue-600 hover:underline"
        >
          &larr; Projects
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
            <p className="mt-1 text-sm text-gray-500">{project.repoUrl}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <select
                value={deployType}
                onChange={(e) => setDeployType(e.target.value as any)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="preview">Preview</option>
                <option value="production">Production</option>
              </select>
              <button
                onClick={handleDeploy}
                disabled={deploying}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deploying ? "Deploying..." : "Deploy"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {message && (
        <div className="mb-4 rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
          {message}
        </div>
      )}

      {productionUrl && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-900">Production URL</p>
          <a
            href={productionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-green-600 hover:underline break-all"
          >
            {productionUrl}
          </a>
        </div>
      )}

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm font-medium text-gray-900 mb-1">GitHub Webhook URL</p>
        <p className="text-xs text-gray-500 mb-2">
          Add this URL to your GitHub repo Settings &rarr; Webhooks to auto-deploy on push
        </p>
        <code className="block rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700 break-all font-mono select-all">
          {getApiUrl()}/api/webhooks/github
        </code>
      </div>

      <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Configuration</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-gray-500">Branch</dt>
            <dd className="text-sm text-gray-900">{project.branch}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Framework</dt>
            <dd className="text-sm text-gray-900">{project.framework ?? "Auto"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Build Command</dt>
            <dd className="text-sm text-gray-900">{project.buildCommand}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Output Directory</dt>
            <dd className="text-sm text-gray-900">{project.outputDir}</dd>
          </div>
        </dl>
      </div>

      {/* Environment Variables */}
      <div className="mb-8 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Environment Variables</h2>
        <EnvVarSection
          scope="preview"
          names={previewEnvVars}
          onAdd={(k, v) => handleAddEnvVar("preview", k, v)}
          onDelete={(n) => handleDeleteEnvVar("preview", n)}
        />
        <EnvVarSection
          scope="production"
          names={prodEnvVars}
          onAdd={(k, v) => handleAddEnvVar("production", k, v)}
          onDelete={(n) => handleDeleteEnvVar("production", n)}
          onCopyFromPreview={handleCopyFromPreview}
        />
      </div>

      <div>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Deployments
        </h2>
        {deployments.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
            <p className="text-sm text-gray-500">No deployments yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {deployments.map((deployment: Deployment) => (
              <Link
                key={deployment.id}
                to={`/projects/${project.id}/deployments/${deployment.id}`}
                className="block rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">
                      {deployment.commitMessage || deployment.id.slice(0, 8)}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {deployment.commitSha?.slice(0, 7)} &middot;{" "}
                      {new Date(deployment.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-700">
                      {deployment.branch}
                    </span>
                    {deployment.type && (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        deployment.type === "production"
                          ? "bg-purple-100 text-purple-800"
                          : "bg-blue-100 text-blue-800"
                      }`}>
                        {deployment.type}
                      </span>
                    )}
                    <StatusBadge status={deployment.status} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
