import { existsSync } from "fs";
import { resolve } from "path";
import { config } from "dotenv";

const envCandidates = [".env.worktree", ".env"];

for (const filename of envCandidates) {
  const path = resolve(process.cwd(), filename);
  if (existsSync(path)) {
    config({ path });
    break;
  }
}

const frontendPort = process.env.FRONTEND_PORT ?? "3000";
process.env.FRONTEND_ORIGIN ??= `http://localhost:${frontendPort}`;
process.env.PLAYWRIGHT_BASE_URL ??= process.env.FRONTEND_ORIGIN;
