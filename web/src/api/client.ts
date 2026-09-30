import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import type { ApiErrorBody } from "@/lib/apiError";

interface RefreshResponse {
  accessToken: string;
}

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
  _wakeRetried?: boolean;
};

let accessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;
let serverWakePromise: Promise<void> | null = null;
let onAuthFailure: (() => void) | null = null;
let onServerWakeChange: ((isWaking: boolean) => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export type OrgAccessChange = "lost" | "forbidden";
let onOrgAccessChange:
  ((orgId: string, change: OrgAccessChange) => void) | null = null;

// Told when an org request shows your access changed under you: removed from
// the org ("lost") or a role change blocking an action ("forbidden").
export function setOrgAccessHandler(
  handler: ((orgId: string, change: OrgAccessChange) => void) | null,
): void {
  onOrgAccessChange = handler;
}

function reportOrgAccessChange(error: AxiosError<ApiErrorBody>): void {
  const orgId = error.config?.url?.match(/^\/orgs\/([a-f0-9]{24})\//)?.[1];
  const status = error.response?.status;
  const body = error.response?.data?.error;
  if (!orgId || !body) return;
  if (status === 404 && body.message === "Organization not found") {
    onOrgAccessChange?.(orgId, "lost");
  } else if (status === 403 && body.code === "FORBIDDEN") {
    onOrgAccessChange?.(orgId, "forbidden");
  }
}

export function setAuthFailureHandler(handler: (() => void) | null): void {
  onAuthFailure = handler;
}

export function setServerWakeHandler(
  handler: ((isWaking: boolean) => void) | null,
): void {
  onServerWakeChange = handler;
}

export const apiClient = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

const refreshClient = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return config;
});

async function refreshAccessToken(): Promise<string> {
  const response = await refreshClient.post<RefreshResponse>("/auth/refresh");
  return response.data.accessToken;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForServer(): Promise<void> {
  serverWakePromise ??= (async () => {
    onServerWakeChange?.(true);
    try {
      while (true) {
        try {
          await refreshClient.get("/health", { timeout: 10_000 });
          return;
        } catch {
          await delay(2_000);
        }
      }
    } finally {
      onServerWakeChange?.(false);
      serverWakePromise = null;
    }
  })();

  return serverWakePromise;
}

function isServerUnavailable(error: AxiosError): boolean {
  return (
    !error.response ||
    error.response.status === 502 ||
    error.response.status === 503 ||
    error.response.status === 504
  );
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    if (
      originalRequest &&
      !originalRequest._wakeRetried &&
      isServerUnavailable(error)
    ) {
      originalRequest._wakeRetried = true;
      await waitForServer();
      return apiClient(originalRequest);
    }

    const isTokenExpired =
      error.response?.status === 401 &&
      error.response.data?.error?.code === "TOKEN_EXPIRED";

    if (!isTokenExpired || !originalRequest || originalRequest._retry) {
      reportOrgAccessChange(error);
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      refreshPromise ??= refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
      const newAccessToken = await refreshPromise;
      setAccessToken(newAccessToken);
      originalRequest.headers.set("Authorization", `Bearer ${newAccessToken}`);
      return apiClient(originalRequest);
    } catch (refreshError) {
      setAccessToken(null);
      onAuthFailure?.();
      return Promise.reject(refreshError);
    }
  },
);
