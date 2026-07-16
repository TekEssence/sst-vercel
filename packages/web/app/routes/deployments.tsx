import { Link } from "react-router";
import type { Route } from "./+types/deployments";
import { getApiUrl } from "~/lib/api";
import type { Deployment } from "~/lib/api";

interface Project {
  id: string;
  name: string;
}

export async function clientLoader() {
  const [projRes, depRes] = await Promise.all([
    fetch(`${getApiUrl()}/api/projects`),
    fetch(`${getApiUrl()}/api/projects`),
  ]);

  const projects = (await projRes.json()).data as Project[];
  return { projects, deployments: [] as Deployment[] };
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

export default function Deployments({ loaderData }: Route.ComponentProps) {
  const { deployments } = loaderData;

  return (
    <div>
      <h1 className="mb-8 text-2xl font-bold text-gray-900">All Deployments</h1>

      {deployments.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">No deployments yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deployments.map((dep: Deployment) => (
            <Link
              key={dep.id}
              to={`/projects/${dep.projectId}/deployments/${dep.id}`}
              className="block rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {dep.commitMessage || dep.id.slice(0, 8)}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">
                    {dep.branch} &middot;{" "}
                    {new Date(dep.createdAt).toLocaleString()}
                  </p>
                </div>
                <StatusBadge status={dep.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
