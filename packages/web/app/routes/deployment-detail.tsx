import { Link } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/deployment-detail";
import { getApiUrl } from "~/lib/api";
import type { Deployment } from "~/lib/api";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const [deployRes, logsRes, runtimeLogsRes] = await Promise.all([
    fetch(`${getApiUrl()}/api/deployments/${params.deployId}`),
    fetch(`${getApiUrl()}/api/deployments/${params.deployId}/logs`),
    fetch(`${getApiUrl()}/api/deployments/${params.deployId}/runtime-logs`),
  ]);
  const deployJson = await deployRes.json();
  const logsJson = logsRes.ok ? await logsRes.json() : { data: { logs: "" } };
  const runtimeJson = runtimeLogsRes.ok ? await runtimeLogsRes.json() : { data: { logs: "" } };
  return {
    deployment: deployJson.data as Deployment,
    initialLogs: logsJson.data?.logs ?? "",
    initialRuntimeLogs: runtimeJson.data?.logs ?? "",
  };
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

export default function DeploymentDetail({ loaderData }: Route.ComponentProps) {
  const { deployment, initialLogs, initialRuntimeLogs } = loaderData;
  const [logs, setLogs] = useState(initialLogs);
  const [runtimeLogs, setRuntimeLogs] = useState(initialRuntimeLogs);
  const [tab, setTab] = useState<"build" | "runtime">("build");
  const [runtimeError, setRuntimeError] = useState("");

  useEffect(() => {
    setLogs(initialLogs);
  }, [initialLogs]);

  useEffect(() => {
    setRuntimeLogs(initialRuntimeLogs);
  }, [initialRuntimeLogs]);

  // Poll build logs while building
  useEffect(() => {
    if (deployment.status !== "building" && deployment.status !== "queued") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${getApiUrl()}/api/deployments/${deployment.id}/logs`);
        const json = await res.json();
        if (json.data?.logs) setLogs(json.data.logs);
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [deployment.id, deployment.status]);

  // Poll runtime logs when ready
  useEffect(() => {
    if (deployment.status !== "ready") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${getApiUrl()}/api/deployments/${deployment.id}/runtime-logs`);
        const json = await res.json();
        if (json.data?.logs && !json.data.logs.startsWith("No runtime") && !json.data.logs.startsWith("Runtime logs not")) {
          setRuntimeLogs(json.data.logs);
          setRuntimeError("");
        } else if (json.data?.logs.startsWith("Runtime logs not")) {
          setRuntimeError(json.data.logs);
        }
      } catch {}
    }, 5000);
    return () => clearInterval(interval);
  }, [deployment.id, deployment.status]);

  return (
    <div>
      <Link
        to={`/projects/${deployment.projectId}`}
        className="text-sm text-blue-600 hover:underline"
      >
        &larr; Project
      </Link>

      <div className="mb-8 mt-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">
            {deployment.commitMessage || deployment.id.slice(0, 8)}
          </h1>
          <StatusBadge status={deployment.status} />
          {deployment.type && (
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              deployment.type === "production" 
                ? "bg-purple-100 text-purple-800" 
                : "bg-blue-100 text-blue-800"
            }`}>
              {deployment.type}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {deployment.commitSha?.slice(0, 7)} &middot; {deployment.branch}
          &middot; {deployment.commitAuthor} &middot;{" "}
          {new Date(deployment.createdAt).toLocaleString()}
        </p>
      </div>

      <div className="mb-8 space-y-3">
        {deployment.previewUrl && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <p className="text-sm font-medium text-blue-900">Preview URL</p>
            <a
              href={deployment.previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline break-all"
            >
              {deployment.previewUrl}
            </a>
          </div>
        )}
        {deployment.productionUrl && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-medium text-green-900">Production URL</p>
            <a
              href={deployment.productionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-green-600 hover:underline break-all"
            >
              {deployment.productionUrl}
            </a>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 flex">
          <button
            onClick={() => setTab("build")}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition ${
              tab === "build"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Build Logs
          </button>
          <button
            onClick={() => setTab("runtime")}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition ${
              tab === "runtime"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Runtime Logs
          </button>
        </div>
        {tab === "build" ? (
          <pre className="overflow-x-auto p-4 text-sm text-gray-600 max-h-96 overflow-y-auto">
            {logs || "No build logs available"}
          </pre>
        ) : (
          <div>
            {runtimeError && (
              <div className="px-4 pt-3">
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-700">
                  {runtimeError}
                </div>
              </div>
            )}
            <pre className="overflow-x-auto p-4 text-sm text-gray-600 max-h-96 overflow-y-auto">
              {runtimeLogs || "No runtime logs yet"}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
