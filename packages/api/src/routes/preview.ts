import { Hono } from "hono";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";

const s3 = new S3Client({});
const lambda = new LambdaClient({});
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
  } catch {}
  return null;
}

async function invokePreviewLambda(
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

  .get("/*", async (c) => {
    const path = c.req.path.replace("/_preview/", "");
    const [deploymentId, ...rest] = path.split("/");
    const relPath = "/" + rest.join("/");

    if (!deploymentId) {
      return c.text("Not found", 404);
    }

    const reqPath = relPath.split("?")[0];
    const normalized = reqPath.replace(/^\/_next/, "");
    const isStaticAsset = relPath.startsWith("/_next/static/");

    // Check if this deployment has a preview Lambda for SSR
    let previewLambda: string | undefined;
    try {
      const depResult = await ddb.send(
        new GetCommand({
          TableName: Resource.DeploymentsTable.name,
          Key: { id: deploymentId },
        })
      );
      previewLambda = depResult.Item?.previewLambda;
    } catch {}
    if (previewLambda && !isStaticAsset) {
      const ssrResult = await invokePreviewLambda(previewLambda, c, relPath);
      if (ssrResult) return ssrResult;
    }

    // Fall back to static file serving

    // Root path → serve main HTML
    if (normalized === "/" || normalized === "") {
      const obj = await tryGet(deploymentId, "server/app/index.html");
      if (obj) return c.newResponse(obj.body, 200, { "Content-Type": "text/html" });
      return c.text("Not found", 404);
    }

    // Try serving a .body file (prerendered response body from Next.js)
    if (!normalized.includes(".")) {
      const bodyFile = await tryGet(deploymentId, `server/app${normalized}.body`);
      if (bodyFile)
        return c.newResponse(bodyFile.body, 200, {
          "Content-Type": bodyFile.contentType,
        });
    }

    // Try exact match in S3 (handles static/... and server/... files)
    const exact = await tryGet(deploymentId, normalized.replace(/^\//, ""));
    if (exact)
      return c.newResponse(exact.body, 200, { "Content-Type": exact.contentType });

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
