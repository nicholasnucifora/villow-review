import { spawnSync } from "node:child_process";

const targets = {
  production: { worker: "villow-review", config: "wrangler.jsonc" },
  staging: { worker: "villow-review-staging", config: "wrangler.staging.jsonc" },
};

const targetName = process.argv[2] || "production";
const target = targets[targetName];

if (!target) {
  console.error(`Unknown deployment target "${targetName}". Expected production or staging.`);
  process.exit(1);
}

const cloudflareTarget = process.env.WRANGLER_CI_OVERRIDE_NAME?.trim();
if (cloudflareTarget && cloudflareTarget !== target.worker) {
  console.error(
    `Refusing to deploy ${target.worker}: Cloudflare Workers Builds is connected to ${cloudflareTarget}. ` +
    `Connect this repository to the ${target.worker} Worker instead.`,
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["node_modules/wrangler/bin/wrangler.js", "deploy", "--config", target.config],
  { stdio: "inherit", env: process.env },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
