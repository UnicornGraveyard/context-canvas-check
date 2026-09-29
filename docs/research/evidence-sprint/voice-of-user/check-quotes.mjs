#!/usr/bin/env node
// check-quotes.mjs: confirm that every quote in quotes.json appears on its source page.
//
// Usage:   node check-quotes.mjs [path/to/quotes.json]
// Needs:   Node 20+ (global fetch). No dependencies.
// Env:     GITHUB_TOKEN (optional). Raises the GitHub API rate limit and enables the GraphQL
//          route for GitHub Discussions. Without it, discussions are checked against their HTML page.
//
// How each URL is fetched:
//   github.com/.../issues/N[#issuecomment-ID]  REST API: the issue (title + body), the named comment,
//                                              then all comments if the quote is still not found
//   github.com/.../discussions/N               GraphQL with a token, else the HTML page
//   reddit.com/...                             <url>.json, falling back to <url>.rss (Reddit blocks
//                                              anonymous .json from many networks)
//   news.ycombinator.com/item?id=N             hn.algolia.com/api/v1/items/N (item + all replies)
//   forum.cursor.com/t/<slug>/<id>[/<post>]    Discourse /t/<id>.json?print=true, plus
//                                              /posts/by_number/<id>/<post>.json when a post is named
//   anything else                              plain fetch of the page
//
// Matching: HTML tags are stripped and entities decoded. Then both the page text and the quote are
// normalized the same way: lower case, whitespace collapsed, curly quotes made straight, en and em
// dashes made "-", "..." for the ellipsis character, and the markdown characters ` * \ removed
// (they don't show in rendered text). A quote counts as verified when it is a substring of the
// normalized page text.
//
// Exit code is always 0. Network failures are reported as "unreachable", not as failures.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const quotesPath = process.argv[2] ?? path.join(here, "quotes.json");
const UA = "context-canvas-evidence-sprint/1.0 (quote checker; read-only)";
const DELAY_MS = 1200; // polite delay between requests
const REDDIT_DELAY_MS = 20000; // Reddit rate-limits anonymous clients hard
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Unreachable extends Error {}

async function fetchWithRetry(url, { accept = "*/*", headers = {}, method = "GET", body } = {}, tries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { "User-Agent": UA, Accept: accept, ...headers },
        signal: AbortSignal.timeout(25000),
        redirect: "follow",
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Unreachable(`HTTP ${res.status}`);
        if (attempt < tries) {
          // Honor Retry-After when given; Reddit's anonymous limit needs about a minute.
          const retryAfter = Number(res.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 120) * 1000 : (res.status === 429 ? 20000 : 3000) * attempt * attempt;
          await sleep(Math.min(wait, 120000));
        }
        continue;
      }
      return res;
    } catch (err) {
      lastErr = new Unreachable(err?.name === "TimeoutError" ? "timeout" : String(err?.message ?? err));
      await sleep(2000 * attempt);
    }
  }
  throw lastErr ?? new Unreachable("unknown network error");
}

