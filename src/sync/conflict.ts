import { diff3Merge } from "node-diff3";
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
  if (base === undefined) {
    return conflictResult(local, [], remote);
  }
  if (local === base) {
    return { content: remote, conflicted: false };
  }
  if (remote === base) {
    return { content: local, conflicted: false };
  }

  const regions = diff3Merge(
    splitLines(local),
    splitLines(base),
    splitLines(remote),
    { excludeFalseConflicts: true }
  );
  const mergedLines: string[] = [];
  let conflicted = false;

  for (const region of regions) {
    if (region.ok) {
      mergedLines.push(...region.ok);
      continue;
    }
    if (region.conflict) {
      conflicted = true;
      mergedLines.push(
        "`<<<<<<< local`",
        ...region.conflict.a,
        "`||||||| base`",
        ...region.conflict.o,
        "`=======`",
        ...region.conflict.b,
        "`>>>>>>> remote`"
      );
    }
  }

  return { content: mergedLines.join("\n"), conflicted };
}

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function conflictResult(local: string, baseLines: string[], remote: string): MergeResult {
  return {
    content: [
      "`<<<<<<< local`",
      ...splitLines(local),
      "`||||||| base`",
      ...baseLines,
      "`=======`",
      ...splitLines(remote),
      "`>>>>>>> remote`"
    ].join("\n"),
    conflicted: true
  };
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
