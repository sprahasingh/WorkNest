import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import type { ApiErrorBody } from "@/lib/apiError";

interface RefreshResponse {
  accessToken: string;
}

const SERVER_WAKE_TIMEOUT_MS = 90_000;
const SERVER_READY_CACHE_MS = 10 * 60_000;
const SERVER_CHECK_INTERVALS_MS = [2_000, 4_000, 8_000] as const;

interface HealthResponse {
  status: string;
  db: string;
}

export class ServerWakeTimeoutError extends Error {
  constructor() {
    super("The server did not wake before the timeout.");
    this.name = "ServerWakeTimeoutError";
  }
}

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
  _wakeRetried?: boolean;
};
type RequestSignal = NonNullable<InternalAxiosRequestConfig["signal"]>;

let accessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;
let lastServerReadyAt = 0;
let isServerWaking = false;
let onAuthFailure: (() => void) | null = null;
const serverWakeHandlers = new Set<(isWaking: boolean) => void>();

interface ServerWakeAttempt {
  controller: AbortController;
  promise: Promise<void>;
  waiters: number;
}

let serverWakeAttempt: ServerWakeAttempt | null = null;

class HealthNotReadyError extends Error {}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

// The live connection needs the current token each time it (re)connects.
export function getAccessToken(): string | null {
  return accessToken;
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

export function subscribeServerWakeChange(
  handler: (isWaking: boolean) => void,
): () => void {
  serverWakeHandlers.add(handler);
  if (isServerWaking) handler(true);
  return () => serverWakeHandlers.delete(handler);
}

export const apiClient = axios.create({
  baseURL: "/api",
  withCredentials: true,
  timeout: 30_000,
});

const refreshClient = axios.create({
  baseURL: "/api",
  withCredentials: true,
  timeout: 15_000,
});

apiClient.interceptors.request.use(async (config) => {
  if (config.signal?.aborted) throw new axios.CanceledError();
  await waitForServer(false, config.signal);
  if (config.signal?.aborted) throw new axios.CanceledError();
  if (accessToken) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return config;
});

async function refreshAccessToken(): Promise<string> {
  const response = await refreshClient.post<RefreshResponse>("/auth/refresh");
  return response.data.accessToken;
}

// When the current wake-up began, kept for the tab so a refresh continues
// the progress bar instead of starting it from zero.
const WAKE_STARTED_KEY = "worknest.serverWakeStartedAt";
const WAKE_START_MAX_AGE_MS = 3 * 60_000;

function readWakeStartedAt(): number | null {
  try {
    const value = Number(sessionStorage.getItem(WAKE_STARTED_KEY));
    return value && Date.now() - value < WAKE_START_MAX_AGE_MS ? value : null;
  } catch {
    return null;
  }
}

function markWakeStarted(): void {
  try {
    if (readWakeStartedAt() === null) {
      sessionStorage.setItem(WAKE_STARTED_KEY, String(Date.now()));
    }
  } catch {
    // Storage can be unavailable (private mode); the bar then starts at 0.
  }
}

function clearWakeStarted(): void {
  try {
    sessionStorage.removeItem(WAKE_STARTED_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function getServerWakeStartedAt(): number {
  return readWakeStartedAt() ?? Date.now();
}

function notifyServerWakeChange(isWaking: boolean): void {
  if (isWaking) markWakeStarted();
  // Only a wake that just succeeded is finished; after a timeout the next
  // attempt continues from the same start.
  else if (Date.now() - lastServerReadyAt < 5_000) clearWakeStarted();
  isServerWaking = isWaking;
  for (const handler of serverWakeHandlers) handler(isWaking);
}

// True when the last health check passed, so the loading screen can tell a
// finished wake-up from one that timed out or was cancelled.
export function isServerReady(): boolean {
  return Date.now() - lastServerReadyAt < SERVER_READY_CACHE_MS;
}

function delay(milliseconds: number, signal: RequestSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new axios.CanceledError());
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener?.("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener?.("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function isRetryableHealthError(error: unknown): boolean {
  if (error instanceof HealthNotReadyError) return true;
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status === 429 || status >= 500;
}

async function pollUntilServerReady(signal: RequestSignal): Promise<void> {
  const deadline = Date.now() + SERVER_WAKE_TIMEOUT_MS;
  let attemptNumber = 0;
  let announcedWake = false;

  try {
    while (true) {
      if (signal.aborted) throw new axios.CanceledError();
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new ServerWakeTimeoutError();

      try {
        const response = await refreshClient.get<HealthResponse>("/health", {
          timeout: Math.min(5_000, remainingMs),
          signal,
        });
        if (response.data.status !== "ok" || response.data.db !== "connected") {
          throw new HealthNotReadyError();
        }
        lastServerReadyAt = Date.now();
        return;
      } catch (error) {
        if (signal.aborted || axios.isCancel(error)) throw error;
        if (!isRetryableHealthError(error)) throw error;
        if (!announcedWake) {
          announcedWake = true;
          notifyServerWakeChange(true);
        }

        const intervalIndex = Math.min(
          attemptNumber,
          SERVER_CHECK_INTERVALS_MS.length - 1,
        );
        const nextDelayMs = Math.min(
          SERVER_CHECK_INTERVALS_MS[intervalIndex],
          deadline - Date.now(),
        );
        if (nextDelayMs <= 0) throw new ServerWakeTimeoutError();
        attemptNumber += 1;
        await delay(nextDelayMs, signal);
      }
    }
  } finally {
    if (announcedWake) notifyServerWakeChange(false);
  }
}

function createServerWakeAttempt(): ServerWakeAttempt {
  const attempt: ServerWakeAttempt = {
    controller: new AbortController(),
    promise: Promise.resolve(),
    waiters: 0,
  };
  attempt.promise = pollUntilServerReady(attempt.controller.signal).finally(
    () => {
      if (serverWakeAttempt === attempt) serverWakeAttempt = null;
    },
  );
  serverWakeAttempt = attempt;
  return attempt;
}

function waitForServer(
  forceCheck = false,
  signal?: RequestSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.reject(new axios.CanceledError());
  if (!forceCheck && Date.now() - lastServerReadyAt < SERVER_READY_CACHE_MS) {
    return Promise.resolve();
  }

  const attempt = serverWakeAttempt ?? createServerWakeAttempt();
  attempt.waiters += 1;

  return new Promise((resolve, reject) => {
    let settled = false;
    const release = () => {
      if (settled) return false;
      settled = true;
      signal?.removeEventListener?.("abort", onAbort);
      attempt.waiters -= 1;
      if (attempt.waiters === 0 && serverWakeAttempt === attempt) {
        attempt.controller.abort();
      }
      return true;
    };
    const onAbort = () => {
      if (release()) reject(new axios.CanceledError());
    };

    signal?.addEventListener?.("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    attempt.promise.then(
      () => {
        if (release()) resolve();
      },
      (error: unknown) => {
        if (release()) reject(error);
      },
    );
  });
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
  (response) => {
    lastServerReadyAt = Date.now();
    return response;
  },
  async (error: AxiosError<ApiErrorBody>) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    if (axios.isCancel(error)) return Promise.reject(error);

    if (isServerUnavailable(error)) lastServerReadyAt = 0;

    if (
      originalRequest &&
      ["get", "head", "options"].includes(
        originalRequest.method?.toLowerCase() ?? "",
      ) &&
      !originalRequest._wakeRetried &&
      isServerUnavailable(error)
    ) {
      originalRequest._wakeRetried = true;
      await waitForServer(true, originalRequest.signal);
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
      // Only a rejected session means signed out. A timeout or server error
      // just fails this request; the next one tries refreshing again.
      if (
        axios.isAxiosError(refreshError) &&
        refreshError.response?.status === 401
      ) {
        setAccessToken(null);
        onAuthFailure?.();
      }
      return Promise.reject(refreshError);
    }
  },
);
