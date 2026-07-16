import { Hono } from "hono";
import { z } from "zod";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { randomUUID } from "node:crypto";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const addDomainSchema = z.object({
  domain: z.string().min(1).max(253),
});

export const domains = new Hono()
  .get("/:id/domains", async (c) => {
    const { id } = c.req.param();
    const result = await client.send(
      new QueryCommand({
        TableName: Resource.DomainsTable.name,
        IndexName: "ByProject",
        KeyConditionExpression: "projectId = :pid",
        ExpressionAttributeValues: { ":pid": id },
      })
    );
    return c.json({ success: true, data: result.Items ?? [] });
  })

  .post("/:id/domains", async (c) => {
    const { id } = c.req.param();
    const body = await c.req.json();
    const parsed = addDomainSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }

    const domainRecord = {
      id: randomUUID(),
      projectId: id,
      domain: parsed.data.domain,
      verified: false,
      createdAt: new Date().toISOString(),
    };

    await client.send(
      new PutCommand({ TableName: Resource.DomainsTable.name, Item: domainRecord })
    );

    return c.json({ success: true, data: domainRecord }, 201);
  })

  .delete("/:id/domains/:domain", async (c) => {
    const { id, domain } = c.req.param();
    const result = await client.send(
      new QueryCommand({
        TableName: Resource.DomainsTable.name,
        IndexName: "ByProject",
        KeyConditionExpression: "projectId = :pid",
        ExpressionAttributeValues: { ":pid": id },
      })
    );

    const item = (result.Items ?? []).find((d) => d.domain === domain);
    if (item) {
      await client.send(
        new DeleteCommand({ TableName: Resource.DomainsTable.name, Key: { id: item.id } })
      );
    }

    return c.json({ success: true });
  });
