import { Hono } from "hono";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";

const s3 = new S3Client({});
const lambda = new LambdaClient({ maxAttempts: 3 });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    woff2: "font/woff2",
    woff: "font/woff",
    ttf: "font/ttf",
    map: "application/json",
    txt: "text/plain",
    xml: "text/xml",
    webp: "image/webp",
    mjs: "application/javascript",
  };
  return types[ext] || "application/octet-stream";
}

export async function lookupPreviewLambda(
  deploymentId: string
): Promise<string | undefined> {
  try {
    const depResult = await ddb.send(
      new GetCommand({
        TableName: Resource.DeploymentsTable.name,
        Key: { id: deploymentId },
      })
    );
    return depResult.Item?.previewLambda;
  } catch {
    return undefined;
  }
}

async function tryGet(
  deploymentId: string,
  key: string
): Promise<{ body: Uint8Array; contentType: string } | null> {
  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: Resource.AssetsBucket.name,
        Key: `${deploymentId}/${key}`,
      })
    );
    const body = await result.Body?.transformToByteArray();
    if (body)
      return {
        body,
        contentType: result.ContentType || getContentType(key),
      };
  } catch (err: any) {
    console.error(`tryGet S3 error [${deploymentId}/${key}]:`, err.message, err.$metadata?.httpStatusCode || "");
  }
  return null;
}

export async function invokePreviewLambda(
  fnName: string,
  c: any,
  relPath: string
): Promise<Response | null> {
  try {
    const rawQuery = c.req.url.includes("?") ? c.req.url.split("?")[1] : "";
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((v: string, k: string) => { headers[k] = v; });
    const body = await c.req.text().catch(() => "");

    const event = {
      version: "2.0",
      routeKey: "$default",
      rawPath: relPath,
      rawQueryString: rawQuery,
      headers,
      queryStringParameters: Object.fromEntries(new URL(c.req.url).searchParams),
      requestContext: {
        accountId: "anonymous",
        apiId: "preview",
        domainName: headers.host || "preview.local",
        domainPrefix: "preview",
        http: {
          method: c.req.method,
          path: relPath,
          protocol: "HTTP/1.1",
          sourceIp: c.req.header("x-forwarded-for") || "127.0.0.1",
          userAgent: c.req.header("user-agent") || "",
        },
        requestId: crypto.randomUUID(),
        routeKey: "$default",
        stage: "$default",
        time: new Date().toISOString(),
        timeEpoch: Date.now(),
      },
      body: body || null,
      isBase64Encoded: false,
    };

    const result = await lambda.send(
      new InvokeCommand({
        FunctionName: fnName,
        Payload: JSON.stringify(event),
      })
    );

    if (result.FunctionError) {
      console.error("Preview Lambda error:", result.FunctionError);
      return null;
    }

    const response = JSON.parse(Buffer.from(result.Payload).toString());
    const resHeaders: Record<string, string> = {};
    if (response.headers) {
      for (const [k, v] of Object.entries(response.headers)) {
        if (typeof v === "string") resHeaders[k] = v;
      }
    }

    return new Response(
      response.isBase64Encoded
        ? Buffer.from(response.body, "base64")
        : response.body,
      { status: response.statusCode || 200, headers: resHeaders }
    );
  } catch (err: any) {
    console.error("Preview Lambda invoke failed:", err.message);
    return null;
  }
}

