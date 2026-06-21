import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";
import { buildOpenListRenewUrl, parseOpenListRenewResponse } from "../src/remote/openListAuth";

describe("OpenList auth helpers", () => {
  it("builds the renew URL expected by OpenList APIPages", () => {
    const url = new URL(buildOpenListRenewUrl(DEFAULT_SETTINGS, "refresh-token"));

    expect(url.origin + url.pathname).toBe("https://api.oplist.org/alicloud/renewapi");
    expect(url.searchParams.get("apps_types")).toBe("alicloud_qr");
    expect(url.searchParams.get("refresh_ui")).toBe("refresh-token");
    expect(url.searchParams.get("server_use")).toBe("true");
  });

  it("keeps an existing refresh token when the renew response does not rotate it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T00:00:00.000Z"));

    const auth = parseOpenListRenewResponse(
      {
        access_token: "access-token",
        expires_in: 3600
      },
      "old-refresh-token"
    );

    expect(auth.accessToken).toBe("access-token");
    expect(auth.refreshToken).toBe("old-refresh-token");
    expect(auth.expiresAt).toBe(new Date("2026-06-21T01:00:00.000Z").getTime());

    vi.useRealTimers();
  });

  it("uses a rotated refresh token when one is returned", () => {
    const auth = parseOpenListRenewResponse(
      {
        access_token: "access-token",
        refresh_token: "new-refresh-token"
      },
      "old-refresh-token"
    );

    expect(auth.refreshToken).toBe("new-refresh-token");
  });
});
