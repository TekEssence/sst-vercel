export default $config({
  app(input) {
    return {
      name: "sst-aws-vercel",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          profile: "sst-dev",
        },
      },
    };
  },
  async run() {
    const aws = await import("@pulumi/aws");

    // ── Storage ──────────────────────────────────────────────
    const buildBucket = new sst.aws.Bucket("BuildBucket", { access: "private" });
    const assetsBucket = new sst.aws.Bucket("AssetsBucket", { access: "public" });
    const logBucket = new sst.aws.Bucket("LogBucket", { access: "private" });

    const projectsTable = new sst.aws.Dynamo("ProjectsTable", {
      fields: {
        id: "string",
        ownerId: "string",
        slug: "string",
        createdAt: "string",
      },
      primaryIndex: { hashKey: "id" },
      globalIndexes: {
        ByOwner: { hashKey: "ownerId", rangeKey: "createdAt" },
        BySlug: { hashKey: "slug" },
      },
    });

    const deploymentsTable = new sst.aws.Dynamo("DeploymentsTable", {
      fields: {
        id: "string",
        projectId: "string",
        status: "string",
        createdAt: "string",
      },
      primaryIndex: { hashKey: "id" },
      globalIndexes: {
        ByProject: { hashKey: "projectId", rangeKey: "createdAt" },
        ByStatus: { hashKey: "status", rangeKey: "createdAt" },
      },
    });

    const domainsTable = new sst.aws.Dynamo("DomainsTable", {
      fields: {
        id: "string",
        projectId: "string",
        domain: "string",
      },
      primaryIndex: { hashKey: "id" },
      globalIndexes: {
        ByProject: { hashKey: "projectId" },
        ByDomain: { hashKey: "domain" },
      },
    });

    // ── Auth ─────────────────────────────────────────────────
    const userPool = new sst.aws.CognitoUserPool("UserPool", {
      usernames: ["email"],
    });

    const userPoolClient = userPool.addClient("Web");

    const identityPool = new sst.aws.CognitoIdentityPool("IdentityPool", {
      userPools: [
        { userPool: userPool.id, client: userPoolClient.id },
      ],
    });

    // ── Events ───────────────────────────────────────────────
    const bus = new sst.aws.Bus("EventBus");

    // ── CodeBuild ────────────────────────────────────────────
    const codeBuildRole = new aws.iam.Role("CodeBuildRole", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "codebuild.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
      managedPolicyArns: [
        "arn:aws:iam::aws:policy/AmazonS3FullAccess",
        "arn:aws:iam::aws:policy/CloudWatchLogsFullAccess",
      ],
    });

    // Explicit S3 policy for the CodeBuild role (managed policy may be blocked by SCP)
    new aws.iam.RolePolicy("CodeBuildS3Policy", {
      role: codeBuildRole.name,
      policy: assetsBucket.arn.apply((arn) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["s3:*"],
              Resource: [arn, `${arn}/*`],
            },
          ],
        })
      ),
    });

    const codeBuildProject = new aws.codebuild.Project("BuildProject", {
      name: "sst-aws-vercel-build",
      description: "Build projects for sst-aws-vercel",
      serviceRole: codeBuildRole.arn,
      artifacts: { type: "NO_ARTIFACTS" },
      environment: {
        type: "LINUX_CONTAINER",
        computeType: "BUILD_GENERAL1_SMALL",
        image: "aws/codebuild/amazonlinux2-x86_64-standard:5.0",
        imagePullCredentialsType: "CODEBUILD",
        privilegedMode: true,
      },
      source: {
        type: "NO_SOURCE",
        buildspec: "version: 0.2\nphases:\n  install:\n    runtime-versions:\n      nodejs: 22\n  build:\n    commands:\n      - echo 'Build started'\n",
      },
      logsConfig: {
        cloudwatchLogs: {
          groupName: "/aws/codebuild/sst-aws-vercel-build",
          streamName: "build",
          status: "ENABLED",
        },
      },
    });

    // ── Build Pipeline Functions (stubs defined here, env vars set after API) ─
    const buildTrigger = new sst.aws.Function("BuildTrigger", {
      handler: "packages/functions/src/build/trigger.handler",
      link: [projectsTable, deploymentsTable, assetsBucket, bus],
      environment: {
        CODEBUILD_PROJECT_NAME: codeBuildProject.name,
      },
      permissions: [
        {
          actions: ["codebuild:StartBuild"],
          resources: [codeBuildProject.arn],
        },
        {
          actions: ["s3:PutObject", "s3:GetObject"],
          resources: [$interpolate`${assetsBucket.arn}/*`],
        },
      ],
      timeout: "30 seconds",
    });

    // Wire EventBridge: deployment.queued → BuildTrigger
    bus.subscribe("DeploymentQueued", buildTrigger.arn, {
      pattern: { detailType: ["deployment.queued"] },
    });

    // ── API ──────────────────────────────────────────────────
    const api = new sst.aws.ApiGatewayV2("ApiGateway", {
      cors: {
        allowOrigins: ["*"],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        allowHeaders: ["Content-Type", "Authorization"],
      },
    });

    const apiHandler = {
      handler: "packages/api/src/index.handler",
      link: [projectsTable, deploymentsTable, domainsTable, bus, buildBucket, assetsBucket],
      environment: {
        USER_POOL_ID: userPool.id,
        USER_POOL_CLIENT_ID: userPoolClient.id,
      },
      permissions: [
        {
          actions: ["logs:GetLogEvents", "logs:DescribeLogStreams", "logs:FilterLogEvents"],
          resources: [$interpolate`arn:aws:logs:*:*:log-group:/aws/codebuild/*:*`],
        },
        {
          actions: ["lambda:InvokeFunction"],
          resources: [$interpolate`arn:aws:lambda:*:*:function:preview-*`],
        },
      ],
    };

    api.route("GET /api/health", apiHandler);
    api.route("GET /api/projects", apiHandler);
    api.route("POST /api/projects", apiHandler);
    api.route("GET /api/projects/{id}", apiHandler);
    api.route("DELETE /api/projects/{id}", apiHandler);
    api.route("POST /api/projects/{id}/deploy", apiHandler);
    api.route("GET /api/projects/{id}/deployments", apiHandler);
    api.route("GET /api/deployments/{id}", apiHandler);
    api.route("GET /api/deployments/{id}/logs", apiHandler);
    api.route("POST /api/detect-framework", apiHandler);
    api.route("POST /api/webhooks/github", apiHandler);
    api.route("POST /api/projects/{id}/domains", apiHandler);
    api.route("DELETE /api/projects/{id}/domains/{domain}", apiHandler);
    api.route("GET /api/projects/{id}/domains", apiHandler);
    api.route("GET /_preview/{proxy+}", apiHandler);

    // ── Preview Lambda Infrastructure ────────────────────────
    const previewLambdaRole = new aws.iam.Role("PreviewLambdaRole", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "lambda.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
      managedPolicyArns: [
        "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
      ],
    });

    // Grant S3 read access so the app can read its deployment artifacts
    new aws.iam.RolePolicy("PreviewLambdaS3Policy", {
      role: previewLambdaRole.name,
      policy: assetsBucket.arn.apply((arn) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["s3:GetObject"],
              Resource: [`${arn}/*`],
            },
          ],
        })
      ),
    });

    // ── Build Complete (wired here so api.url is available) ──
    const previewUrlParam = new aws.ssm.Parameter("PreviewUrlParam", {
      type: "String",
      value: api.url,
    });

    const webAdapterLayerArn = "arn:aws:lambda:us-east-1:753240598075:layer:LambdaAdapterLayerX86:28";

    const buildComplete = new sst.aws.Function("BuildComplete", {
      handler: "packages/functions/src/build/complete.handler",
      link: [deploymentsTable, assetsBucket],
      environment: {
        PREVIEW_URL_SSM_PARAM: previewUrlParam.name,
        PREVIEW_LAMBDA_ROLE_ARN: previewLambdaRole.arn,
        WEB_ADAPTER_LAYER_ARN: webAdapterLayerArn,
        API_URL: api.url,
      },
      permissions: [
        {
          actions: ["codebuild:BatchGetBuilds"],
          resources: [
            $interpolate`arn:aws:codebuild:*:*:build/${codeBuildProject.name}*`,
            codeBuildProject.arn,
          ],
        },
        {
          actions: ["cloudfront:CreateInvalidation"],
          resources: [$interpolate`arn:aws:cloudfront::*`],
        },
        {
          actions: ["ssm:GetParameter"],
          resources: [previewUrlParam.arn],
        },
        {
          actions: [
            "lambda:CreateFunction",
            "lambda:AddPermission",
            "lambda:DeleteFunction",
            "lambda:CreateFunctionUrlConfig",
            "lambda:AddPermission",
          ],
          resources: [$interpolate`arn:aws:lambda:*:*:function:preview-*`],
        },
        {
          actions: ["iam:PassRole"],
          resources: [previewLambdaRole.arn],
        },
        {
          actions: ["s3:GetObject"],
          resources: [$interpolate`${assetsBucket.arn}/*`],
        },
        {
          actions: ["lambda:GetLayerVersion"],
          resources: ["*"],
        },
      ],
      timeout: "60 seconds",
    });

    // CodeBuild state changes → BuildComplete (on default event bus)
    const pulumi = await import("@pulumi/pulumi");
    const codeBuildRule = new aws.cloudwatch.EventRule("CodeBuildStateRule", {
      eventBusName: "default",
      eventPattern: pulumi.output(codeBuildProject.name).apply((name) =>
        JSON.stringify({
          source: ["aws.codebuild"],
          "detail-type": ["CodeBuild Build State Change"],
          detail: {
            "project-name": [name],
          },
        })
      ),
    });

    new aws.lambda.Permission("CodeBuildRuleLambdaPermission", {
      action: "lambda:InvokeFunction",
      function: buildComplete.arn,
      principal: "events.amazonaws.com",
      sourceArn: codeBuildRule.arn,
    });

    new aws.cloudwatch.EventTarget("CodeBuildStateTarget", {
      rule: codeBuildRule.name,
      eventBusName: "default",
      arn: buildComplete.arn,
    });

    // ── WebSocket for Log Streaming ──────────────────────────
    const connectionsTable = new sst.aws.Dynamo("ConnectionsTable", {
      fields: {
        id: "string",
        deploymentId: "string",
      },
      primaryIndex: { hashKey: "id" },
      globalIndexes: {
        ByDeployment: { hashKey: "deploymentId" },
      },
    });

    const wsHandler = new sst.aws.Function("WebSocketHandler", {
      handler: "packages/functions/src/ws/handler.handler",
      link: [connectionsTable, deploymentsTable],
      timeout: "30 seconds",
    });

    const wsApi = new aws.apigatewayv2.Api("WebSocketApi", {
      protocolType: "WEBSOCKET",
      routeSelectionExpression: "$request.body.action",
    });

    // Create a single integration for all WS routes
    const wsIntegration = new aws.apigatewayv2.Integration("WSIntegration", {
      apiId: wsApi.id,
      integrationType: "AWS_PROXY",
      integrationUri: wsHandler.arn,
      integrationMethod: "POST",
      passthroughBehavior: "WHEN_NO_MATCH",
    });

    // Grant API Gateway permission to invoke the handler
    new aws.lambda.Permission("WSHandlerPermission", {
      action: "lambda:InvokeFunction",
      function: wsHandler.arn,
      principal: "apigateway.amazonaws.com",
      sourceArn: $interpolate`${wsApi.executionArn}/*`,
    });

    // Create routes pointing to the same integration
    const routes = ["$connect", "$disconnect", "subscribe"].map((routeKey) =>
      new aws.apigatewayv2.Route(`WSRoute_${routeKey.replace("$", "")}`, {
        apiId: wsApi.id,
        routeKey,
        target: $interpolate`integrations/${wsIntegration.id}`,
      })
    );

    // Stage deployment
    const wsDeployment = new aws.apigatewayv2.Deployment("WSDeployment", {
      apiId: wsApi.id,
      triggers: {
        redeployment: Date.now().toString(),
      },
    }, { dependsOn: routes });

    const wsStage = new aws.apigatewayv2.Stage("WSStage", {
      apiId: wsApi.id,
      name: "dev",
      deploymentId: wsDeployment.id,
    });

    // ── Web Dashboard ────────────────────────────────────────
    new sst.aws.React("DashboardWeb", {
      path: "packages/web",
      environment: {
        VITE_API_URL: api.url,
        VITE_WS_URL: $interpolate`wss://${wsApi.id}.execute-api.us-east-1.amazonaws.com/${wsStage.name}`,
        VITE_USER_POOL_ID: userPool.id,
        VITE_USER_POOL_CLIENT_ID: userPoolClient.id,
      },
    });
  },
});
