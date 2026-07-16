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

    const project = await client.send(
      new GetCommand({ TableName: Resource.ProjectsTable.name, Key: { id } })
    );

    if (!project.Item) {
      return c.json({ success: false, error: "Project not found" }, 404);
    }

    // Fetch latest commit from GitHub (placeholder — Phase 2)
    const deployment = {
      id: randomUUID(),
      projectId: id,
      status: "queued",
      branch: project.Item.branch ?? "main",
      commitSha: "pending",
      commitMessage: "Manual deploy",
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

    // Emit deployment.queued event
    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: Resource.EventBus.name,
            Source: "api",
            DetailType: "deployment.queued",
            Detail: JSON.stringify({ deploymentId: deployment.id, projectId: id }),
          },
        ],
      })
    );

    return c.json({ success: true, data: deployment }, 201);
  });