async function getJson(url, opts = {}) {
  const res = await fetchWithRetry(url, { accept: "application/json", ...opts });
  if (!res.ok) throw new Unreachable(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url, opts = {}) {
  const res = await fetchWithRetry(url, opts);
  if (!res.ok) throw new Unreachable(`HTTP ${res.status}`);
  return res.text();
}

// ---------- text normalization ----------

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

// Block-level tags become a space; inline tags (code, a, em, strong...) vanish, as in rendered text.
const BLOCK_TAG = /<\/?(p|br|hr|li|ul|ol|div|h[1-6]|tr|td|th|table|thead|tbody|pre|blockquote|section|article|header|footer|details|summary)\b[^>]*>/gi;

function stripHtml(s) {
  return decodeEntities(
    s
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(BLOCK_TAG, " ")
      .replace(/<[^>]+>/g, ""),
  );
}

function normalize(s) {
  return decodeEntities(String(s ?? ""))
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[`*\\]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/[\s ​]+/g, " ")
    .trim()
    .toLowerCase();
}

// ---------- per-source fetchers: each returns an array of text chunks ----------

function ghHeaders() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" } : { "X-GitHub-Api-Version": "2022-11-28" };
}

async function githubIssue(u, quoteNorm) {
  const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)/);
  const [, owner, repo, , num] = m;
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const chunks = [];
  const cm = u.hash.match(/issuecomment-(\d+)/);
  if (cm) {
    const c = await getJson(`${api}/issues/comments/${cm[1]}`, { headers: ghHeaders() });
    chunks.push(c.body ?? "");
    if (normalize(chunks.join(" ")).includes(quoteNorm)) return { chunks, method: "github-api comment" };
  }
  const issue = await getJson(`${api}/issues/${num}`, { headers: ghHeaders() });
  chunks.push(issue.title ?? "", issue.body ?? "");
  if (normalize(chunks.join(" ")).includes(quoteNorm)) return { chunks, method: "github-api issue" };
  for (let page = 1; page <= 10; page++) {
    await sleep(DELAY_MS);
    const cs = await getJson(`${api}/issues/${num}/comments?per_page=100&page=${page}`, { headers: ghHeaders() });
    for (const c of cs) chunks.push(c.body ?? "");
    if (cs.length < 100) break;
  }
  return { chunks, method: "github-api issue+comments" };
}

async function githubDiscussion(u) {
  const m = u.pathname.match(/^\/(?:orgs\/([^/]+)|([^/]+)\/([^/]+))\/discussions\/(\d+)/);
  const num = Number(m[4]);
  const owner = m[1] ?? m[2];
  const repo = m[1] ? "community" : m[3];
  if (TOKEN) {
    const query = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){discussion(number:$n){title body comments(first:100){nodes{body replies(first:100){nodes{body}}}}}}}`;
    const res = await fetchWithRetry("https://api.github.com/graphql", {
      method: "POST",
      accept: "application/json",
      headers: { ...ghHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { o: owner, r: repo, n: num } }),
    });
    if (res.ok) {
      const d = (await res.json())?.data?.repository?.discussion;
      if (d) {
        const chunks = [d.title, d.body];
        for (const c of d.comments.nodes) {
          chunks.push(c.body);
          for (const r of c.replies.nodes) chunks.push(r.body);
        }
        return { chunks, method: "github-graphql discussion" };
      }
    }
  }
  const html = await getText(`https://github.com${u.pathname}`, { accept: "text/html" });
  return { chunks: [stripHtml(html)], method: "github discussion html" };
}

function redditCollect(node, out) {
  if (Array.isArray(node)) return node.forEach((n) => redditCollect(n, out));
  if (!node || typeof node !== "object") return;
  const d = node.data;
  if (d) {
    if (d.title) out.push(d.title);
    if (d.selftext) out.push(d.selftext);
    if (d.body) out.push(d.body);
    if (d.children) redditCollect(d.children, out);
    if (d.replies) redditCollect(d.replies, out);
  }
}

async function reddit(u) {
  const base = `https://www.reddit.com${u.pathname.replace(/\/$/, "")}`;
  try {
    const res = await fetchWithRetry(`${base}.json?limit=500&raw_json=1`, { accept: "application/json" }, 2);
    if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) {
      const out = [];
      redditCollect(await res.json(), out);
      return { chunks: out, method: "reddit json" };
    }
  } catch {
    // fall through to RSS
  }
  await sleep(REDDIT_DELAY_MS);
  const xml = await getText(`${base}/.rss?limit=500`, { accept: "application/atom+xml" });
  const chunks = [];
  for (const m of xml.matchAll(/<title>([\s\S]*?)<\/title>|<content type="html">([\s\S]*?)<\/content>/g)) {
    chunks.push(stripHtml(decodeEntities(m[1] ?? m[2] ?? "")));
  }
  if (!chunks.length) throw new Unreachable("reddit returned no entries");
  return { chunks, method: "reddit rss" };
}

