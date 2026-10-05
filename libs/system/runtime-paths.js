// Where programs started by the web app keep their pid file and output (git-ignored). Relative imports only.
import path from "path";

export const runtimeDir = (cwd = process.cwd()) => path.resolve(cwd, ".runtime");
export const pidFile = (id, cwd = process.cwd()) => path.join(runtimeDir(cwd), `${id}.pid.json`);
export const logFile = (id, cwd = process.cwd()) => path.join(runtimeDir(cwd), `${id}.log`);
