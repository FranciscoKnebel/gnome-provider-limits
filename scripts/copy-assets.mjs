import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const configPath = path.join(scriptDirectory, "package-assets.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const resolvePath = (relativePath) => path.resolve(repositoryRoot, relativePath);

for (const directory of config.resetDirectories) {
  await rm(resolvePath(directory), { force: true, recursive: true });
}

for (const directory of config.createDirectories) {
  await mkdir(resolvePath(directory), { recursive: true });
}

for (const { source, destination } of config.copy) {
  await cp(resolvePath(source), resolvePath(destination), { recursive: true });
}

for (const file of config.remove) {
  await rm(resolvePath(file), { force: true, recursive: true });
}
