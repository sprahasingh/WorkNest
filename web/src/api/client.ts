import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import type { ApiErrorBody } from "@/lib/apiError";

interface RefreshResponse {
  accessToken: string;
}

type RetryableRequestConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

let accessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;
let onAuthFailure: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setAuthFailureHandler(handler: (() => void) | null): void {
  onAuthFailure = handler;
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

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    const isTokenExpired =
      error.response?.status === 401 &&
      error.response.data?.error?.code === "TOKEN_EXPIRED";

    if (!isTokenExpired || !originalRequest || originalRequest._retry) {
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
