import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMe,
  login as loginRequest,
  logout as logoutRequest,
  refresh as refreshRequest,
  register as registerRequest,
  verifyRegistration as verifyRegistrationRequest,
  deleteAccount as deleteAccountRequest,
  type AuthRequestOptions,
  type LoginInput,
  type MeResponse,
  type RegisterInput,
  type User,
} from "@/api/auth";
import { setAccessToken, setAuthFailureHandler } from "@/api/client";
import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
} from "./auth-context";

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
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

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

  const establishSession = useCallback(
    async (
      accessToken: string,
      options?: AuthRequestOptions,
    ): Promise<MeResponse> => {
      setAccessToken(accessToken);
      try {
        const me = await fetchMe(options);
        if (options?.signal?.aborted) {
          throw options.signal.reason ?? new Error("Request canceled");
        }
        queryClient.setQueryData<MeResponse>(SESSION_QUERY_KEY, me);
        setSignedOut(false);
        return me;
      } catch (error) {
        if (options?.signal?.aborted) setAccessToken(null);
        throw error;
      }
    },
    [queryClient],
  );

  const login = useCallback(
    async (input: LoginInput, options?: AuthRequestOptions) => {
      const { accessToken } = await loginRequest(input, options);
      if (options?.signal?.aborted) {
        throw options.signal.reason ?? new Error("Request canceled");
      }
      return establishSession(accessToken, options);
    },
    [establishSession],
  );

  const register = useCallback(
    (input: RegisterInput) => registerRequest(input),
    [],
  );

  const verifyRegistration = useCallback(
    async (token: string) => {
      const { accessToken } = await verifyRegistrationRequest(token);
      return establishSession(accessToken);
    },
    [establishSession],
  );

  const logout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await logoutRequest();
    } finally {
      setAccessToken(null);
      setSignedOut(true);
      queryClient.clear();
      setIsLoggingOut(false);
    }
  }, [queryClient]);

  const deleteAccount = useCallback(async () => {
    setIsDeletingAccount(true);
    try {
      await deleteAccountRequest();
      setAccessToken(null);
      setSignedOut(true);
      queryClient.clear();
    } finally {
      setIsDeletingAccount(false);
    }
  }, [queryClient]);

  const refreshMemberships = useCallback(async () => {
    const me = await fetchMe();
    queryClient.setQueryData<MeResponse>(SESSION_QUERY_KEY, me);
  }, [queryClient]);

  const updateCurrentUser = useCallback(
    (user: User) => {
      queryClient.setQueryData<MeResponse>(SESSION_QUERY_KEY, (current) =>
        current ? { ...current, user } : current,
      );
    },
    [queryClient],
  );

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

  const value: AuthContextValue = {
    ...state,
    login,
    register,
    verifyRegistration,
    logout,
    isLoggingOut,
    deleteAccount,
    isDeletingAccount,
    refreshMemberships,
    updateCurrentUser,
    establishSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
