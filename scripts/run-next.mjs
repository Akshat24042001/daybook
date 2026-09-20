// Local launcher for `next dev|build|start`.
// On this machine node_modules is a junction to another drive (D: is nearly full). Next/webpack cannot express
// a path on another drive relative to the project, so when node_modules is a symlink we ask Node to keep the
// symlinked path instead of the real one. Deployments (Vercel) run `next` directly and never use this.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nm = path.join(root, "node_modules");
const linked = fs.existsSync(nm) && fs.lstatSync(nm).isSymbolicLink();

const env = { ...process.env };
if (linked) {
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --preserve-symlinks --preserve-symlinks-main`.trim();
  env.DAYBOOK_LINKED_MODULES = "1";
}

const bin = path.join(nm, "next", "dist", "bin", "next");
const child = spawn(process.execPath, [...(linked ? ["--preserve-symlinks", "--preserve-symlinks-main"] : []), bin, ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
