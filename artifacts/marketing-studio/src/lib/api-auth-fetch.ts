import { toast } from "@/hooks/use-toast";

const TOKEN_KEY = "ams_token";
const USER_KEY = "ams_user";

let installed = false;
let lastSessionExpiredToastAt = 0;

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
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!shouldAttachAuth(input)) return nativeFetch(input, init);

    const headers = mergeAuthHeader(
      init.headers ?? (input instanceof Request ? input.headers : undefined),
    );

    const response = await nativeFetch(input, { ...init, headers });
    if (response.status === 401) {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(USER_KEY);
      window.dispatchEvent(new CustomEvent("ams:session-expired"));
      const now = Date.now();
      if (now - lastSessionExpiredToastAt > 3000) {
        lastSessionExpiredToastAt = now;
        toast({
          title: "Session expired. Please sign in again.",
          variant: "destructive",
        });
      }
    }
    return response;
  };
}
