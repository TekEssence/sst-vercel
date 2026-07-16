import {
  type RouteConfig,
  route,
  index,
  layout,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("projects/new", "routes/projects-new.tsx"),
  route("projects/:id", "routes/project-detail.tsx"),
  route("projects/:id/deployments/:deployId", "routes/deployment-detail.tsx"),
  route("deployments", "routes/deployments.tsx"),
  route("login", "routes/login.tsx"),
] satisfies RouteConfig;
