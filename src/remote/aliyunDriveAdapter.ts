import { requestUrl } from "obsidian";
import { hashBuffer } from "../lib/hash";
import { basename, joinRemotePath, normalizeRemoteRoot, normalizeVaultPath, parentPath } from "../lib/path";
import type { AliyunSyncSettings, AuthState, ConnectivityResult, RemoteAdapter, RemoteEntry, WriteMeta } from "../types";
import { RateLimitQueue } from "./rateLimitQueue";
import { buildOpenListRenewUrl, parseOpenListRenewResponse } from "./openListAuth";

interface AliyunFileInfo {
  drive_id: string;
  file_id: string;
  parent_file_id?: string;
  name: string;
  type: "file" | "folder";
  size?: number;
  created_at?: string;
  updated_at?: string;
  local_modified_at?: string;
  content_hash?: string;
  crc64_hash?: string;
}

interface AliyunListResponse {
  items: AliyunFileInfo[];
  next_marker?: string;
}

interface CreateFileResponse {
  drive_id: string;
  file_id: string;
  parent_file_id: string;
  upload_id: string;
  part_info_list: { part_number: number; upload_url: string; part_size?: number }[];
}

const API = {
  authorize: "https://open.aliyundrive.com/oauth/authorize",
  token: "https://open.aliyundrive.com/oauth/access_token",
  userInfo: "https://open.aliyundrive.com/oauth/users/info",
  driveInfo: "https://open.aliyundrive.com/adrive/v1.0/user/getDriveInfo",
  getByPath: "https://open.aliyundrive.com/adrive/v1.0/openFile/get_by_path",
  list: "https://open.aliyundrive.com/adrive/v1.0/openFile/list",
  create: "https://open.aliyundrive.com/adrive/v1.0/openFile/create",
  complete: "https://open.aliyundrive.com/adrive/v1.0/openFile/complete",
  getDownloadUrl: "https://open.aliyundrive.com/adrive/v1.0/openFile/getDownloadUrl",
  delete: "https://open.aliyundrive.com/adrive/v1.0/openFile/delete",
  move: "https://open.aliyundrive.com/adrive/v1.0/openFile/move",
  update: "https://open.aliyundrive.com/adrive/v1.0/openFile/update"
};

export class AliyunDriveAdapter implements RemoteAdapter {
  readonly kind = "aliyun-drive";
  private queue = new RateLimitQueue(350);
  private driveId?: string;
  private codeVerifier = "";

  constructor(
    private readonly getSettings: () => AliyunSyncSettings,
    private readonly saveAuth: (auth: AuthState) => Promise<void>
  ) {}

  async authenticate(): Promise<void> {
    const settings = this.getSettings();
    if (settings.auth?.refreshToken) {
      await this.renewAuth(settings.auth.refreshToken);
      return;
    }
    if (!settings.clientId) {
      throw new Error("请先在设置中粘贴阿里云盘 Open refresh_token");
    }
    this.codeVerifier = randomString();
    const url = new URL(API.authorize);
    url.searchParams.set("client_id", settings.clientId);
    url.searchParams.set("redirect_uri", settings.redirectUri);
    url.searchParams.set("scope", "user:base,file:all:read,file:all:write");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("code_challenge_method", "plain");
    url.searchParams.set("code_challenge", this.codeVerifier);
    url.searchParams.set("state", settings.deviceId);
    window.open(url.toString());
  }

  async completeOAuth(code: string): Promise<void> {
    const settings = this.getSettings();
    if (!this.codeVerifier) {
      throw new Error("授权会话已丢失，请重新点击登录");
    }
    const response = await requestUrl({
      url: API.token,
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify({
        client_id: settings.clientId,
        grant_type: "authorization_code",
        code,
        code_verifier: this.codeVerifier
      }),
      throw: false
    });
    if (response.status !== 200) {
      throw new Error(`阿里云盘授权失败: ${response.status} ${response.text}`);
    }
    const json = response.json as Record<string, unknown>;
    const accessToken = stringField(json, "access_token");
    const refreshToken = stringField(json, "refresh_token");
    const expiresIn = Number(json.expires_in ?? 7200);
    await this.saveAuth({
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000
    });
    this.codeVerifier = "";
  }

  async refreshAuthIfNeeded(): Promise<void> {
    const auth = this.getSettings().auth;
    if (!auth?.refreshToken) {
      throw new Error("尚未配置阿里云盘 Open refresh_token");
    }
    if (auth.accessToken && Date.now() < auth.expiresAt - 120_000) {
      return;
    }
    await this.renewAuth(auth.refreshToken);
  }

  private async renewAuth(refreshToken: string): Promise<void> {
    const settings = this.getSettings();
    const url = buildOpenListRenewUrl(settings, refreshToken);
    const response = await requestUrl({
      url,
      method: "GET",
      throw: false
    });
    if (response.status !== 200) {
      throw new Error(`阿里云盘 token 续期失败: ${response.status} ${response.text}`);
    }
    const json = response.json as Record<string, unknown>;
    await this.saveAuth(parseOpenListRenewResponse(json, refreshToken));
  }

