import { basename, isMarkdownPath, parentPath } from "../lib/path";

export interface MergeResult {
  content: string;
  conflicted: boolean;
}

export function canMergeMarkdown(path: string, size: number, limit: number): boolean {
  return isMarkdownPath(path) && size <= limit;
}

export function createConflictPath(path: string, deviceName: string, now = new Date()): string {
  const dir = parentPath(path);
  const name = basename(path);
  const stamp = formatStamp(now);
  const safeDevice = deviceName.replace(/[^\w.-]+/g, "-") || "device";
  const dot = name.lastIndexOf(".");
  const conflictName =
    dot > 0
      ? `${name.slice(0, dot)}.conflict.${safeDevice}.${stamp}${name.slice(dot)}`
      : `${name}.conflict.${safeDevice}.${stamp}`;
  return dir ? `${dir}/${conflictName}` : conflictName;
}

export function createConflictArchivePath(path: string, deviceName: string, now = new Date()): string {
  return `.obsidian-aliyun-sync/conflicts/${createConflictPath(path, deviceName, now)}`;
}

export function mergeMarkdown(base: string | undefined, local: string, remote: string): MergeResult {
  if (local === remote) {
    return { content: local, conflicted: false };
  }
  if (base !== undefined) {
    if (local === base) {
      return { content: remote, conflicted: false };
    }
    if (remote === base) {
      return { content: local, conflicted: false };
    }
    const localLines = local.split(/\r?\n/);
    const remoteLines = remote.split(/\r?\n/);
    const baseLines = base.split(/\r?\n/);
    if (isOnlyAppending(baseLines, localLines) && isOnlyAppending(baseLines, remoteLines)) {
      const merged = [
        ...baseLines,
        ...localLines.slice(baseLines.length),
        ...remoteLines.slice(baseLines.length)
      ].join("\n");
      return { content: merged, conflicted: false };
    }
  }
  return {
    content: [
      "`<<<<<<< local`",
      local,
      "`=======`",
      remote,
      "`>>>>>>> remote`"
    ].join("\n"),
    conflicted: true
  };
}

function isOnlyAppending(base: string[], candidate: string[]): boolean {
  if (candidate.length < base.length) {
    return false;
  }
  return base.every((line, index) => candidate[index] === line);
}

function formatStamp(date: Date): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}
