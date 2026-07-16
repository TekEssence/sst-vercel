import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  CodeBuildClient,
  BatchGetBuildsCommand,
} from "@aws-sdk/client-codebuild";
import {
  LambdaClient,
  CreateFunctionCommand,
} from "@aws-sdk/client-lambda";
import { Resource } from "sst";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const codebuild = new CodeBuildClient({});
const lambda = new LambdaClient({});

const WEB_ADAPTER_LAYER = process.env.WEB_ADAPTER_LAYER_ARN!;
const PREVIEW_ROLE_ARN = process.env.PREVIEW_LAMBDA_ROLE_ARN!;
const API_URL = process.env.API_URL!;

interface CodeBuildEvent {
  "detail-type": string;
  source: string;
  detail: {
    "build-status": string;
    "project-name": string;
    "build-id": string;
  };
}

function env(name: string, vars: Array<{ name: string; value: string }>): string | undefined {
  return vars.find((v) => v.name === name)?.value;
}

export async function handler(event: CodeBuildEvent) {
  if (
    event["detail-type"] !== "CodeBuild Build State Change" ||
    event.source !== "aws.codebuild"
  ) {
    return;
  }

  const status = event.detail["build-status"];
  const buildId = event.detail["build-id"];
  if (!buildId) return;

  const additionalInfo = (event as any).detail?.["additional-information"];
  const eventEnvVars: Array<{ name: string; value: string }> =
    additionalInfo?.environment?.["environment-variables"] ?? [];

  let deploymentId = env("DEPLOYMENT_ID", eventEnvVars);
  let projectId = env("PROJECT_ID", eventEnvVars);

  if (!deploymentId || !projectId) {
    try {
      const builds = await codebuild.send(
        new BatchGetBuildsCommand({ ids: [buildId] })
      );
      const build = builds.builds?.[0];
      if (build) {
        const vars = build.environment?.["environment-variables"] ?? [];
        deploymentId = env("DEPLOYMENT_ID", vars) || deploymentId;
        projectId = env("PROJECT_ID", vars) || projectId;
      }
    } catch {}
  }

  if (!deploymentId || !projectId) return;

  if (status === "SUCCEEDED") {
    let previewUrl: string | null = null;
    let previewLambda: string | null = null;

    try {
      const fnName = `preview-${deploymentId}`;

      await lambda.send(
        new CreateFunctionCommand({
          FunctionName: fnName,
          Runtime: "nodejs22.x",
          Role: PREVIEW_ROLE_ARN,
          Handler: "run.sh",
          Code: {
            S3Bucket: Resource.AssetsBucket.name,
            S3Key: `${deploymentId}/standalone.zip`,
          },
          Layers: [WEB_ADAPTER_LAYER],
          Environment: {
            Variables: {
              PORT: "8080",
              AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
              NODE_OPTIONS: "--enable-source-maps",
            },
          },
          Timeout: 30,
          MemorySize: 1024,
          EphemeralStorage: { Size: 1024 },
        })
      );

      previewLambda = fnName;
      previewUrl = `${API_URL.replace(/\/$/, "")}/_preview/${deploymentId}/`;

      console.log("Created SSR preview Lambda:", fnName, previewUrl);
    } catch (err: any) {
      console.log("SSR preview Lambda creation failed:", err.message, err.name);
      previewUrl = `${API_URL.replace(/\/$/, "")}/_preview/${deploymentId}/`;
    }

    const updateExpr = previewLambda
      ? "SET #status = :status, previewUrl = :url, previewLambda = :fn, updatedAt = :now"
      : "SET #status = :status, previewUrl = :url, updatedAt = :now";
    const exprValues: Record<string, any> = {
      ":status": "ready",
      ":url": previewUrl,
      ":now": new Date().toISOString(),
    };
    if (previewLambda) exprValues[":fn"] = previewLambda;

    await client.send(
      new UpdateCommand({
        TableName: Resource.DeploymentsTable.name,
        Key: { id: deploymentId },
        UpdateExpression: updateExpr,
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: exprValues,
      })
    );
  } else if (["FAILED", "FAULT", "STOPPED"].includes(status)) {
    await client.send(
      new UpdateCommand({
        TableName: Resource.DeploymentsTable.name,
        Key: { id: deploymentId },
        UpdateExpression: "SET #status = :status, updatedAt = :now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":status": "failed",
          ":now": new Date().toISOString(),
        },
      })
    );
  }
}
