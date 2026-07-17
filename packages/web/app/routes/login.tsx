import { useState } from "react";
import { useNavigate, Link } from "react-router";
import type { Route } from "./+types/login";
import { getApiUrl, setAuthToken } from "~/lib/api";

export default function Login({ actionData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState<string | null>(null);

  async function handleGitHubLogin() {
    setLoading("github");
    window.location.href = `${getApiUrl()}/api/auth/github`;
  }

  async function handleBypass() {
    setLoading("bypass");
    try {
      const res = await fetch(`${getApiUrl()}/api/auth/bypass`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setAuthToken(json.data.token, json.data);
        navigate("/");
      }
    } catch (e: any) {
      console.error("Bypass failed:", e);
    }
    setLoading(null);
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="w-full max-w-sm">
        <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">
          Sign In
        </h1>
        <p className="mb-8 text-center text-sm text-gray-500">
          Sign in to manage your deployments
        </p>

        <div className="space-y-4">
          <button
            onClick={handleGitHubLogin}
            disabled={loading !== null}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            {loading === "github" ? "Redirecting..." : "Sign in with GitHub"}
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-gray-50 px-2 text-gray-500">or</span>
            </div>
          </div>

          <button
            onClick={handleBypass}
            disabled={loading !== null}
            className="w-full rounded-lg border border-dashed border-gray-400 px-4 py-2.5 text-sm font-medium text-gray-600 hover:border-gray-500 hover:text-gray-800 disabled:opacity-50"
          >
            {loading === "bypass" ? "Signing in..." : "Continue without login"}
          </button>
        </div>

        {actionData?.error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {actionData.error}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-gray-400">
          By continuing, you agree to the Terms of Service.
        </p>
      </div>
    </div>
  );
}