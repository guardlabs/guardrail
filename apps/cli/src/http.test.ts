import { describe, expect, it, vi } from "vitest";
import { fetchJson } from "./http.js";

describe("cli http", () => {
  it("does not force json content-type when the request has no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    vi.stubGlobal("fetch", fetchMock);

    await fetchJson("http://127.0.0.1:3000/test", {
      method: "POST",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/test",
      expect.objectContaining({
        method: "POST",
        headers: undefined,
      }),
    );
  });
});
