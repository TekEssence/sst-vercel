import {
  CodeBuildClient,
  StartBuildCommand,
} from "@aws-sdk/client-codebuild";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";

const codebuild = new CodeBuildClient({});
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface EventBridgeEvent {
  version: string;
  "detail-type": string;
  source: string;
  detail: {
    deploymentId: string;
    projectId: string;
    type?: string;
    repoUrl?: string;
    branch?: string;
    commitSha?: string;
    installCommand?: string;
    buildCommand?: string;
    outputDir?: string;
  };
}

export async function handler(event: EventBridgeEvent) {
  const { deploymentId, projectId, type } = event.detail;
  const deploymentType = type || "preview";

  const [deploymentRes, projectRes] = await Promise.all([
    client.send(
      new GetCommand({ TableName: Resource.DeploymentsTable.name, Key: { id: deploymentId } })
    ),
    client.send(
      new GetCommand({ TableName: Resource.ProjectsTable.name, Key: { id: projectId } })
    ),
  ]);

  const deployment = deploymentRes.Item;
  const project = projectRes.Item;

  if (!deployment || !project) {
    console.error("Deployment or project not found", { deploymentId, projectId });
    return { status: "error", message: "Not found" };
  }

  const repoUrl = project.repoUrl;
  const branch = deployment.branch ?? project.branch ?? "main";
  const installCmd = project.installCommand ?? "npm ci";
  const buildCmd = project.buildCommand ?? "npm run build";
  let outputDir = project.outputDir ?? "dist";
  const deployBranch = deployment.branch ?? "main";
  const projectEnvVars: Record<string, string> = deployBranch === "main"
    ? (project as any).productionEnvVars || {}
    : (project as any).envVars || {};

  // Auto-detect framework output dir from package.json (overrides project setting)
  try {
    const rawUrl = repoUrl
      .replace("https://github.com/", "https://raw.githubusercontent.com/")
      .replace(/\.git$/, "") + `/${branch}/package.json`;
    const pkgRes = await fetch(rawUrl);
    if (pkgRes.ok) {
      const pkg = await pkgRes.json();
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (allDeps.next) outputDir = ".next";
      else if (allDeps["@remix-run/react"] || allDeps["@remix-run/node"]) outputDir = "build";
      else if (allDeps["react-scripts"]) outputDir = "build";
      else if (allDeps["gatsby"]) outputDir = "public";
      else if (allDeps["astro"]) outputDir = "dist";
      else if (allDeps["nuxt"] || allDeps["nuxt3"]) outputDir = "dist";
      else if (allDeps["@sveltejs/kit"]) outputDir = "build";
    }
  } catch { }

  await client.send(
    new UpdateCommand({
      TableName: Resource.DeploymentsTable.name,
      Key: { id: deploymentId },
      UpdateExpression: "SET #status = :status, updatedAt = :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":status": "building",
        ":now": new Date().toISOString(),
      },
    })
  );

  const isNextJs = outputDir === ".next";

  const nextStandaloneConfig = isNextJs ? `
      - echo "Creating standalone Next.js config..."
      - cd /tmp/repo
      - echo "BASE64_SCRIPT_PLACEHOLDER" | base64 -d > /tmp/standalone-wrap.mjs
      - node /tmp/standalone-wrap.mjs
      - echo "Rebuilding with standalone output..."
      - npx next build
      - echo "Patching SQLite paths to /tmp/ (Lambda writable directory)..."
      - node -e "const fs=require('fs'),p=require('path');const dirs=['.next/server','.next/standalone/.next/server'];dirs.forEach(d=>{try{fs.statSync(d)}catch{return};console.log('Scanning:',d);(function w(d){fs.readdirSync(d,{withFileTypes:1}).forEach(e=>{let f=p.join(d,e.name);e.isDirectory()?w(f):e.isFile()&&(e.name.endsWith('.js')||e.name.endsWith('.mjs'))?(c=fs.readFileSync(f,'utf-8'),n=c.replace(/\"sqlite\.db\"/g,'\"/tmp/sqlite.db\"'),c!==n&&(fs.writeFileSync(f,n),console.log('Patched:',f))):0})})(d)})"
      - echo "BASE64_RUNSH" | base64 -d > .next/standalone/run.sh && chmod +x .next/standalone/run.sh
      - cd .next/standalone && zip -r /tmp/standalone.zip . && cd /tmp/repo
` : "";

  const deployBasePath = deploymentType === "production" 
    ? `/_production/${projectId}`
    : `/_preview/${deploymentId}`;
  const standaloneWrapScript = `
import fs from "fs";
const candidates = ["next.config.js","next.config.mjs","next.config.ts","next.config.cjs"];
const existing = candidates.find(f => fs.existsSync(f));
const basePathEnv = process.env.DEPLOY_BASE_PATH || "";
if (existing) {
  const isEsm = existing.endsWith(".mjs") || existing.endsWith(".ts");
  const origName = "_orig_" + existing;
  fs.renameSync(existing, origName);
  if (isEsm) {
    fs.writeFileSync(existing, \`import cfg from './\${origName}';\\nexport default { ...cfg, output: 'standalone', typescript: { ignoreBuildErrors: true }, basePath: '\${basePathEnv}', assetPrefix: '\${basePathEnv}' };\`);
  } else {
    fs.writeFileSync(existing, \`const cfg = require('./\${origName}');\\nmodule.exports = { ...cfg, output: 'standalone', typescript: { ignoreBuildErrors: true }, basePath: '\${basePathEnv}', assetPrefix: '\${basePathEnv}' };\`);
  }
} else {
  fs.writeFileSync("next.config.js", \`module.exports = { output: "standalone", basePath: '\${basePathEnv}', assetPrefix: '\${basePathEnv}' };\`);
}
`.trim();
  const standaloneWrapB64 = Buffer.from(standaloneWrapScript).toString("base64");

  const runShB64 = Buffer.from("#!/bin/bash\nexec node server.js\n").toString("base64");

  const uploadStandalone = isNextJs ? `
      - aws s3 cp /tmp/standalone.zip s3://${Resource.AssetsBucket.name}/${deploymentId}/standalone.zip
` : "";

  let buildspec = `version: 0.2
phases:
  install:
    runtime-versions:
      nodejs: 22
    commands:
      - echo "Cloning ${repoUrl}#${branch}"
      - git clone --depth 1 --branch "${branch}" "${repoUrl}" /tmp/repo
      - cd /tmp/repo
      - ${installCmd}
  build:
    commands:
      - cd /tmp/repo
      - echo "Running build..."
      - ${buildCmd}
      ${nextStandaloneConfig}
      - echo "Uploading artifacts..."
      - aws s3 cp ${outputDir}/ s3://${Resource.AssetsBucket.name}/${deploymentId}/ --recursive --exclude "cache/*"
      - if [ -d /tmp/repo/public ]; then aws s3 cp /tmp/repo/public/ s3://${Resource.AssetsBucket.name}/${deploymentId}/public/ --recursive; fi
      ${uploadStandalone}
      - echo "Build complete"
artifacts:
  files: "**/*"
  base-directory: /tmp/repo/${outputDir}
`;

  buildspec = buildspec.replace("BASE64_SCRIPT_PLACEHOLDER", standaloneWrapB64);
  buildspec = buildspec.replace("BASE64_RUNSH", runShB64);

  const buildResult = await codebuild.send(
    new StartBuildCommand({
      projectName: process.env.CODEBUILD_PROJECT_NAME!,
      buildspecOverride: buildspec,
      environmentVariablesOverride: [
        { name: "DEPLOYMENT_ID", value: deploymentId, type: "PLAINTEXT" },
        { name: "PROJECT_ID", value: projectId, type: "PLAINTEXT" },
        { name: "OUTPUT_DIR", value: outputDir, type: "PLAINTEXT" },
        { name: "DEPLOY_BASE_PATH", value: deployBasePath, type: "PLAINTEXT" },
        { name: "DEPLOYMENT_TYPE", value: deploymentType, type: "PLAINTEXT" },
        ...Object.entries(projectEnvVars).map(([k, v]) => ({
          name: k,
          value: String(v),
          type: "PLAINTEXT" as const,
        })),
      ],
    })
  );

  const build = buildResult.build;
  if (build?.id) {
    const uuid = build.id.split(":")[1];
    await client.send(
      new UpdateCommand({
        TableName: Resource.DeploymentsTable.name,
        Key: { id: deploymentId },
        UpdateExpression: "SET codeBuildId = :cbid, codeBuildLogStream = :stream",
        ExpressionAttributeValues: {
          ":cbid": build.id,
          ":stream": uuid ? `build/${uuid}` : (build.logs?.streamName ?? build.id),
        },
      })
    );
  }

  return { status: "building", deploymentId, projectId };
}
