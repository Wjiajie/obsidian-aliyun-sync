export function normalizeVaultPath(path: string): string {
  const raw = path.replace(/\\/g, "/").trim();
  const parts = raw.split("/").filter((part) => part.length > 0 && part !== ".");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      throw new Error(`Invalid path traversal: ${path}`);
    }
    if (hasControlCharacter(part)) {
      throw new Error(`Invalid control character in path: ${path}`);
    }
    out.push(part);
  }
  return out.join("/");
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) {
      return true;
    }
  }
  return false;
}

export function normalizeRemoteRoot(path: string): string {
  const normalized = `/${normalizeVaultPath(path)}`;
  return normalized === "/" ? "/" : normalized.replace(/\/+$/g, "");
}

export function joinRemotePath(root: string, relativePath: string): string {
  const cleanRoot = normalizeRemoteRoot(root);
  const cleanRelative = normalizeVaultPath(relativePath);
  if (!cleanRelative) {
    return cleanRoot;
  }
  return `${cleanRoot === "/" ? "" : cleanRoot}/${cleanRelative}`;
}

export function parentPath(path: string): string {
  const clean = normalizeVaultPath(path);
  const index = clean.lastIndexOf("/");
  return index === -1 ? "" : clean.slice(0, index);
}

export function basename(path: string): string {
  const clean = normalizeVaultPath(path);
  const index = clean.lastIndexOf("/");
  return index === -1 ? clean : clean.slice(index + 1);
}

export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

export function matchesIgnore(path: string, patterns: string[]): boolean {
  const clean = normalizeVaultPath(path);
  return patterns.some((pattern) => globMatch(clean, normalizeGlob(pattern)));
}

function normalizeGlob(pattern: string): string {
  return pattern.replace(/\\/g, "/").replace(/^\/+/g, "");
}

function globMatch(path: string, pattern: string): boolean {
  const escaped = pattern
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map(escapeRegExp)
        .join("[^/]*")
    )
    .join(".*");
  return new RegExp(`^${escaped}$`).test(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
