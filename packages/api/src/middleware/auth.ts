import { createMiddleware } from "hono/factory";
import { jwt } from "hono/jwt";

// JWT verification using Cognito-issued tokens
export const authMiddleware = createMiddleware(async (c, next) => {
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) {
    return c.json({ success: false, error: "Auth not configured" }, 500);
  }

  const region = userPoolId.split("_")[0];
  const jwksUri = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;

  const jwtMiddleware = jwt({
    secret: jwksUri,
  });

  return jwtMiddleware(c, next);
});
