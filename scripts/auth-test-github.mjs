// Loaded only by the disposable authentication test server, never by the app.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === "https://github.com/login/oauth/access_token") {
    const body = JSON.parse(init.body);
    if (body.code !== "test-link")
      throw new Error("Unexpected test OAuth code");
    return Response.json({ access_token: "test-github-token" });
  }
  if (url.origin === "https://api.github.com") {
    if (
      url.pathname !== "/user" ||
      new Headers(init.headers).get("Authorization") !==
        "Bearer test-github-token"
    )
      throw new Error("Unexpected test GitHub request");
    return Response.json({
      id: 12345,
      login: "test-captain",
      name: "GitHub Captain",
    });
  }
  return originalFetch(input, init);
};
