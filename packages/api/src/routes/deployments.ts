import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { CloudWatchLogsClient, GetLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { Resource } from "sst";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const logsClient = new CloudWatchLogsClient({});

export const deployments = new Hono()
  .get("/projects/:projectId", async (c) => {
    const { projectId } = c.req.param();
    const result = await client.send(
      new QueryCommand({
        TableName: Resource.DeploymentsTable.name,
        IndexName: "ByProject",
        KeyConditionExpression: "projectId = :pid",
        ExpressionAttributeValues: { ":pid": projectId },
        ScanIndexForward: false,
        Limit: 50,
      })
    );
    return c.json({ success: true, data: result.Items ?? [] });
  })

  .get("/:id", async (c) => {
    const { id } = c.req.param();
    const result = await client.send(
      new GetCommand({ TableName: Resource.DeploymentsTable.name, Key: { id } })
    );

    if (!result.Item) {
      return c.json({ success: false, error: "Deployment not found" }, 404);
    }

    return c.json({ success: true, data: result.Item });
  })

  .get("/:id/logs", async (c) => {
    const { id } = c.req.param();
    const result = await client.send(
      new GetCommand({ TableName: Resource.DeploymentsTable.name, Key: { id } })
    );

    if (!result.Item) {
      return c.json({ success: false, error: "Deployment not found" }, 404);
    }

    const codeBuildId: string | undefined = result.Item.codeBuildId;
    let streamName: string | undefined = result.Item.codeBuildLogStream;

    if (codeBuildId) {
      const uuid = codeBuildId.split(":")[1];
      const derived = uuid ? `build/${uuid}` : undefined;
      if (derived) streamName = derived;
    }

    if (!streamName) {
      return c.json({ success: true, data: { logs: "" } });
    }

    try {
      const logsResult = await logsClient.send(
        new GetLogEventsCommand({
          logGroupName: "/aws/codebuild/sst-aws-vercel-build",
          logStreamName: streamName,
          limit: 200,
        })
      );

      const logs = (logsResult.events ?? [])
        .map((e) => e.message)
        .join("");

      return c.json({ success: true, data: { logs } });
    } catch {
      return c.json({ success: true, data: { logs: "" } });
    }
  });
