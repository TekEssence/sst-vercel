import { Link } from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/deployment-detail";
import { getApiUrl } from "~/lib/api";
import type { Deployment } from "~/lib/api";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const [deployRes, logsRes] = await Promise.all([
    fetch(`${getApiUrl()}/api/deployments/${params.deployId}`),
    fetch(`${getApiUrl()}/api/deployments/${params.deployId}/logs`),
  ]);
  const deployJson = await deployRes.json();
  const logsJson = logsRes.ok ? await logsRes.json() : { data: { logs: "" } };
  return {
    deployment: deployJson.data as Deployment,
    initialLogs: logsJson.data?.logs ?? "",
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
  const { deployment, initialLogs } = loaderData;
  const [logs, setLogs] = useState(initialLogs);

  useEffect(() => {
    setLogs(initialLogs);
  }, [initialLogs]);

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
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {deployment.commitSha?.slice(0, 7)} &middot; {deployment.branch}
          &middot; {deployment.commitAuthor} &middot;{" "}
          {new Date(deployment.createdAt).toLocaleString()}
        </p>
      </div>

      {deployment.previewUrl && (
        <div className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm font-medium text-blue-900">Preview URL</p>
          <a
            href={deployment.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline"
          >
            {deployment.previewUrl}
          </a>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Build Logs</h2>
        </div>
        <pre className="overflow-x-auto p-4 text-sm text-gray-600">
          {logs || "No logs available"}
        </pre>
      </div>
    </div>
  );
}
