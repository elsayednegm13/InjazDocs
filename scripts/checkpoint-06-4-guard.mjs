import path from "node:path";

const root = path.resolve(process.cwd());
export const perfRoot = path.resolve(root, ".wrangler-perf");
export const developerPersist = path.resolve(root, ".wrangler", "state");

export function assertPerfPath(target) {
  const resolved = path.resolve(target);
  const developer = path.resolve(developerPersist);
  if (resolved === developer || resolved.startsWith(developer + path.sep)) {
    throw new Error("Refusing a path inside the developer D1 persist directory.");
  }
  if (resolved === path.resolve(root, ".wrangler") || resolved.startsWith(path.resolve(root, ".wrangler") + path.sep)) {
    throw new Error("Refusing the developer .wrangler directory.");
  }
  if (resolved !== perfRoot && !resolved.startsWith(perfRoot + path.sep)) {
    throw new Error("Refusing a path outside .wrangler-perf.");
  }
  return resolved;
}
