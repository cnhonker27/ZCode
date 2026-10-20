import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  resolveBigModelApiOrigin,
  resolveRuntimeZCodeEndpointOrigin,
  resolveZaiOAuthClientId,
  resolveZaiOAuthOrigin,
} from "../shared/src/zcodeEndpoint.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const { version } = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));

// 生成 @zcode/shared 的别名。
// 原因：vite 对字符串别名做前缀匹配，若用 "@zcode/shared" 字符串作为根别名，
// 会把 "@zcode/shared/model-config" 这类子路径导入错误替换成
// ".../src/index.ts/model-config"（构建报 os error 3，找不到路径），
// 且实测子路径别名先声明也无法覆盖根别名的前缀匹配。
// 修复依据：根别名改用正则精确匹配 "^@zcode/shared$"（即使正则不被支持，
// 根导入也会经由 node_modules 中的 workspace 链接按 exports 解析到同一目标）；
// 子路径按 packages/shared/package.json 的 exports 逐项显式指向源码，
// 与下方 @zcode/ui 子路径别名的既有做法一致。
// 注意 exports 的 key 形如 "./test-ids"，拼接前必须去掉前导 "./"，
// 否则生成 "@zcode/shared./test-ids"，与真实导入说明符永远不匹配（等于没有别名）。
const sharedPackageJson = JSON.parse(
  readFileSync(resolve(REPO_ROOT, "packages/shared/package.json"), "utf8"),
) as { exports: Record<string, string> };
const sharedAliases = [
  ...Object.entries(sharedPackageJson.exports)
    .filter(([key]) => key !== ".")
    .map(([key, target]) => ({
      find: `@zcode/shared${key.replace(/^\./, "")}`,
      replacement: resolve(REPO_ROOT, "packages/shared", target),
    })),
  {
    find: /^@zcode\/shared$/,
    replacement: resolve(REPO_ROOT, "packages/shared/src/index.ts"),
  },
];

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, REPO_ROOT, ""), ...process.env };
  const zcodeEnv = env.ZCODE_ENV?.trim().toLowerCase() === "production" ? "production" : "test";
  const endpointEnv = { ...env, ZCODE_ENV: zcodeEnv };
  const endpointOrigin = resolveRuntimeZCodeEndpointOrigin(endpointEnv);
  const oauthOrigin = resolveZaiOAuthOrigin(endpointEnv);
  const oauthClientId = resolveZaiOAuthClientId(endpointEnv);
  // BigModel 授权入口必须跟随 ZCODE_ENV，否则测试环境会把测试账号带到生产授权页。
  const bigmodelOAuthOrigin = resolveBigModelApiOrigin(endpointEnv);

  return {
    root: resolve(HERE),
    base: "/cn/share/",
    // Share 复用 Web 的 material-icons 素材，但不复制完整 Web 源码/依赖。
    // 这样 dev:web-share 与 Docker 生产构建都从同一份 public 资源读取图标。
    publicDir: resolve(REPO_ROOT, "packages/web/public"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        // @zcode/shared 的根入口与子路径别名统一由上方 sharedAliases 生成
        // （含 /^@zcode\/shared$/ 精确匹配，等价于上游手写的根条目）。
        ...sharedAliases,
        { find: "@", replacement: resolve(REPO_ROOT, "packages/ui/src") },
        // Share 镜像不安装 @zcode/ui（它会带入 services/rpc 闭包），子路径导入必须显式指向源码。
        {
          find: "@zcode/ui/useTheme",
          replacement: resolve(REPO_ROOT, "packages/ui/src/useTheme.ts"),
        },
        // 以下两条原本是显式登记（历史上 sharedAliases 生成的 find 值带 "./" 前缀、匹配不到导入）。
        // 该缺陷已修复，这两条现在由 sharedAliases 先命中，属于冗余兜底；
        // 保留以维持合并后的既有行为，待 share 构建验证后单独清理。
        // 只读时间线的协议子路径同时是 share 闭包校验关注的入口。
        {
          find: "@zcode/shared/zcode-protocol-v4",
          replacement: resolve(REPO_ROOT, "packages/shared/src/zcode-protocol-v4/index.ts"),
        },
        // Bugfix：test-ids 改为只从子路径导入后，reasoning.tsx、ToolSummaryRow.tsx 等 share 闭包
        // 文件引用了它；镜像没有 packages/ui 的依赖链接，未登记别名时 Docker 构建解析失败。
        {
          find: "@zcode/shared/test-ids",
          replacement: resolve(REPO_ROOT, "packages/shared/src/test-ids.ts"),
        },
        {
          find: "@zcode/ui/conversation-share-readonly",
          replacement: resolve(REPO_ROOT, "packages/share-ui/src/index.ts"),
        },
        // 登录卡片要用 provider 图标（svg 走 @ -> packages/ui/src 别名解析）。
        // 该模块只依赖 shared/lucide/cn，不会把 services/rpc 闭包带进 share 镜像。
        {
          find: "@zcode/ui/oauth-provider-icon",
          replacement: resolve(REPO_ROOT, "packages/ui/src/lib/oauthProviderIcon.tsx"),
        },
      ],
    },
    define: {
      __ZCODE_VERSION__: JSON.stringify(version),
      __ZCODE_COMMIT__: JSON.stringify(env.ZCODE_COMMIT || "unknown"),
      __ZCODE_ENV__: JSON.stringify(zcodeEnv),
      "import.meta.env.VITE_ZCODE_BASE_URL": JSON.stringify(endpointOrigin),
      "import.meta.env.VITE_ZCODE_ENDPOINT_ORIGIN": JSON.stringify(endpointOrigin),
      "import.meta.env.VITE_ZAI_OAUTH_CLIENT_ID": JSON.stringify(oauthClientId),
      "import.meta.env.VITE_ZAI_OAUTH_ORIGIN": JSON.stringify(oauthOrigin),
      "import.meta.env.VITE_BIGMODEL_OAUTH_ORIGIN": JSON.stringify(bigmodelOAuthOrigin),
    },
    build: {
      outDir: resolve(REPO_ROOT, "packages/web-share/dist"),
      emptyOutDir: true,
      sourcemap: mode === "production" ? "hidden" : true,
    },
  };
});