  async stat(path: string): Promise<RemoteEntry | null> {
    const info = await this.getFileInfoByRemotePath(path);
    return info ? toRemoteEntry(path, info) : null;
  }

  async list(path = ""): Promise<RemoteEntry[]> {
    await this.ensureRoot();
    const rootInfo = await this.getFileInfoByRemotePath(path);
    if (!rootInfo) {
      return [];
    }
    if (rootInfo.type === "file") {
      return [toRemoteEntry(path, rootInfo)];
    }
    const results: RemoteEntry[] = [];
    await this.listRecursive(path, rootInfo.file_id, results);
    return results;
  }

  async read(path: string): Promise<ArrayBuffer> {
    const info = await this.getFileInfoByRemotePath(path);
    if (!info) {
      throw new Error(`云端文件不存在: ${path}`);
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      const downloadUrl = await this.getDownloadUrl(info.file_id);
      const response = await this.queue.enqueue(() =>
        requestUrl({
          url: downloadUrl,
          method: "GET",
          throw: false
        })
      );
      if (response.status === 200 || response.status === 206) {
        return response.arrayBuffer;
      }
      if (attempt === 3 || response.status !== 403) {
        throw new Error(`下载失败: ${path}, ${response.status}`);
      }
      await delay(1000 * attempt);
    }
    throw new Error(`下载失败: ${path}`);
  }