function hnCollect(item, out) {
  if (!item) return;
  if (item.title) out.push(item.title);
  if (item.text) out.push(stripHtml(item.text));
  for (const c of item.children ?? []) hnCollect(c, out);
}

async function hackerNews(u) {
  const id = u.searchParams.get("id");
  const item = await getJson(`https://hn.algolia.com/api/v1/items/${id}`);
  const out = [];
  hnCollect(item, out);
  return { chunks: out, method: "hn algolia" };
}

async function cursorForum(u) {
  const m = u.pathname.match(/^\/t\/(?:[^/]+\/)?(\d+)(?:\/(\d+))?/);
  const [, topicId, postNumber] = m;
  const chunks = [];
  const t = await getJson(`https://forum.cursor.com/t/${topicId}.json?print=true`);
  chunks.push(t.title ?? "");
  for (const p of t.post_stream?.posts ?? []) chunks.push(stripHtml(p.cooked ?? ""));
  if (postNumber) {
    await sleep(DELAY_MS);
    try {
      const p = await getJson(`https://forum.cursor.com/posts/by_number/${topicId}/${postNumber}.json`);
      chunks.push(stripHtml(p.cooked ?? ""), p.raw ?? "");
    } catch {
      // the topic JSON usually already holds the post
    }
  }
  return { chunks, method: "discourse json" };
}

async function plainPage(u) {
  const html = await getText(u.href, { accept: "text/html" });
  return { chunks: [stripHtml(html)], method: "html" };
}

async function fetchChunks(url, quoteNorm) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  if (host === "github.com" && /\/(issues|pull)\/\d+/.test(u.pathname)) return githubIssue(u, quoteNorm);
  if (host === "github.com" && /\/discussions\/\d+/.test(u.pathname)) return githubDiscussion(u);
  if (host.endsWith("reddit.com")) return reddit(u);
  if (host === "news.ycombinator.com") return hackerNews(u);
  if (host === "forum.cursor.com" && u.pathname.startsWith("/t/")) return cursorForum(u);
  return plainPage(u);
}

// ---------- main ----------

const quotes = JSON.parse(await readFile(quotesPath, "utf8"));
const rows = [];
let verified = 0;
let unreachable = 0;

for (const q of quotes) {
  const quoteNorm = normalize(q.quote);
  let status;
  let method = "";
  try {
    const { chunks, method: how } = await fetchChunks(q.url, quoteNorm);
    method = how;
    const hay = normalize(chunks.join(" \n "));
    status = hay.includes(quoteNorm) ? "verified" : "NOT FOUND";
  } catch (err) {
    status = "unreachable";
    method = err instanceof Unreachable ? err.message : String(err?.message ?? err);
  }
  if (status === "verified") verified++;
  if (status === "unreachable") unreachable++;
  rows.push({ id: q.id, source: q.source ?? "", status, method });
  process.stderr.write(`${q.id} ${status}\n`);
  await sleep(new URL(q.url).hostname.includes("reddit.com") ? REDDIT_DELAY_MS : DELAY_MS);
}

const w = { id: 5, source: 40, status: 12 };
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`${pad("id", w.id)} | ${pad("source", w.source)} | ${pad("status", w.status)} | method`);
console.log(`${"-".repeat(w.id)}-+-${"-".repeat(w.source)}-+-${"-".repeat(w.status)}-+-${"-".repeat(28)}`);
for (const r of rows) console.log(`${pad(r.id, w.id)} | ${pad(r.source, w.source)} | ${pad(r.status, w.status)} | ${r.method}`);
console.log("");
if (unreachable) console.log(`unreachable: ${unreachable} (network or rate limit; re-run later)`);
console.log(`verified ${verified} of ${quotes.length}`);
process.exitCode = 0;
