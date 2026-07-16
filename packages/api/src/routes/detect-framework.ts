import { Hono } from "hono";
import { z } from "zod";

interface FrameworkConfig {
  framework: string;
  buildCommand: string;
  installCommand: string;
  outputDir: string;
}

const KNOWN_FRAMEWORKS: Array<{
  name: string;
  deps: string[];
  buildCommand: string;
  installCommand: string;
  outputDir: string;
}> = [
  {
    name: "Next.js",
    deps: ["next"],
    buildCommand: "npm run build",
    installCommand: "npm ci",
    outputDir: ".next",
  },
  {
    name: "Remix",
    deps: ["@remix-run/react", "@remix-run/node"],
    buildCommand: "npm run build",
    installCommand: "npm ci",
    outputDir: "build",
  },
  {
    name: "Vite",
    deps: ["vite"],
    buildCommand: "npm run build",
    installCommand: "npm ci",
    outputDir: "dist",
  },
  {
    name: "Create React App",
    deps: ["react-scripts"],
    buildCommand: "npm run build",
    installCommand: "npm ci",
    outputDir: "build",
  },
  {
    name: "Astro",
    deps: ["astro"],
    buildCommand: "npm run build",
    installCommand: "npm ci",
    outputDir: "dist",
  },
  {
    name: "SvelteKit",
    deps: ["@sveltejs/kit"],
    buildCommand: "npm run build",
    installCommand: "npm ci",
    outputDir: "build",
  },
  {
    name: "Nuxt",
    deps: ["nuxt"],
    buildCommand: "npm run build",
    installCommand: "npm ci",
    outputDir: "dist",
  },
  {
    name: "Gatsby",
    deps: ["gatsby"],
    buildCommand: "npm run build",
    installCommand: "npm ci",
    outputDir: "public",
  },
  {
    name: "Hugo",
    deps: [],
    buildCommand: "hugo",
    installCommand: "",
    outputDir: "public",
  },
  {
    name: "Static",
    deps: [],
    buildCommand: "",
    installCommand: "",
    outputDir: ".",
  },
];

function detectFramework(pkg: Record<string, any>): FrameworkConfig {
  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  for (const fw of KNOWN_FRAMEWORKS) {
    if (fw.deps.length === 0) continue;
    if (fw.deps.some((dep) => dep in allDeps)) {
      if (pkg.scripts?.build) {
        return { ...fw, buildCommand: pkg.scripts.build };
      }
      return fw;
    }
  }

  if (pkg.scripts?.build) {
    return {
      framework: "custom",
      buildCommand: pkg.scripts.build,
      installCommand: "npm ci",
      outputDir: pkg.scripts.build.includes("dist") ? "dist" : "build",
    };
  }

  return {
    framework: "static",
    buildCommand: "",
    installCommand: "",
    outputDir: ".",
  };
}

const detectSchema = z.object({
  repoUrl: z.string().url().optional(),
  packageJson: z.record(z.any()).optional(),
});

export const detectFrameworkRouter = new Hono()
  .post("/detect-framework", async (c) => {
    const body = await c.req.json();
    const parsed = detectSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, error: parsed.error.message }, 400);
    }

    let pkg: Record<string, any>;

    if (parsed.data.packageJson) {
      pkg = parsed.data.packageJson;
    } else if (parsed.data.repoUrl) {
      try {
        const rawUrl = parsed.data.repoUrl
          .replace("https://github.com/", "https://raw.githubusercontent.com/")
          .replace(/\.git$/, "")
          + "/main/package.json";
        const res = await fetch(rawUrl);
        if (!res.ok) {
          return c.json({ success: false, error: "Could not fetch package.json" }, 400);
        }
        pkg = await res.json();
      } catch {
        return c.json({ success: false, error: "Could not fetch package.json" }, 400);
      }
    } else {
      return c.json({ success: false, error: "Provide repoUrl or packageJson" }, 400);
    }

    const result = detectFramework(pkg);
    return c.json({ success: true, data: result });
  });
