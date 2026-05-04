const TOKEN_KEY = "ams_token";

let installed = false;

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function shouldAttachAuth(input: RequestInfo | URL): boolean {
  const url = getRequestUrl(input);
  const resolved = new URL(url, window.location.origin);
  if (resolved.origin !== window.location.origin) return false;
  const apiIndex = resolved.pathname.indexOf("/api");
  if (apiIndex < 0) return false;
  const apiPath = resolved.pathname.slice(apiIndex);
  return !(
    apiPath.startsWith("/api/auth/login") ||
    apiPath.startsWith("/api/auth/signup") ||
    apiPath.startsWith("/api/auth/refresh")
  );
}

function mergeAuthHeader(headersInit: HeadersInit | undefined): Headers {
  const headers = new Headers(headersInit);
  if (!headers.has("authorization")) {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  return headers;
}

export function installApiAuthFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!shouldAttachAuth(input)) return nativeFetch(input, init);

    const headers = mergeAuthHeader(
      init.headers ?? (input instanceof Request ? input.headers : undefined),
    );

    return nativeFetch(input, { ...init, headers });
  };
}
