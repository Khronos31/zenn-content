#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MAPPING_PATH = path.join(ROOT, ".qiita", "items.json");
const TOKEN_PATH = path.join(ROOT, "qiita-token.env");
const API_BASE = "https://qiita.com/api/v2";

function usage() {
  console.error(`Usage: npm run qiita:sync -- <article.md> [--dry-run] [--public|--private]`);
  process.exit(2);
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    throw new Error("記事にYAML frontmatterがありません");
  }

  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        frontmatter[key] = JSON.parse(value);
      } catch {
        frontmatter[key] = value
          .slice(1, -1)
          .split(",")
          .map((item) => parseScalar(item));
      }
    } else {
      frontmatter[key] = parseScalar(value);
    }
  }

  return { frontmatter, body: markdown.slice(match[0].length) };
}

function qiitaBody(body) {
  // Zenn's message container is not part of Qiita's article JSON format.
  return body.replace(/^:::message\s*\n([\s\S]*?)\n:::\s*$/gm, (_, content) =>
    `${content
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\n\n`,
  );
}

function articlePayload(markdown, publicOverride, isUpdate) {
  const { frontmatter, body } = parseFrontmatter(markdown);
  if (typeof frontmatter.title !== "string" || !frontmatter.title) {
    throw new Error("frontmatterのtitleが必要です");
  }
  if (!Array.isArray(frontmatter.topics) || frontmatter.topics.length === 0) {
    throw new Error("frontmatterのtopicsが1つ以上必要です");
  }

  const hasQiitaPublished = Object.hasOwn(frontmatter, "qiita_published");
  if (hasQiitaPublished && typeof frontmatter.qiita_published !== "boolean") {
    throw new Error("frontmatterのqiita_publishedはtrueまたはfalseにしてください");
  }

  // For an existing item, omit `private` unless explicitly controlled. Qiita
  // then preserves a visibility change made in the Qiita UI.
  const privateValue = publicOverride !== undefined
    ? !publicOverride
    : hasQiitaPublished
      ? !frontmatter.qiita_published
      : isUpdate
        ? undefined
        : true;

  return {
    title: frontmatter.title,
    body: qiitaBody(body).trimStart(),
    tags: frontmatter.topics.map((name) => ({ name: String(name) })),
    ...(privateValue === undefined ? {} : { private: privateValue }),
  };
}

function loadToken() {
  if (process.env.QIITA_ACCESS_TOKEN) return process.env.QIITA_ACCESS_TOKEN;
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(`${TOKEN_PATH} がありません。qiita-token.env.exampleをコピーして作成してください`);
  }
  const line = fs
    .readFileSync(TOKEN_PATH, "utf8")
    .split(/\r?\n/)
    .find((candidate) => /^\s*QIITA_ACCESS_TOKEN\s*=/.test(candidate));
  const token = line?.replace(/^\s*QIITA_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
  if (!token) throw new Error("QIITA_ACCESS_TOKENが空です");
  return token;
}

function loadMappings() {
  if (!fs.existsSync(MAPPING_PATH)) return {};
  return JSON.parse(fs.readFileSync(MAPPING_PATH, "utf8"));
}

function saveMappings(mappings) {
  fs.mkdirSync(path.dirname(MAPPING_PATH), { recursive: true });
  fs.writeFileSync(MAPPING_PATH, `${JSON.stringify(mappings, null, 2)}\n`);
}

async function request(method, endpoint, token, payload) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`Qiita API ${response.status}: ${detail}`);
  }
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  const articleArg = args.find((arg) => !arg.startsWith("--"));
  if (!articleArg || args.filter((arg) => arg === "--public" || arg === "--private").length > 1) usage();

  const dryRun = args.includes("--dry-run");
  const publicOverride = args.includes("--public") ? true : args.includes("--private") ? false : undefined;
  const articlePath = path.resolve(ROOT, articleArg);
  if (!articlePath.startsWith(`${ROOT}${path.sep}`) || !articlePath.endsWith(".md")) {
    throw new Error("記事はリポジトリ内のMarkdownファイルを指定してください");
  }
  const relativePath = path.relative(ROOT, articlePath).split(path.sep).join("/");
  const markdown = fs.readFileSync(articlePath, "utf8");
  const mappings = loadMappings();
  const existing = mappings[relativePath];
  const payload = articlePayload(markdown, publicOverride, Boolean(existing?.item_id));

  if (dryRun) {
    console.log(JSON.stringify({ article: relativePath, existing_item_id: existing?.item_id ?? null, payload }, null, 2));
    return;
  }

  const token = loadToken();
  console.log(`${existing?.item_id ? "Updating" : "Creating"} ${relativePath} as ${payload.private ? "private" : "public"}...`);
  const result = existing?.item_id
    ? await request("PATCH", `/items/${encodeURIComponent(existing.item_id)}`, token, payload)
    : await request("POST", "/items", token, payload);

  mappings[relativePath] = {
    item_id: result.id,
    url: result.url,
    title: result.title,
  };
  saveMappings(mappings);
  console.log(`${existing?.item_id ? "Updated" : "Created"}: ${result.url}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
