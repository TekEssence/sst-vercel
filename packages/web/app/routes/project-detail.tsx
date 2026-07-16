import { Link, Form, useNavigation } from "react-router";
import type { Route } from "./+types/project-detail";
import { getApiUrl } from "~/lib/api";
import type { Project, Deployment } from "~/lib/api";

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  const [projectRes, deploymentsRes] = await Promise.all([
    fetch(`${getApiUrl()}/api/projects/${params.id}`),
    fetch(`${getApiUrl()}/api/projects/${params.id}/deployments`),
  ]);

  const project = (await projectRes.json()).data as Project;
  const deployments = (await deploymentsRes.json()).data as Deployment[];

  return { project, deployments };
}

export async function clientAction({ params, request }: Route.ClientActionArgs) {
  if (request.method === "POST") {
    await fetch(`${getApiUrl()}/api/projects/${params.id}/deploy`, {
      method: "POST",
    });
  }
  return null;
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

export default function ProjectDetail({ loaderData }: Route.ComponentProps) {
  const { project, deployments } = loaderData;
  const navigation = useNavigation();
  const isDeploying = navigation.state === "submitting";

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
            <Form method="post">
              <button
                type="submit"
                disabled={isDeploying}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeploying ? "Deploying..." : "Deploy"}
              </button>
            </Form>
            <Form
              method="post"
              onSubmit={(e) => {
                if (!confirm("Delete this project?")) e.preventDefault();
              }}
            >
              <input type="hidden" name="_method" value="delete" />
              <button
                type="submit"
                className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Delete
              </button>
            </Form>
          </div>
        </div>
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
                      {deployment.branch} &middot;{" "}
                      {new Date(deployment.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <StatusBadge status={deployment.status} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
