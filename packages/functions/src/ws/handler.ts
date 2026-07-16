import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { Resource } from "sst";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface WSEvent {
  requestContext: {
    routeKey: string;
    connectionId: string;
    domainName: string;
    stage: string;
  };
  body?: string;
}

export async function handler(event: WSEvent) {
  const { routeKey, connectionId, domainName, stage } = event.requestContext;

  const apiClient = new ApiGatewayManagementApiClient({
    endpoint: `https://${domainName}/${stage}`,
  });

  switch (routeKey) {
    case "$connect":
      await client.send(
        new PutCommand({
          TableName: Resource.ConnectionsTable.name,
          Item: {
            id: connectionId,
            deploymentId: "",
          },
        })
      );
      return { statusCode: 200 };

    case "$disconnect":
      await client.send(
        new DeleteCommand({
          TableName: Resource.ConnectionsTable.name,
          Key: { id: connectionId },
        })
      );
      return { statusCode: 200 };

    case "subscribe":
      if (!event.body) return { statusCode: 400 };
      const body = JSON.parse(event.body);
      const deploymentId = body.deploymentId;

      if (!deploymentId) {
        await apiClient.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: new TextEncoder().encode(JSON.stringify({
              type: "error",
              message: "deploymentId is required",
            })),
          })
        );
        return { statusCode: 400 };
      }

      await client.send(
        new UpdateCommand({
          TableName: Resource.ConnectionsTable.name,
          Key: { id: connectionId },
          UpdateExpression: "SET deploymentId = :did",
          ExpressionAttributeValues: { ":did": deploymentId },
        })
      );

      await apiClient.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: new TextEncoder().encode(JSON.stringify({
            type: "subscribed",
            deploymentId,
          })),
        })
      );
      return { statusCode: 200 };

    default:
      return { statusCode: 400 };
  }
}
