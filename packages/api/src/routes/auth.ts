import { Hono } from "hono";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";
import { randomUUID, createHash } from "node:crypto";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");

function generateToken(): string {
  return randomUUID() + randomUUID();
}

export async function getSessionFromToken(token: string) {
  if (!token) return null;
  try {
    const result = await client.send(
      new GetCommand({ TableName: Resource.SessionsTable.name, Key: { id: token } })
    );
    return result.Item || null;
  } catch {
    return null;
  }
}

// If the request comes from a deployed app (preview/production URL), proxy to its SSR Lambda
// so the app's own auth (Better Auth, etc.) handles it instead of the platform auth.
async function proxyToApp(c: any): Promise<Response | null> {
  const referer = c.req.header("referer") || "";
  let match = referer.match(/\/_preview\/([^/]+)/);
  if (match) {
    const { invokePreviewLambda, lookupPreviewLambda } = await import("./preview");
    const fnName = await lookupPreviewLambda(match[1]);
    if (fnName) return invokePreviewLambda(fnName, c, `/_preview/${match[1]}${c.req.path}`);
  }
  match = referer.match(/\/_production\/([^/]+)/);
  if (match) {
    const { invokePreviewLambda, lookupProductionLambdaByProject } = await import("./preview");
    const fnName = await lookupProductionLambdaByProject(match[1]);
    if (fnName) return invokePreviewLambda(fnName, c, `/_production/${match[1]}${c.req.path}`);
  }
  return null;
}

async function sessionHandler(c: any) {
  // If the request comes from a deployed app, let the app handle auth instead
  const appResult = await proxyToApp(c);
  if (appResult) return appResult;

  const authHeader = c.req.header("authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  const session = await getSessionFromToken(token);
  if (!session) {
    return c.json({ success: false, error: "No session" }, 401);
  }
  return c.json({
    success: true,
    data: {
      userId: session.userId,
      name: session.name,
      avatarUrl: session.avatarUrl,
      login: session.login,
      bypass: session.bypass,
    },
  });
}

export const auth = new Hono()

  .get("/github", async (c) => {
    if (!GITHUB_CLIENT_ID) {
      return c.json({ success: false, error: "GitHub OAuth not configured" }, 400);
    }
    const state = randomUUID();
    const redirectUri = `${APP_URL}/api/auth/github/callback`;
    const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=read:user`;
    return c.redirect(url);
  })

  .get("/github/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      return c.json({ success: false, error: "Missing code or state" }, 400);
    }

    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      return c.json({ success: false, error: "GitHub OAuth not configured" }, 400);
    }

    try {
      // Exchange code for access token
      const tokenRes = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code,
          }),
        }
      );
      const tokenData = await tokenRes.json() as any;
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        return c.json({ success: false, error: "Failed to get access token" }, 400);
      }

      // Get user info
      const userRes = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const user = await userRes.json() as any;

      const token = generateToken();
      const session = {
        id: token,
        userId: `github-${user.id}`,
        name: user.name || user.login,
        email: user.email,
        avatarUrl: user.avatar_url,
        login: user.login,
        bypass: false,
        createdAt: new Date().toISOString(),
      };

      await client.send(
        new PutCommand({ TableName: Resource.SessionsTable.name, Item: session })
      );

      // Redirect to dashboard with token in hash
      return c.redirect(`${APP_URL.replace("api", "")}?token=${token}`);
    } catch (err: any) {
      console.error("GitHub OAuth error:", err.message);
      return c.json({ success: false, error: "OAuth failed" }, 500);
    }
  })

  .get("/session", sessionHandler)
  .get("/me", sessionHandler)

  .post("/bypass", async (c) => {
    const token = generateToken();
    const session = {
      id: token,
      userId: "anonymous",
      name: "Anonymous",
      avatarUrl: null,
      login: null,
      bypass: true,
      createdAt: new Date().toISOString(),
    };

    await client.send(
      new PutCommand({ TableName: Resource.SessionsTable.name, Item: session })
    );

    return c.json({ success: true, data: { token, userId: session.userId, name: session.name } });
  })

  .post("/logout", async (c) => {
    const authHeader = c.req.header("authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (token) {
      try {
        await client.send(
          new DeleteCommand({ TableName: Resource.SessionsTable.name, Key: { id: token } })
        );
      } catch {}
    }
    return c.json({ success: true });
  });
