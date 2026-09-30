// Loaded only by the disposable authentication test server, never by the app.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.href === "https://github.com/login/oauth/access_token") {
    const body = JSON.parse(init.body);
    if (body.client_id === "test-app-client") {
      if (
        body.client_secret !== "test-app-secret" ||
        !body.code_verifier ||
        !body.redirect_uri.endsWith("/api/github/app/callback")
      )
        throw new Error("Incomplete test GitHub App token exchange");
      const errors = {
        "test-app-bad-client": "incorrect_client_credentials",
        "test-app-bad-redirect": "redirect_uri_mismatch",
        "test-app-bad-code": "bad_verification_code",
        "test-app-email": "unverified_user_email",
        "test-app-unknown-error": "unexpected-provider-error",
      };
      if (Object.hasOwn(errors, body.code))
        return Response.json({
          error: errors[body.code],
          error_description: "provider-secret-must-not-be-exposed",
        });
      if (
        ![
          "test-app-link",
          "test-app-install",
          "test-app-installed",
          "test-app-conflict",
        ].includes(body.code)
      )
        throw new Error("Unexpected test GitHub App code");
      return Response.json({
        access_token: body.code,
        token_type: "bearer",
        expires_in: 28800,
        refresh_token: "test-app-refresh",
        refresh_token_expires_in: 15897600,
      });
    }
    if (body.code !== "test-link")
      throw new Error("Unexpected test OAuth code");
    return Response.json({ access_token: "test-github-token" });
  }
  if (url.origin === "https://api.github.com") {
    const token = new Headers(init.headers)
      .get("Authorization")
      ?.replace(/^Bearer /, "");
    if (
      [
        "test-app-link",
        "test-app-install",
        "test-app-installed",
        "test-app-conflict",
      ].includes(token)
    ) {
      if (url.pathname === "/user")
        return Response.json({
          id:
            token === "test-app-conflict"
              ? 45678
              : token === "test-app-link"
                ? 23456
                : 34567,
          login: token === "test-app-link" ? "app-captain" : "install-captain",
        });
      if (url.pathname === "/user/installations") {
        const installations =
          token === "test-app-install"
            ? []
            : [
                {
                  id: 123,
                  app_id: 42,
                  account: { login: "private-org" },
                  suspended_at: null,
                  permissions: { contents: "read", metadata: "read" },
                },
              ];
        return Response.json({
          total_count: installations.length,
          installations,
        });
      }
      throw new Error("Unexpected test GitHub App API request");
    }
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
