// Vite probes Windows drive mappings with `net use`. Some CI/sandbox hosts
// forbid child processes even though worker threads work. The probe is only an
// optimization, so report it as unavailable and let Vite use native realpath.
if (process.platform === "win32") {
  const childProcess = await import("node:child_process");
  const { syncBuiltinESMExports } = await import("node:module");
  const originalExec = childProcess.default.exec;
  childProcess.default.exec = function contractGuardExec(command, ...args) {
    if (command.trim().toLowerCase() === "net use") {
      const callback = args.at(-1);
      if (typeof callback === "function") {
        queueMicrotask(() => callback(new Error("Windows drive mapping probe disabled"), "", ""));
      }
      return undefined;
    }
    return originalExec.call(this, command, ...args);
  };
  syncBuiltinESMExports();
}

const withCoverage = process.argv.includes("--coverage");
process.argv = [
  process.execPath,
  "vitest",
  "run",
  "--configLoader=native",
  "--pool=threads",
  "--maxWorkers=1",
  ...(withCoverage ? ["--coverage"] : []),
];
await import("vitest/vitest.mjs");
