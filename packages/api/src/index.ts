import { Hono } from "hono";
import { cors } from "hono/cors";
import { handle } from "hono/aws-lambda";
import { projects } from "./routes/projects";
import { deployments } from "./routes/deployments";
import { domains } from "./routes/domains";
import { webhooks } from "./routes/webhooks";
import { detectFrameworkRouter } from "./routes/detect-framework";
import { preview } from "./routes/preview";

const app = new Hono();

app.use("*", cors());

app.route("/api/projects", projects);
app.route("/api/deployments", deployments);
app.route("/api/projects", domains);
app.route("/api/webhooks", webhooks);
app.route("/api", detectFrameworkRouter);
app.route("/_preview", preview);

app.get("/api/health", (c) => c.json({ status: "ok" }));

export const handler = handle(app);