  async write(path: string, data: ArrayBuffer, meta: WriteMeta): Promise<RemoteEntry> {
    await this.ensureRoot();
    const remotePath = normalizeVaultPath(path);
    const existing = await this.getFileInfoByRemotePath(remotePath);
    if (existing) {
      await this.deleteById(existing.file_id);
    }
    const parentId = await this.ensureFolder(parentPath(remotePath));
    const driveId = await this.getDriveId();
    const createResponse = await this.api<CreateFileResponse>(API.create, {
      drive_id: driveId,
      parent_file_id: parentId,
      name: basename(remotePath),
      type: "file",
      size: data.byteLength,
      content_hash: hashBuffer(data),
      content_hash_name: "sha1",
      local_modified_at: new Date(meta.mtime).toISOString(),
      check_name_mode: "ignore"
    });
    for (const part of createResponse.part_info_list) {
      const uploadResponse = await requestUrl({
        url: part.upload_url,
        method: "PUT",
        body: data,
        throw: false
      });
      if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
        throw new Error(`上传分片失败: ${remotePath}, part ${part.part_number}, ${uploadResponse.status} ${uploadResponse.text}`);
      }
    }
    await this.api<Record<string, unknown>>(API.complete, {
      drive_id: driveId,
      file_id: createResponse.file_id,
      upload_id: createResponse.upload_id
    });
    const uploaded = await this.getFileInfoByRemotePath(remotePath);
    if (!uploaded) {
      throw new Error(`上传完成后无法读取云端文件信息: ${remotePath}`);
    }
    return toRemoteEntry(remotePath, uploaded);
  }

  async mkdir(path: string): Promise<RemoteEntry> {
    const id = await this.ensureFolder(path);
    const info = await this.getFileInfoByRemotePath(path);
    if (!info) {
      return {
        path: normalizeVaultPath(path),
        type: "folder",
        size: 0,
        mtime: Date.now(),
        remoteId: id
      };
    }
    return toRemoteEntry(path, info);
  }

  async delete(path: string): Promise<void> {
    const info = await this.getFileInfoByRemotePath(path);
    if (info) {
      await this.deleteById(info.file_id);
    }
  }

  async move(from: string, to: string): Promise<void> {
    const info = await this.getFileInfoByRemotePath(from);
    if (!info) {
      return;
    }
    const driveId = await this.getDriveId();
    const parentId = await this.ensureFolder(parentPath(to));
    await this.api<Record<string, unknown>>(API.move, {
      drive_id: driveId,
      file_id: info.file_id,
      to_parent_file_id: parentId,
      new_name: basename(to)
    });
  }

  async checkConnectivity(): Promise<ConnectivityResult> {
    try {
      await this.refreshAuthIfNeeded();
      await this.api<Record<string, unknown>>(API.userInfo, undefined, "GET");
      await this.ensureRoot();
      return { ok: true, message: "阿里云盘连接成功" };
    } catch (error) {
      return { ok: false, message: String(error instanceof Error ? error.message : error) };
    }
  }

  private async ensureRoot(): Promise<string> {
    return this.ensureFolder("");
  }

  private async ensureFolder(relativePath: string): Promise<string> {
    await this.refreshAuthIfNeeded();
    const root = normalizeRemoteRoot(this.getSettings().remoteRootPath);
    const cleanRelative = normalizeVaultPath(relativePath);
    const fullPath = cleanRelative ? joinRemotePath(root, cleanRelative) : root;
    const existing = await this.getFileInfoByAbsolutePath(fullPath);
    if (existing) {
      if (existing.type !== "folder") {
        throw new Error(`云端路径不是文件夹: ${fullPath}`);
      }
      return existing.file_id;
    }
    const parent = parentPath(fullPath);
    const parentId = parent ? await this.ensureAbsoluteFolder(parent) : "root";
    const driveId = await this.getDriveId();
    const created = await this.api<CreateFileResponse>(API.create, {
      drive_id: driveId,
      parent_file_id: parentId,
      name: basename(fullPath),
      type: "folder",
      check_name_mode: "auto_rename"
    });
    return created.file_id;
  }

  private async ensureAbsoluteFolder(fullPath: string): Promise<string> {
    const existing = await this.getFileInfoByAbsolutePath(fullPath);
    if (existing) {
      return existing.file_id;
    }
    const parent = parentPath(fullPath);
    const parentId = parent ? await this.ensureAbsoluteFolder(parent) : "root";
    const driveId = await this.getDriveId();
    const created = await this.api<CreateFileResponse>(API.create, {
      drive_id: driveId,
      parent_file_id: parentId,
      name: basename(fullPath),
      type: "folder",
      check_name_mode: "auto_rename"
    });
    return created.file_id;
  }

  private async listRecursive(basePath: string, parentId: string, out: RemoteEntry[]): Promise<void> {
    let marker = "";
    do {
      const driveId = await this.getDriveId();
      const result = await this.api<AliyunListResponse>(API.list, {
        drive_id: driveId,
        parent_file_id: parentId,
        limit: 100,
        fields: "file_id,name,type,size,updated_at,local_modified_at,content_hash",
        marker
      });
      marker = result.next_marker ?? "";
      for (const item of result.items ?? []) {
        const childPath = normalizeVaultPath(`${basePath}/${item.name}`);
        const entry = toRemoteEntry(childPath, item);
        out.push(entry);
        if (item.type === "folder") {
          await this.listRecursive(childPath, item.file_id, out);
        }
      }
    } while (marker);
  }

  private async getFileInfoByRemotePath(path: string): Promise<AliyunFileInfo | null> {
    const absolute = joinRemotePath(this.getSettings().remoteRootPath, normalizeVaultPath(path));
    return this.getFileInfoByAbsolutePath(absolute);
  }

  private async getFileInfoByAbsolutePath(path: string): Promise<AliyunFileInfo | null> {
    const driveId = await this.getDriveId();
    const response = await this.queue.enqueue(() =>
      requestUrl({
        url: API.getByPath,
        method: "POST",
        headers: this.authHeaders(),
        contentType: "application/json",
        body: JSON.stringify({
          drive_id: driveId,
          file_path: normalizeRemoteRoot(path),
          fields: "file_id,name,type,size,updated_at,local_modified_at,content_hash"
        }),
        throw: false
      })
    );
    if (response.status === 404) {
      return null;
    }
    if (response.status !== 200) {
      return null;
    }
    return response.json as AliyunFileInfo;
  }

  private async getDownloadUrl(fileId: string): Promise<string> {
    const driveId = await this.getDriveId();
    const response = await this.api<Record<string, unknown>>(API.getDownloadUrl, {
      drive_id: driveId,
      file_id: fileId
    });
    return stringField(response, "url");
  }

  private async deleteById(fileId: string): Promise<void> {
    const driveId = await this.getDriveId();
    await this.api<Record<string, unknown>>(API.delete, {
      drive_id: driveId,
      file_id: fileId
    });
  }

  private async getDriveId(): Promise<string> {
    if (this.driveId) {
      return this.driveId;
    }
    const data = await this.api<Record<string, unknown>>(API.driveInfo, {});
    this.driveId = stringField(data, "default_drive_id");
    return this.driveId;
  }

  private async api<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
    await this.refreshAuthIfNeeded();
    const response = await this.queue.enqueue(() =>
      requestUrl({
        url,
        method,
        headers: this.authHeaders(),
        contentType: "application/json",
        body: body === undefined ? undefined : JSON.stringify(body),
        throw: false
      })
    );
    if (response.status === 429) {
      await delay(1500);
      return this.api<T>(url, body, method);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`阿里云盘请求失败: ${response.status} ${response.text}`);
    }
    return response.json as T;
  }

  private authHeaders(): Record<string, string> {
    const auth = this.getSettings().auth;
    if (!auth?.accessToken) {
      throw new Error("尚未登录阿里云盘");
    }
    return {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json"
    };
  }
}

function toRemoteEntry(relativePath: string, info: AliyunFileInfo): RemoteEntry {
  return {
    path: normalizeVaultPath(relativePath),
    type: info.type === "folder" ? "folder" : "file",
    size: info.type === "folder" ? 0 : Number(info.size ?? 0),
    mtime: info.local_modified_at
      ? new Date(info.local_modified_at).getTime()
      : info.updated_at ? new Date(info.updated_at).getTime() : Date.now(),
    remoteId: info.file_id,
    hash: normalizeSha1(info.content_hash)
  };
}

function normalizeSha1(value: string | undefined): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value) ? value.toUpperCase() : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`阿里云盘响应缺少字段: ${key}`);
  }
  return value;
}

function randomString(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
