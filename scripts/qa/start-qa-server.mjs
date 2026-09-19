import { spawn, spawnSync } from "node:child_process";

const env = { ...process.env, NEXT_DIST_DIR: ".next-qa" };
const nextCli = "node_modules/next/dist/bin/next";
const build = spawnSync(process.execPath, [nextCli, "build"], { cwd: process.cwd(), env, stdio: "inherit" });
if (build.status !== 0) process.exit(build.status ?? 1);

const server = spawn(process.execPath, [nextCli, "start"], { cwd: process.cwd(), env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
server.on("exit", (code) => process.exit(code ?? 1));
