import {
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteError,
  useNavigate,
} from "react-router";
import { useState, useEffect } from "react";
import type { Route } from "./+types/root";
import { getAuthSession, clearAuthToken, getApiUrl } from "~/lib/api";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&display=swap",
  },
];

function Nav() {
  const navigate = useNavigate();
  const [session, setSession] = useState(() => getAuthSession());

  useEffect(() => {
    // Check for token in URL (from GitHub OAuth redirect)
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      // Fetch session info
      fetch(`${getApiUrl()}/api/auth/session`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => r.json())
        .then((json) => {
          if (json.success) {
            import("~/lib/api").then(({ setAuthToken }) => {
              setAuthToken(token, json.data);
              setSession(getAuthSession());
              // Clean URL
              window.history.replaceState({}, "", window.location.pathname);
            });
          }
        })
        .catch(() => {});
    }
  }, []);

  // Listen for storage changes (for bypass login flow)
  useEffect(() => {
    const handler = () => setSession(getAuthSession());
    window.addEventListener("storage", handler);
    // Also poll for changes in the same tab (setAuthToken doesn't fire storage event)
    const interval = setInterval(() => {
      const s = getAuthSession();
      if (s?.token !== session?.token) setSession(s);
    }, 500);
    return () => {
      window.removeEventListener("storage", handler);
      clearInterval(interval);
    };
  }, [session]);

  async function handleLogout() {
    const { getAuthSession, clearAuthToken: clear, getApiUrl } = await import("~/lib/api");
    const s = getAuthSession();
    if (s?.token) {
      await fetch(`${getApiUrl()}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${s.token}` },
      });
    }
    clear();
    setSession(null);
    navigate("/");
  }

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-xl font-bold text-gray-900">
            DeployHub
          </Link>
          <div className="flex gap-6">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `text-sm font-medium ${isActive ? "text-blue-600" : "text-gray-600 hover:text-gray-900"}`
              }
            >
              Projects
            </NavLink>
            <NavLink
              to="/deployments"
              className={({ isActive }) =>
                `text-sm font-medium ${isActive ? "text-blue-600" : "text-gray-600 hover:text-gray-900"}`
              }
            >
              Deployments
            </NavLink>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/projects/new"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New Project
          </Link>
          {session ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">
                {session.name || session.login || "User"}
              </span>
              {session.avatarUrl && (
                <img
                  src={session.avatarUrl}
                  alt=""
                  className="h-7 w-7 rounded-full"
                />
              )}
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Logout
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen bg-gray-50 font-sans text-gray-900 antialiased">
        <Nav />
        <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  let message = "Unexpected error";
  let status = 500;

  if (isRouteErrorResponse(error)) {
    message = error.data;
    status = error.status;
  } else if (error instanceof Error) {
    message = error.message;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900">{status}</h1>
        <p className="mt-2 text-gray-600">{message}</p>
        <Link to="/" className="mt-4 inline-block text-blue-600 hover:underline">
          Go home
        </Link>
      </div>
    </div>
  );
}
