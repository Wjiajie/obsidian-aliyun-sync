import { normalizeVaultPath } from "./path";

export function autoRenamedBaseName(name: string): string | null {
  const hiddenPrefix = name.match(/^\((\d+)\)(\..+)$/);
  if (hiddenPrefix) {
    return hiddenPrefix[2];
  }

  const extensionSuffix = name.match(/^(.+)\((\d+)\)(\.[^.]*)$/);
  if (extensionSuffix) {
    return `${extensionSuffix[1]}${extensionSuffix[3]}`;
  }

  const suffix = name.match(/^(.+)\((\d+)\)$/);
  return suffix ? suffix[1] : null;
}

export function hasAutoRenamedSibling<T extends { name: string }>(item: T, siblings: T[]): boolean {
  const base = autoRenamedBaseName(item.name);
  if (!base) {
    return false;
  }
  return siblings.some((sibling) => sibling.name === base);
}

export function shouldSkipAutoRenamedPath(path: string, exists: (path: string) => boolean): boolean {
  const clean = normalizeVaultPath(path);
  const parts = clean.split("/");
  for (let index = 0; index < parts.length; index++) {
    const baseName = autoRenamedBaseName(parts[index]);
    if (!baseName) {
      continue;
    }
    const candidate = [...parts];
    candidate[index] = baseName;
    if (exists(candidate.slice(0, index + 1).join("/"))) {
      return true;
    }
  }
  return false;
}
