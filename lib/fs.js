import { readFile, writeFile, mkdir, access, unlink } from "node:fs/promises";

/**
 * Ensure a directory exists.
 * @param {string} dir
 */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

/**
 * Remove a file if it exists.
 * @param {string} path
 */
export async function removeIfExists(path) {
  try {
    await unlink(path);
  } catch {
    // Ignore errors if file doesn't exist
  }
}

/**
 * Check if a file exists.
 * @param {string} path
 */
export async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read JSON from disk, returning fallback if missing or invalid.
 * @param {string} path
 * @param {unknown} fallback
 */
export async function readJson(path, fallback = {}) {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

/**
 * Write JSON to disk with pretty formatting.
 * @param {string} path
 * @param {unknown} data
 */
export async function writeJson(path, data) {
  const content = JSON.stringify(data, null, 2) + "\n";
  await writeFile(path, content, "utf-8");
}

/**
 * Sanitize a path segment to prevent traversal.
 * @param {string} segment
 */
export function sanitizeSegment(segment) {
  return segment
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}