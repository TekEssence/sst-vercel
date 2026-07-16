import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { randomUUID } from "node:crypto";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface GitHubPayload {
  ref?: string;
  after?: string;
  repository?: { clone_url?: string };
  head_commit?: {
    message?: string;
    author?: { name?: string };
  };
}

export async function handler(event: GitHubPayload) {
  const repoUrl = event.repository?.clone_url;
  const branch = event.ref?.replace("refs/heads/", "");
  const commitSha = event.after;
  const commitMessage = event.head_commit?.message ?? "No message";
  const commitAuthor = event.head_commit?.author?.name ?? "unknown";

  if (!repoUrl || !branch || !commitSha) {
    return { status: 400, body: "Invalid payload" };
  }

  const projects = await client.send(
    new ScanCommand({
      TableName: Resource.ProjectsTable.name,
      FilterExpression: "repoUrl = :url",
      ExpressionAttributeValues: { ":url": repoUrl },
    })
  );

  const project = (projects.Items ?? [])[0];
  if (!project) {
    return { status: 404, body: "No matching project" };
  }

  const deployment = {
    id: randomUUID(),
    projectId: project.id,
    status: "queued",
    branch,
    commitSha,
    commitMessage,
    commitAuthor,
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

  return { status: 201, body: deployment };
}
