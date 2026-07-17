import { Hono } from "hono";
import { z } from "zod";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { Resource } from "sst";
import { randomUUID } from "node:crypto";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  repoUrl: z.string().url(),
  branch: z.string().default("main"),
  buildCommand: z.string().default("npm run build"),
  outputDir: z.string().default("dist"),
  installCommand: z.string().default("npm ci"),
  framework: z.string().nullable().default(null),
});

export const projects = new Hono()
  .get("/", async (c) => {
    const result = await client.send(
      new ScanCommand({ TableName: Resource.ProjectsTable.name })
    );
    return c.json({ success: true, data: result.Items ?? [] });
  })

  .post("/", async (c) => {
    const body = await c.req.json();
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }

    const project = {
      id: randomUUID(),
      ownerId: "default", // Will come from auth in Phase 2
      name: parsed.data.name,
      slug: parsed.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      repoUrl: parsed.data.repoUrl,
      branch: parsed.data.branch,
      buildCommand: parsed.data.buildCommand,
      outputDir: parsed.data.outputDir,
      installCommand: parsed.data.installCommand,
      framework: parsed.data.framework,
      envVars: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await client.send(
      new PutCommand({ TableName: Resource.ProjectsTable.name, Item: project })
    );

    return c.json({ success: true, data: project }, 201);
  })

  .get("/:id", async (c) => {
    const { id } = c.req.param();
    const result = await client.send(
      new GetCommand({ TableName: Resource.ProjectsTable.name, Key: { id } })
    );

    if (!result.Item) {
      return c.json({ success: false, error: "Project not found" }, 404);
    }

    return c.json({ success: true, data: result.Item });
  })

  .delete("/:id", async (c) => {
    const { id } = c.req.param();
    await client.send(
      new DeleteCommand({ TableName: Resource.ProjectsTable.name, Key: { id } })
    );
    return c.json({ success: true });
  })

  .get("/:id/deployments", async (c) => {
    const { id } = c.req.param();
    const result = await client.send(
      new QueryCommand({
        TableName: Resource.DeploymentsTable.name,
        IndexName: "ByProject",
        KeyConditionExpression: "projectId = :pid",
        ExpressionAttributeValues: { ":pid": id },
        ScanIndexForward: false,
        Limit: 50,
      })
    );
    return c.json({ success: true, data: result.Items ?? [] });
  })

  .post("/:id/deploy", async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    const type = body.type === "production" ? "production" : "preview";
    const MAX_DEPLOYS = 5;

    const project = await client.send(
      new GetCommand({ TableName: Resource.ProjectsTable.name, Key: { id } })
    );

    if (!project.Item) {
      return c.json({ success: false, error: "Project not found" }, 404);
    }

    // Enforce max deployments per type
    try {
      const existing = await client.send(
        new QueryCommand({
          TableName: Resource.DeploymentsTable.name,
          IndexName: "ByProject",
          KeyConditionExpression: "projectId = :pid",
          ExpressionAttributeValues: { ":pid": id },
          ScanIndexForward: false,
        })
      );

      const sameType = (existing.Items || [])
        .filter((d: any) => d.type === type)
        .sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt));

      while (sameType.length >= MAX_DEPLOYS) {
        const oldest = sameType.shift()!;
        await client.send(
          new DeleteCommand({ TableName: Resource.DeploymentsTable.name, Key: { id: oldest.id } })
        );
      }
    } catch (err: any) {
      console.error("Failed to enforce deployment limits:", err.message);
    }

    const deployment = {
      id: randomUUID(),
      projectId: id,
      type,
      status: "queued",
      branch: project.Item.branch ?? "main",
      commitSha: "pending",
      commitMessage: type === "production" ? "Production deploy" : "Manual deploy",
      commitAuthor: "unknown",
      buildLogs: "",
      previewUrl: null,
      productionUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await client.send(
      new PutCommand({ TableName: Resource.DeploymentsTable.name, Item: deployment })
    );

    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: Resource.EventBus.name,
            Source: "api",
            DetailType: "deployment.queued",
            Detail: JSON.stringify({
              deploymentId: deployment.id,
              projectId: id,
              type,
            }),
          },
        ],
      })
    );

    return c.json({ success: true, data: deployment }, 201);
  })

  // ── Environment Variables ──────────────────────────────────
  .get("/:id/env-vars", async (c) => {
    const { id } = c.req.param();
    const scope = c.req.query("scope") || "preview";
    const field = scope === "production" ? "productionEnvVars" : "envVars";

    const result = await client.send(
      new GetCommand({ TableName: Resource.ProjectsTable.name, Key: { id } })
    );
    if (!result.Item) return c.json({ success: false, error: "Not found" }, 404);

    const envVars = (result.Item as any)[field] || {};
    const names = Object.keys(envVars);
    return c.json({ success: true, data: names });
  })

  .post("/:id/env-vars", async (c) => {
    const { id } = c.req.param();
    const scope = c.req.query("scope") || "preview";
    const field = scope === "production" ? "productionEnvVars" : "envVars";
    const body = await c.req.json();
    const vars = body.vars || {};

    const result = await client.send(
      new GetCommand({ TableName: Resource.ProjectsTable.name, Key: { id } })
    );
    if (!result.Item) return c.json({ success: false, error: "Not found" }, 404);

    const existing = (result.Item as any)[field] || {};
    const merged = { ...existing, ...vars };

    await client.send(
      new UpdateCommand({
        TableName: Resource.ProjectsTable.name,
        Key: { id },
        UpdateExpression: `SET ${field} = :vars, updatedAt = :now`,
        ExpressionAttributeValues: {
          ":vars": merged,
          ":now": new Date().toISOString(),
        },
      })
    );

    return c.json({ success: true, data: Object.keys(merged) });
  })

  .delete("/:id/env-vars/:name", async (c) => {
    const { id, name } = c.req.param();
    const scope = c.req.query("scope") || "preview";
    const field = scope === "production" ? "productionEnvVars" : "envVars";

    const result = await client.send(
      new GetCommand({ TableName: Resource.ProjectsTable.name, Key: { id } })
    );
    if (!result.Item) return c.json({ success: false, error: "Not found" }, 404);

    const existing = { ...((result.Item as any)[field] || {}) };
    delete existing[name];

    await client.send(
      new UpdateCommand({
        TableName: Resource.ProjectsTable.name,
        Key: { id },
        UpdateExpression: `SET ${field} = :vars, updatedAt = :now`,
        ExpressionAttributeValues: {
          ":vars": existing,
          ":now": new Date().toISOString(),
        },
      })
    );

    return c.json({ success: true });
  })

  .post("/:id/env-vars/copy-to-production", async (c) => {
    const { id } = c.req.param();
    const result = await client.send(
      new GetCommand({ TableName: Resource.ProjectsTable.name, Key: { id } })
    );
    if (!result.Item) return c.json({ success: false, error: "Not found" }, 404);

    const previewVars = (result.Item as any).envVars || {};
    await client.send(
      new UpdateCommand({
        TableName: Resource.ProjectsTable.name,
        Key: { id },
        UpdateExpression: "SET productionEnvVars = :vars, updatedAt = :now",
        ExpressionAttributeValues: {
          ":vars": previewVars,
          ":now": new Date().toISOString(),
        },
      })
    );

    return c.json({ success: true, data: Object.keys(previewVars) });
  })

  // ── Production ─────────────────────────────────────────────
  .post("/:id/promote", async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json().catch(() => ({}));
    const deploymentId = body.deploymentId;
    if (!deploymentId) return c.json({ success: false, error: "deploymentId required" }, 400);

    // Verify deployment exists
    const depResult = await client.send(
      new GetCommand({ TableName: Resource.DeploymentsTable.name, Key: { id: deploymentId } })
    );
    if (!depResult.Item) return c.json({ success: false, error: "Deployment not found" }, 404);

    // Emit event for BuildComplete to handle promotion
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: Resource.EventBus.name,
            Source: "api",
            DetailType: "deployment.promote",
            Detail: JSON.stringify({ deploymentId, projectId: id }),
          },
        ],
      })
    );

    return c.json({ success: true, message: "Promotion started" });
  });
