// SPDX-License-Identifier: MIT
// Pons Family: knowledge base loader and search for Jay, the pons.family support agent.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** One `##`-level (or top `#`) section of a knowledge file. */
export interface PonsKnowledgeSection {
  file: string;
  heading: string;
  body: string;
}

/** The whole knowledge base, both as one prompt block and as searchable sections. */
export interface PonsKnowledgeBase {
  /** Concatenated markdown, byte-stable across runs so the prompt cache hits. */
  fullText: string;
  sections: PonsKnowledgeSection[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** `knowledge/` sits at the repo root, two levels above both `src/knowledge` and `dist/knowledge`. */
export const DEFAULT_KNOWLEDGE_DIR = path.resolve(here, "..", "..", "knowledge");

/**
 * Load every `*.md` file from the knowledge directory in filename order.
 *
 * Why the files are sorted and concatenated verbatim: the full text goes into
 * the cached system prompt. Any byte change (including ordering) invalidates
 * the cache, so ordering is made deterministic by the numeric filename prefix.
 */
export function loadKnowledgeBase(dir = DEFAULT_KNOWLEDGE_DIR): PonsKnowledgeBase {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  const sections: PonsKnowledgeSection[] = [];
  const parts: string[] = [];
  for (const file of files) {
    const raw = readFileSync(path.join(dir, file), "utf8").trim();
    parts.push(`<doc file="${file}">\n${raw}\n</doc>`);
    sections.push(...splitSections(file, raw));
  }
  return { fullText: parts.join("\n\n"), sections };
}

function splitSections(file: string, raw: string): PonsKnowledgeSection[] {
  const out: PonsKnowledgeSection[] = [];
  let title = file;
  let heading = file;
  let buf: string[] = [];
  const flush = () => {
    const body = buf.join("\n").trim();
    if (body) out.push({ file, heading, body });
    buf = [];
  };
  for (const line of raw.split("\n")) {
    const h1 = /^#\s+(.*)/.exec(line);
    const h2 = /^##\s+(.*)/.exec(line);
    if (h1) {
      flush();
      title = h1[1]!.trim();
      heading = title;
    } else if (h2) {
      flush();
      heading = `${title} / ${h2[1]!.trim()}`;
    } else {
      buf.push(line);
    }
  }
  flush();
  return out;
}

const STOPWORDS = new Set(
  "a an and are as at be but by can do for from how i if in is it my of on or so the to what when where which why with you your me we our this that".split(
    " ",
  ),
);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9%.\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Rank sections by term overlap with the query.
 *
 * Why not embeddings: the knowledge base is a few kilobytes and already sits
 * in the prompt. This tool exists so the model can cite a precise section and
 * so evals can check retrieval. A dependency-free lexical score is enough.
 */
export function searchKnowledge(kb: PonsKnowledgeBase, query: string, limit = 3) {
  const terms = tokenize(query);
  if (!terms.length) return [];
  return kb.sections
    .map((s) => {
      const hay = tokenize(`${s.heading} ${s.heading} ${s.body}`);
      let score = 0;
      for (const t of terms) for (const h of hay) if (h === t || h.startsWith(t)) score++;
      return { section: s, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.section);
}
