import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMe,
  login as loginRequest,
  logout as logoutRequest,
  refresh as refreshRequest,
  register as registerRequest,
  type LoginInput,
  type MeResponse,
  type RegisterInput,
} from "@/api/auth";
import { setAccessToken, setAuthFailureHandler } from "@/api/client";
import { AuthContext, type AuthContextValue, type AuthState } from "./auth-context";

const SESSION_QUERY_KEY = ["auth", "session"] as const;

const LOADING_STATE: AuthState = {
  status: "loading",
  user: null,
  memberships: null,
};

const UNAUTHENTICATED_STATE: AuthState = {
  status: "unauthenticated",
  user: null,
  memberships: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [signedOut, setSignedOut] = useState(false);

  const sessionQuery = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<MeResponse> => {
      const { accessToken } = await refreshRequest();
      setAccessToken(accessToken);
      return fetchMe();
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: !signedOut,
  });

  useEffect(() => {
    setAuthFailureHandler(() => {
      setAccessToken(null);
      setSignedOut(true);
      queryClient.clear();
    });

    return () => {
      setAuthFailureHandler(null);
    };
  }, [queryClient]);

  const login = useCallback(
    async (input: LoginInput) => {
      const { accessToken } = await loginRequest(input);
      setAccessToken(accessToken);
      const me = await fetchMe();
      queryClient.setQueryData<MeResponse>(SESSION_QUERY_KEY, me);
      setSignedOut(false);
    },
    [queryClient],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const { accessToken } = await registerRequest(input);
      setAccessToken(accessToken);
      const me = await fetchMe();
      queryClient.setQueryData<MeResponse>(SESSION_QUERY_KEY, me);
      setSignedOut(false);
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } finally {
      setAccessToken(null);
      setSignedOut(true);
      queryClient.clear();
    }
  }, [queryClient]);

  const state: AuthState = signedOut
    ? UNAUTHENTICATED_STATE
    : sessionQuery.isPending
      ? LOADING_STATE
      : sessionQuery.isSuccess
        ? {
            status: "authenticated",
            user: sessionQuery.data.user,
            memberships: sessionQuery.data.memberships,
          }
        : UNAUTHENTICATED_STATE;

  const value: AuthContextValue = { ...state, login, register, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
