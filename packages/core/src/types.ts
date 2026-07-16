export type DeploymentStatus =
  | "queued"
  | "building"
  | "ready"
  | "failed"
  | "cancelled";

export interface Project {
  id: string;
  ownerId: string;
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
  status: DeploymentStatus;
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

export interface Domain {
  id: string;
  projectId: string;
  domain: string;
  verified: boolean;
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  repoUrl: string;
  branch?: string;
  buildCommand?: string;
  outputDir?: string;
  installCommand?: string;
  framework?: string;
}

export interface CreateDeploymentInput {
  projectId: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  commitAuthor: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
