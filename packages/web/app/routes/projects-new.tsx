import { Form, useNavigation, redirect } from "react-router";
import type { Route } from "./+types/projects-new";
import { getApiUrl } from "~/lib/api";

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const name = formData.get("name") as string;
  const repoUrl = formData.get("repoUrl") as string;
  const branch = formData.get("branch") as string || "main";
  const buildCommand = formData.get("buildCommand") as string || "npm run build";
  const outputDir = formData.get("outputDir") as string || "dist";
  const installCommand = formData.get("installCommand") as string || "npm ci";

  const res = await fetch(`${getApiUrl()}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, repoUrl, branch, buildCommand, outputDir, installCommand }),
  });

  const json = await res.json();
  if (!json.success) {
    return { error: json.error ?? "Failed to create project" };
  }

  return redirect(`/projects/${json.data.id}`);
}

export default function NewProject({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-8 text-2xl font-bold text-gray-900">New Project</h1>

      <Form method="post" className="space-y-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Project Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="my-awesome-app"
          />
        </div>

        <div>
          <label htmlFor="repoUrl" className="block text-sm font-medium text-gray-700">
            Git Repository URL
          </label>
          <input
            id="repoUrl"
            name="repoUrl"
            type="url"
            required
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="https://github.com/user/repo"
          />
        </div>

        <div>
          <label htmlFor="framework" className="block text-sm font-medium text-gray-700">
            Framework (optional)
          </label>
          <input
            id="framework"
            name="framework"
            type="text"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="react, next, vue, astro..."
          />
        </div>

        <div>
          <label htmlFor="buildCommand" className="block text-sm font-medium text-gray-700">
            Build Command
          </label>
          <input
            id="buildCommand"
            name="buildCommand"
            type="text"
            defaultValue="npm run build"
            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="outputDir" className="block text-sm font-medium text-gray-700">
              Output Directory
            </label>
            <input
              id="outputDir"
              name="outputDir"
              type="text"
              defaultValue="dist"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="installCommand" className="block text-sm font-medium text-gray-700">
              Install Command
            </label>
            <input
              id="installCommand"
              name="installCommand"
              type="text"
              defaultValue="npm ci"
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {actionData?.error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {actionData.error}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "Creating..." : "Create Project"}
        </button>
      </Form>
    </div>
  );
}
