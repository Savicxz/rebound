const { spawnSync } = require("node:child_process");
const { existsSync, cpSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const dist = path.join(root, ".next-production");
const result = spawnSync(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "build"],
  {
    cwd: root,
    env: { ...process.env, REBOUND_NEXT_DIST_DIR: ".next-production" },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
// Standalone output excludes static/public files; package them for the launcher.
const standalone = path.join(dist, "standalone");
mkdirSync(path.join(standalone, ".next-production"), { recursive: true });
cpSync(
  path.join(dist, "static"),
  path.join(standalone, ".next-production/static"),
  { recursive: true },
);
if (existsSync(path.join(root, "public")))
  cpSync(path.join(root, "public"), path.join(standalone, "public"), {
    recursive: true,
  });
