export function getApiUrl(): string {
  return import.meta.env.VITE_API_URL ?? "http://localhost:3000";
}

const AUTH_KEY = "deployhub_auth";

export interface AuthSession {
  token: string;
  userId: string;
  name: string;
  avatarUrl?: string;
  login?: string;
  bypass?: boolean;
}

export function getAuthSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuthToken(token: string, data?: Partial<AuthSession>) {
  const session: AuthSession = { token, userId: "", name: "", ...data };
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_KEY);
}

export function getAuthHeaders(): Record<string, string> {
  const session = getAuthSession();
  if (session?.token) {
    return { Authorization: `Bearer ${session.token}` };
  }
  return {};
}

export async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith("http") ? path : `${getApiUrl()}${path}`;
  const headers = { ...getAuthHeaders(), ...init?.headers } as Record<string, string>;
  return fetch(url, { ...init, headers });
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  repoUrl: string;
  branch: string;
  buildCommand: string;
  outputDir: string;
  installCommand: string;
  framework: string | null;
  envVars: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  status: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  commitAuthor: string;
  buildLogs: string;
  previewUrl: string | null;
  productionUrl: string | null;
  type?: string;
  createdAt: string;
  updatedAt: string;
}