export const preview = new Hono()

  .all("/*", async (c) => {
    const path = c.req.path.replace("/_preview/", "");
    const [deploymentId, ...rest] = path.split("/");
    const relPath = "/" + rest.join("/");

    if (!deploymentId) {
      return c.text("Not found", 404);
    }

    const reqPath = relPath.split("?")[0];
    const normalized = reqPath.replace(/^\/_next/, "");
    const isStaticAsset = relPath.startsWith("/_next/static/");

    // Serve Next.js image optimization from S3 (skip Lambda — avoids 400 errors)
    if (reqPath.startsWith("/_next/image")) {
      const imgUrl = c.req.query("url") || "";
      const cleanUrl = imgUrl.replace(/^\/_preview\/[^/]+/, "").replace(/^\//, "");
      const img = await tryGet(deploymentId, `public/${cleanUrl}`);
      if (img) return c.newResponse(img.body, 200, { "Content-Type": img.contentType, "Cache-Control": "public, max-age=31536000, immutable", "x-served-by": "s3-static" });
      // If image not in S3, redirect to the original (served by Lambda or S3)
      // Redirect to the basePath-prefixed URL so preview router serves from S3 or Lambda
      return c.redirect(`/_preview/${deploymentId}${imgUrl.startsWith("/") ? "" : "/"}${imgUrl}`, 302);
    }

    // Only check DynamoDB if we need SSR (skip for static assets and _next/image)
    if (!isStaticAsset) {
      const previewLambda = await lookupPreviewLambda(deploymentId);
      if (previewLambda) {
        const ssrResult = await invokePreviewLambda(previewLambda, c, c.req.path);
        if (ssrResult) {
          ssrResult.headers.set("x-served-by", "ssr-lambda");
          return ssrResult;
        }
      }
    }

    // Fall back to static file serving

    // Root path → serve main HTML
    if (normalized === "/" || normalized === "") {
      const obj = await tryGet(deploymentId, "server/app/index.html");
      if (obj) return c.newResponse(obj.body, 200, { "Content-Type": "text/html", "x-served-by": "s3-static" });
      return c.text("Not found", 404);
    }

    // Try serving a .body file (prerendered response body from Next.js)
    if (!normalized.includes(".")) {
      const bodyFile = await tryGet(deploymentId, `server/app${normalized}.body`);
      if (bodyFile)
        return c.newResponse(bodyFile.body, 200, {
          "Content-Type": bodyFile.contentType,
          "x-served-by": "s3-static",
        });
    }

    // Try exact match in S3 (handles static/... and server/... files)
    const exact = await tryGet(deploymentId, normalized.replace(/^\//, ""));
    if (exact) {
      const headers: Record<string, string> = { "Content-Type": exact.contentType, "x-served-by": "s3-static" };
      if (isStaticAsset) headers["Cache-Control"] = "public, max-age=31536000, immutable";
      return c.newResponse(exact.body, 200, headers);
    }

    // Try as HTML page under server/app/
    if (!normalized.includes(".") && !normalized.startsWith("/api/")) {
      const htmlPage = await tryGet(deploymentId, `server/app${normalized}.html`);
      if (htmlPage)
        return c.newResponse(htmlPage.body, 200, { "Content-Type": "text/html" });
      // SPA fallback — serve root HTML for client-side routing
      const fallback = await tryGet(deploymentId, "server/app/index.html");
      if (fallback)
        return c.newResponse(fallback.body, 200, { "Content-Type": "text/html" });
    }

    return c.text("Not found", 404);
  });

export async function lookupProductionLambdaByProject(
  projectId: string
): Promise<string | undefined> {
  try {
    const depResult = await ddb.send(
      new GetCommand({
        TableName: Resource.ProjectsTable.name,
        Key: { id: projectId },
      })
    );
    return (depResult.Item as any)?.productionLambda;
  } catch {
    return undefined;
  }
}

export const production = new Hono()

  .all("/*", async (c) => {
    const path = c.req.path.replace("/_production/", "");
    const [projectId, ...rest] = path.split("/");
    const relPath = "/" + rest.join("/");

    if (!projectId) {
      return c.text("Not found", 404);
    }

    const reqPath = relPath.split("?")[0];
    const normalized = reqPath.replace(/^\/_next/, "");
    const isStaticAsset = relPath.startsWith("/_next/static/");

    // Serve Next.js image optimization from S3
    if (reqPath.startsWith("/_next/image")) {
      const imgUrl = c.req.query("url") || "";
      const cleanUrl = imgUrl.replace(/^\/_production\/[^/]+/, "").replace(/^\//, "");
      try {
        const pRes = await ddb.send(
          new GetCommand({ TableName: Resource.ProjectsTable.name, Key: { id: projectId } })
        );
        const prodDeploymentId = (pRes.Item as any)?.productionDeploymentId;
        if (prodDeploymentId) {
          const img = await tryGet(prodDeploymentId, `public/${cleanUrl}`);
          if (img) return c.newResponse(img.body, 200, { "Content-Type": img.contentType, "Cache-Control": "public, max-age=31536000, immutable", "x-served-by": "s3-static" });
        }
      } catch {}
      return c.redirect(`/_production/${projectId}${imgUrl.startsWith("/") ? "" : "/"}${imgUrl}`, 302);
    }

    // For static assets, skip Lambda and serve from S3 directly
    if (!isStaticAsset) {
      const fnName = await lookupProductionLambdaByProject(projectId);
      if (fnName) {
        const ssrResult = await invokePreviewLambda(fnName, c, c.req.path);
        if (ssrResult) {
          ssrResult.headers.set("x-served-by", "ssr-lambda");
          return ssrResult;
        }
      }
    }

    // Fallback: serve static files from latest production deployment
    let deploymentId: string | undefined;
    try {
      const depResult = await ddb.send(
        new GetCommand({
          TableName: Resource.ProjectsTable.name,
          Key: { id: projectId },
        })
      );
      deploymentId = (depResult.Item as any)?.productionDeploymentId;
    } catch {}

    if (!deploymentId) return c.text("Not found", 404);

    // Root path → serve main HTML
    if (normalized === "/" || normalized === "") {
      const obj = await tryGet(deploymentId, "server/app/index.html");
      if (obj) return c.newResponse(obj.body, 200, { "Content-Type": "text/html", "x-served-by": "s3-static" });
      return c.text("Not found", 404);
    }

    // Try serving a .body file (prerendered response body from Next.js)
    if (!normalized.includes(".")) {
      const bodyFile = await tryGet(deploymentId, `server/app${normalized}.body`);
      if (bodyFile)
        return c.newResponse(bodyFile.body, 200, {
          "Content-Type": bodyFile.contentType,
          "x-served-by": "s3-static",
        });
    }

    // Try exact match in S3 (handles static/... and server/... files)
    const exact = await tryGet(deploymentId, normalized.replace(/^\//, ""));
    if (exact) {
      const headers: Record<string, string> = { "Content-Type": exact.contentType, "x-served-by": "s3-static" };
      if (isStaticAsset) headers["Cache-Control"] = "public, max-age=31536000, immutable";
      return c.newResponse(exact.body, 200, headers);
    }

    // Try as HTML page under server/app/
    if (!normalized.includes(".") && !normalized.startsWith("/api/")) {
      const htmlPage = await tryGet(deploymentId, `server/app${normalized}.html`);
      if (htmlPage)
        return c.newResponse(htmlPage.body, 200, { "Content-Type": "text/html" });
      const fallback = await tryGet(deploymentId, "server/app/index.html");
      if (fallback)
        return c.newResponse(fallback.body, 200, { "Content-Type": "text/html" });
    }

    return c.text("Not found", 404);
  });
