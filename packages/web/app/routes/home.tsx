import { Link } from "react-router";
import { useState } from "react";
import type { Route } from "./+types/home";
import { getApiUrl } from "~/lib/api";
import type { Project } from "~/lib/api";

export async function clientLoader() {
  const res = await fetch(`${getApiUrl()}/api/projects`);
  const json = await res.json();
  return { projects: (json.data ?? []) as Project[] };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { projects } = loaderData;
  const [branchFilter, setBranchFilter] = useState("");

  const branches = [...new Set(projects.map((p) => p.branch).filter(Boolean))];
  const filtered = branchFilter
    ? projects.filter((p) => p.branch === branchFilter)
    : projects;

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="mt-1 text-sm text-gray-500">
            {filtered.length} of {projects.length} project
            {projects.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {branches.length > 0 && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
          <Link
            to="/projects/new"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New Project
          </Link>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
          <h3 className="text-lg font-medium text-gray-900">No projects yet</h3>
          <p className="mt-1 text-sm text-gray-500">
            Create your first project to start deploying
          </p>
          <Link
            to="/projects/new"
            className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Create Project
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.length === 0 ? (
            <div className="col-span-full rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
              <p className="text-sm text-gray-500">
                No projects with branch "{branchFilter}"
              </p>
            </div>
          ) : (
            filtered.map((project: Project) => (
              <Link
                key={project.id}
                to={`/projects/${project.id}`}
                className="rounded-lg border border-gray-200 bg-white p-6 transition-shadow hover:shadow-md"
              >
                <h3 className="font-semibold text-gray-900">{project.name}</h3>
                <p className="mt-1 text-sm text-gray-500">{project.repoUrl}</p>
                <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
                  <span className="font-mono">{project.branch}</span>
                  {project.framework && <span>{project.framework}</span>}
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
