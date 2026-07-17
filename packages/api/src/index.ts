import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/aws-lambda";
import { projects } from "./routes/projects";
import { deployments } from "./routes/deployments";
import { domains } from "./routes/domains";
import { webhooks } from "./routes/webhooks";
import { detectFrameworkRouter } from "./routes/detect-framework";
import { preview, production, invokePreviewLambda, lookupPreviewLambda, lookupProductionLambdaByProject } from "./routes/preview";
import { auth } from "./routes/auth";

const app = new Hono();

app.use("*", cors());

app.route("/api/projects", projects);
app.route("/api/deployments", deployments);
app.route("/api/projects", domains);
app.route("/api/webhooks", webhooks);
app.route("/api", detectFrameworkRouter);
app.route("/_preview", preview);
app.route("/_production", production);
app.route("/api/auth", auth);

app.get("/api/health", (c) => c.json({ status: "ok" }));

// Catch-all for app API routes — proxy to SSR Lambda via Referer header
app.all("/api/*", async (c) => {
  const referer = c.req.header("referer") || "";

  // Check for preview reference
  let match = referer.match(/\/_preview\/([^/]+)/);
  if (match) {
    const deploymentId = match[1];
    const fnName = await lookupPreviewLambda(deploymentId);
    if (fnName) {
      const proxyPath = `/_preview/${deploymentId}${c.req.path}`;
      const result = await invokePreviewLambda(fnName, c, proxyPath);
      if (result) {
        result.headers.set("x-served-by", "ssr-lambda");
        return result;
      }
    }
  }

  // Check for production reference
  match = referer.match(/\/_production\/([^/]+)/);
  if (match) {
    const projectId = match[1];
    const fnName = await lookupProductionLambdaByProject(projectId);
    if (fnName) {
      const proxyPath = `/_production/${projectId}${c.req.path}`;
      const result = await invokePreviewLambda(fnName, c, proxyPath);
      if (result) {
        result.headers.set("x-served-by", "ssr-lambda");
        return result;
      }
    }
  }

  return c.json({ message: "Not Found" }, 404);
});

export const handler = handle(app);
