import type { RemoteMetadata } from "../types";

export function createRemoteMetadata(vaultId: string, deviceId: string, deviceName: string): RemoteMetadata {
  return {
    protocolVersion: 1,
    vaultId,
    updatedAt: Date.now(),
    updatedBy: deviceId,
    devices: {
      [deviceId]: {
        name: deviceName,
        lastSeenAt: Date.now()
      }
    },
    tombstones: {}
  };
}

export function serializeRemoteMetadata(metadata: RemoteMetadata): string {
  return JSON.stringify(metadata, null, 2);
}

export function parseRemoteMetadata(text: string): RemoteMetadata {
  const raw = JSON.parse(text) as Partial<RemoteMetadata>;
  if (raw.protocolVersion !== 1 || typeof raw.vaultId !== "string") {
    throw new Error("云端元数据格式无效");
  }
  return {
    protocolVersion: 1,
    vaultId: raw.vaultId,
    updatedAt: Number(raw.updatedAt ?? 0),
    updatedBy: String(raw.updatedBy ?? ""),
    devices: raw.devices ?? {},
    tombstones: raw.tombstones ?? {}
  };
}
