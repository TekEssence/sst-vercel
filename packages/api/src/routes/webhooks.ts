import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { Resource } from "sst";
import { randomUUID } from "node:crypto";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const eventBridge = new EventBridgeClient({});

interface GitHubPushPayload {
  ref: string;
  repository: {
    clone_url: string;
    full_name: string;
    name: string;
  };
  head_commit: {
    id: string;
    message: string;
    author: { name: string; username: string };
    timestamp: string;
  } | null;
}

export const webhooks = new Hono()

  .post("/github", async (c) => {
    const event = c.req.header("x-github-event");

    if (event !== "push") {
      return c.json({ success: false, error: "Unsupported event" }, 400);
    }

    const body: GitHubPushPayload = await c.req.json();
    const ref = body.ref;
    const branch = ref.replace("refs/heads/", "");
    const repoUrl = body.repository.clone_url;
    const fullName = body.repository.full_name;
    const repoName = body.repository.name;
    const commit = body.head_commit;

    // Find matching project by repoUrl
    const projectsResult = await client.send(
      new QueryCommand({
        TableName: Resource.ProjectsTable.name,
        IndexName: "BySlug",
        KeyConditionExpression: "slug = :slug",
        ExpressionAttributeValues: { ":slug": repoName.toLowerCase() },
      })
    );

    let project = projectsResult.Items?.[0];

    if (!project) {
      return c.json({ success: false, error: "No matching project found" }, 404);
    }

    const deployment = {
      id: randomUUID(),
      projectId: project.id,
      status: "queued",
      branch: branch,
      commitSha: commit?.id ?? "unknown",
      commitMessage: commit?.message ?? "Push to " + branch,
      commitAuthor: commit?.author?.name ?? "unknown",
      buildLogs: "",
      previewUrl: null,
      productionUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await client.send(
      new PutCommand({
        TableName: Resource.DeploymentsTable.name,
        Item: deployment,
      })
    );

    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: Resource.EventBus.name,
            Source: "webhook.github",
            DetailType: "deployment.queued",
            Detail: JSON.stringify({
              deploymentId: deployment.id,
              projectId: project.id,
              repoUrl,
              branch,
              commitSha: commit?.id ?? "unknown",
            }),
          },
        ],
      })
    );

    return c.json({ success: true, data: deployment }, 201);
  });
