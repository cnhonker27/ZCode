import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const isolationKeys = [
  "ZCODE_DATA_BASE_DIR",
  "ZCODE_DESKTOP_HOME_DIR",
  "ZCODE_STORAGE_DIR",
  "ZCODE_SESSION_DB_PATH",
  "ZCODE_SESSION_DB",
];

async function launch(mode, overrides = {}) {
  const env = { ...process.env };
  for (const key of isolationKeys) delete env[key];
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--input-type=module",
      "-e",
      `
        import { EventEmitter } from "node:events";
        import { mock } from "node:test";
        import * as childProcess from "node:child_process";
        mock.module("node:child_process", { namedExports: {
          ...childProcess,
          spawn: (command, args, options) => {
            console.log(JSON.stringify(Object.fromEntries(
              ${JSON.stringify(isolationKeys)}.filter(key => options.env[key] !== undefined)
                .map(key => [key, options.env[key]])
            )));
            const child = new EventEmitter();
            queueMicrotask(() => child.emit("exit", 0, null));
            return child;
          },
        }});
        mock.module("./packages/desktop/scripts/computer-use-producer.mjs", { namedExports: {
          isRealComputerUseProducerInstalled: () => false,
        }});
        process.argv = [process.execPath, "scripts/dev-desktop-env.mjs", ${JSON.stringify(mode)}];
        await import("./scripts/dev-desktop-env.mjs");
      `,
    ],
    { cwd: repositoryRoot, env: { ...env, ...overrides } },
  );
  const environments = stdout
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line));
  assert.equal(
    environments.length,
    3,
    "pre-dev, CLI build and Electron must all receive the environment",
  );
  for (const environment of environments) assert.deepEqual(environment, environments[0]);
  return environments[0];
}

test("test launch isolates CLI output and SQLite along with Desktop data", async () => {
  const home = join(homedir(), ".zcode-dev-home");
  assert.deepEqual(await launch("test"), {
    ZCODE_DATA_BASE_DIR: home,
    ZCODE_DESKTOP_HOME_DIR: home,
    ZCODE_STORAGE_DIR: join(home, ".zcode"),
    ZCODE_SESSION_DB_PATH: join(home, ".zcode", "cli", "db", "db.sqlite"),
  });
});

test("custom data home including spaces drives every default path", async () => {
  const home = resolve("fixtures/dev home");
  assert.deepEqual(await launch("test", { ZCODE_DATA_BASE_DIR: ` ${home} ` }), {
    ZCODE_DATA_BASE_DIR: home,
    ZCODE_DESKTOP_HOME_DIR: home,
    ZCODE_STORAGE_DIR: join(home, ".zcode"),
    ZCODE_SESSION_DB_PATH: join(home, ".zcode", "cli", "db", "db.sqlite"),
  });
});

test("explicit CLI root also relocates the default database", async () => {
  const home = resolve("fixtures/dev-home");
  const storage = resolve("fixtures/custom-storage");
  const desktopHome = resolve("fixtures/settings-home");
  assert.deepEqual(
    await launch("test", {
      ZCODE_DATA_BASE_DIR: home,
      ZCODE_DESKTOP_HOME_DIR: ` ${desktopHome} `,
      ZCODE_STORAGE_DIR: ` ${storage} `,
    }),
    {
      ZCODE_DATA_BASE_DIR: home,
      ZCODE_DESKTOP_HOME_DIR: desktopHome,
      ZCODE_STORAGE_DIR: storage,
      ZCODE_SESSION_DB_PATH: join(storage, "cli", "db", "db.sqlite"),
    },
  );
});

test("explicit database path wins over the legacy database alias", async () => {
  const db = resolve("fixtures/custom.sqlite");
  const legacy = resolve("fixtures/legacy.sqlite");
  const result = await launch("test", {
    ZCODE_SESSION_DB_PATH: ` ${db} `,
    ZCODE_SESSION_DB: legacy,
  });
  assert.equal(result.ZCODE_SESSION_DB_PATH, db);
  assert.equal(result.ZCODE_SESSION_DB, db);
});

test("legacy explicit database alias is retained as the effective database", async () => {
  const db = resolve("fixtures/legacy.sqlite");
  const result = await launch("test", { ZCODE_SESSION_DB: ` ${db} ` });
  assert.equal(result.ZCODE_SESSION_DB_PATH, db);
});

test("blank overrides do not disable isolation defaults", async () => {
  const home = join(homedir(), ".zcode-dev-home");
  const result = await launch("test", Object.fromEntries(isolationKeys.map((key) => [key, " "])));
  assert.equal(result.ZCODE_DATA_BASE_DIR, home);
  assert.equal(result.ZCODE_DESKTOP_HOME_DIR, home);
  assert.equal(result.ZCODE_STORAGE_DIR, join(home, ".zcode"));
  assert.equal(result.ZCODE_SESSION_DB_PATH, join(home, ".zcode", "cli", "db", "db.sqlite"));
});

test("production without a data home does not introduce isolation variables", async () => {
  assert.deepEqual(await launch("production"), {});
});

test("production with an explicit data home uses the same isolation rules", async () => {
  const home = resolve("fixtures/production-home");
  assert.deepEqual(await launch("production", { ZCODE_DATA_BASE_DIR: home }), {
    ZCODE_DATA_BASE_DIR: home,
    ZCODE_DESKTOP_HOME_DIR: home,
    ZCODE_STORAGE_DIR: join(home, ".zcode"),
    ZCODE_SESSION_DB_PATH: join(home, ".zcode", "cli", "db", "db.sqlite"),
  });
});
