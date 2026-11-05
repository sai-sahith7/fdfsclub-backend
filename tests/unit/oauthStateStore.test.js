const { CookieStateStore, readCookie, STATE_COOKIE } = require("../../config/oauthStateStore");

function fakeRequest(cookieHeader) {
  const res = { cookie: jest.fn(), clearCookie: jest.fn() };
  return { headers: cookieHeader ? { cookie: cookieHeader } : {}, res };
}

describe("Google sign-in state check", () => {
  const store = new CookieStateStore();

  test("store sets an httpOnly cookie and returns the same state", () => {
    const req = fakeRequest();
    const callback = jest.fn();
    store.store(req, undefined, {}, callback);

    const [, handle] = callback.mock.calls[0];
    expect(handle).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(req.res.cookie).toHaveBeenCalledWith(STATE_COOKIE, handle, expect.objectContaining({ httpOnly: true, sameSite: "lax" }));
  });

  test("verify accepts a state that matches the cookie and clears it", () => {
    const req = fakeRequest(`other=1; ${STATE_COOKIE}=abc123`);
    const callback = jest.fn();
    store.verify(req, "abc123", {}, callback);

    expect(callback).toHaveBeenCalledWith(null, true);
    expect(req.res.clearCookie).toHaveBeenCalledWith(STATE_COOKIE, expect.any(Object));
  });

  test("verify rejects a missing or different state", () => {
    const mismatch = jest.fn();
    store.verify(fakeRequest(`${STATE_COOKIE}=abc123`), "xyz789", {}, mismatch);
    expect(mismatch.mock.calls[0][1]).toBe(false);

    const noCookie = jest.fn();
    store.verify(fakeRequest(), "abc123", {}, noCookie);
    expect(noCookie.mock.calls[0][1]).toBe(false);

    const noState = jest.fn();
    store.verify(fakeRequest(`${STATE_COOKIE}=abc123`), undefined, {}, noState);
    expect(noState.mock.calls[0][1]).toBe(false);
  });

  test("readCookie finds a cookie among others", () => {
    expect(readCookie({ headers: { cookie: "a=1; b=two; c=3" } }, "b")).toBe("two");
    expect(readCookie({ headers: {} }, "b")).toBeNull();
  });
});
