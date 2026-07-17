import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  CodeBuildClient,
  BatchGetBuildsCommand,
} from "@aws-sdk/client-codebuild";
import {
  LambdaClient,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
} from "@aws-sdk/client-lambda";
import { Resource } from "sst";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const codebuild = new CodeBuildClient({});
const lambda = new LambdaClient({});

const WEB_ADAPTER_LAYER = process.env.WEB_ADAPTER_LAYER_ARN!;
const PREVIEW_ROLE_ARN = process.env.PREVIEW_LAMBDA_ROLE_ARN!;
const API_URL = process.env.API_URL!;

// In-memory log accumulator — stored directly on the deployment record so logs
// survive Lambda function recreations across stack deploys.
const deployLogs: string[] = [];
function log(...args: any[]) {
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ")}`;
  deployLogs.push(line);
  console.log(line);
}

function env(name: string, vars: Array<{ name: string; value: string }>): string | undefined {
  return vars.find((v) => v.name === name)?.value;
}

async function ensureLambda(
  fnName: string,
  deploymentId: string,
  envVars: Record<string, string>
): Promise<void> {
  log("Ensuring Lambda:", fnName);
  try {
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
        Timeout: 60,
        MemorySize: 2048,
        EphemeralStorage: { Size: 2048 },
        Environment: { Variables: envVars },
      })
    );
    log("Created Lambda:", fnName);
  } catch (err: any) {
    if (err.name === "ResourceConflictException") {
      // Function already exists — update code and configuration in place
      log("Function exists, updating code:", fnName);
      await lambda.send(
        new UpdateFunctionCodeCommand({
          FunctionName: fnName,
          S3Bucket: Resource.AssetsBucket.name,
          S3Key: `${deploymentId}/standalone.zip`,
        })
      );
      log("Updated Lambda code:", fnName);

      // Update configuration (env vars, timeout, etc.) after code update
      try {
        await lambda.send(
          new UpdateFunctionConfigurationCommand({
            FunctionName: fnName,
            Environment: { Variables: envVars },
            Timeout: 60,
            MemorySize: 2048,
            EphemeralStorage: { Size: 2048 },
          })
        );
        log("Updated Lambda configuration:", fnName);
      } catch (configErr: any) {
        console.error("UpdateFunctionConfiguration failed (non-fatal):", configErr.name, configErr.message);
      }
    } else {
      console.error("createOrUpdate Lambda failed:", err.name, err.message, err.stack);
      throw err;
    }
  }
}

export async function handler(event: any) {
  if (
    event["detail-type"] !== "CodeBuild Build State Change" ||
    event.source !== "aws.codebuild"
  ) {
    return;
  }

  const status = event.detail["build-status"];
  const buildId = event.detail["build-id"];
  if (!buildId) return;

  const additionalInfo = event.detail?.["additional-information"];
  const eventEnvVars: Array<{ name: string; value: string }> =
    additionalInfo?.environment?.["environment-variables"] ?? [];

  log("Build complete event:", JSON.stringify({ status, buildId, eventEnvVars }));

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

  // Determine deployment type from event env vars, then fall back to deployment record
  let deploymentType = env("DEPLOYMENT_TYPE", eventEnvVars);
  if (!deploymentType) {
    try {
      const depRes = await client.send(
        new GetCommand({ TableName: Resource.DeploymentsTable.name, Key: { id: deploymentId } })
      );
      deploymentType = (depRes.Item as any)?.type || "preview";
    } catch {
      deploymentType = "preview";
    }
  }

  log("Handling build completion:", { deploymentId, projectId, deploymentType, status });

  if (status === "SUCCEEDED") {
    // Fetch project to get env vars config
    let projectEnvVars: Record<string, string> = {};
    try {
      const projectRes = await client.send(
        new GetCommand({ TableName: Resource.ProjectsTable.name, Key: { id: projectId } })
      );
      projectEnvVars = isProduction
        ? ((projectRes.Item as any)?.productionEnvVars || {})
        : ((projectRes.Item as any)?.envVars || {});
    } catch {}

    // Collect project env vars from CodeBuild + project config
    const allEnvVars: Record<string, string> = {
      PORT: "8080",
      AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
      NODE_OPTIONS: "--enable-source-maps",
    };

    // Inject project env vars (passed through CodeBuild)
    for (const [key, value] of Object.entries(projectEnvVars)) {
      allEnvVars[key] = String(value);
    }

    const isProduction = deploymentType === "production";

    if (isProduction) {
      // ── Production deployment ──────────────────────────────
      const fnName = `production-${projectId}`;

      try {
        await ensureLambda(fnName, deploymentId, allEnvVars);

        const productionUrl = `${API_URL.replace(/\/$/, "")}/_production/${projectId}/`;

        log("Production Lambda ready:", fnName, productionUrl);

        // Update project record
        await client.send(
          new UpdateCommand({
            TableName: Resource.ProjectsTable.name,
            Key: { id: projectId },
            UpdateExpression: "SET productionLambda = :fn, productionDeploymentId = :did, productionUrl = :url, updatedAt = :now",
            ExpressionAttributeValues: {
              ":fn": fnName,
              ":did": deploymentId,
              ":url": productionUrl,
              ":now": new Date().toISOString(),
            },
          })
        );

        // Update deployment record
        await client.send(
          new UpdateCommand({
            TableName: Resource.DeploymentsTable.name,
            Key: { id: deploymentId },
            UpdateExpression: "SET #status = :status, productionUrl = :url, deploymentLogs = :logs, updatedAt = :now",
            ExpressionAttributeNames: { "#status": "status" },
            ExpressionAttributeValues: {
              ":status": "ready",
              ":url": productionUrl,
              ":logs": deployLogs,
              ":now": new Date().toISOString(),
            },
          })
        );
      } catch (err: any) {
        console.error("Production Lambda setup failed:", err.message, err.name, err.stack);
        await failDeployment(deploymentId);
      }
    } else {
      // ── Preview deployment ─────────────────────────────────
      let previewUrl: string | null = null;
      let previewLambda: string | null = null;

      try {
        const fnName = `preview-${deploymentId}`;
        await ensureLambda(fnName, deploymentId, allEnvVars);

        previewLambda = fnName;
        previewUrl = `${API_URL.replace(/\/$/, "")}/_preview/${deploymentId}/`;

        log("Preview Lambda ready:", fnName, previewUrl);
      } catch (err: any) {
        console.error("Preview Lambda creation failed:", err.message, err.name, err.stack);
        previewUrl = `${API_URL.replace(/\/$/, "")}/_preview/${deploymentId}/`;
      }

      const updateExpr = previewLambda
        ? "SET #status = :status, previewUrl = :url, previewLambda = :fn, deploymentLogs = :logs, updatedAt = :now"
        : "SET #status = :status, previewUrl = :url, deploymentLogs = :logs, updatedAt = :now";
      const exprValues: Record<string, any> = {
        ":status": "ready",
        ":url": previewUrl,
        ":logs": deployLogs,
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
    }
  } else if (["FAILED", "FAULT", "STOPPED"].includes(status)) {
    await failDeployment(deploymentId);
  }
}

async function failDeployment(deploymentId: string) {
  try {
    await client.send(
      new UpdateCommand({
        TableName: Resource.DeploymentsTable.name,
        Key: { id: deploymentId },
        UpdateExpression: "SET #status = :status, deploymentLogs = :logs, updatedAt = :now",
        ExpressionAttributeValues: {
          ":status": "failed",
          ":logs": deployLogs,
          ":now": new Date().toISOString(),
        },
      })
    );
  } catch {}
}
