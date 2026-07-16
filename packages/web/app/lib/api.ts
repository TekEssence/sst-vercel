export function getApiUrl(): string {
  return import.meta.env.VITE_API_URL ?? "http://localhost:3000";
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
  createdAt: string;
  updatedAt: string;
}
