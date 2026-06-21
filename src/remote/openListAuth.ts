import type { AliyunSyncSettings, AuthState } from "../types";

export const DEFAULT_OPENLIST_RENEW_API = "https://api.oplist.org/alicloud/renewapi";
export const DEFAULT_OPENLIST_APPS_TYPE = "alicloud_qr";

export function buildOpenListRenewUrl(settings: AliyunSyncSettings, refreshToken: string): string {
  const base = settings.tokenRefreshApiUrl.trim() || DEFAULT_OPENLIST_RENEW_API;
  const url = new URL(base);
  url.searchParams.set("apps_types", settings.tokenRefreshAppsType.trim() || DEFAULT_OPENLIST_APPS_TYPE);
  url.searchParams.set("refresh_ui", refreshToken);
  url.searchParams.set("server_use", "true");
  return url.toString();
}

export function parseOpenListRenewResponse(payload: Record<string, unknown>, fallbackRefreshToken: string): AuthState {
  const accessToken = stringField(payload, "access_token");
  const refreshToken = typeof payload.refresh_token === "string" && payload.refresh_token
    ? payload.refresh_token
    : fallbackRefreshToken;
  const expiresIn = Number(payload.expires_in ?? 7200);
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Math.max(300, expiresIn) * 1000
  };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    const message = typeof record.text === "string" ? `，服务返回: ${record.text}` : "";
    throw new Error(`OpenList 续期响应缺少字段: ${key}${message}`);
  }
  return value;
}
