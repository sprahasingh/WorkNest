import axios from "axios";
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
import { resolvePostAuthPath } from "@/lib/postAuthRedirect";
import { forgetSignedIn, rememberSignedIn } from "@/lib/sessionHint";
import { runSignOutHooks } from "@/lib/signOutHooks";
import { toast } from "sonner";
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
    // A blip while the server answers shouldn't look like being signed out;
    // only a rejected session (401) is final.
    retry: (failureCount, error) =>
      failureCount < 2 &&
      !(axios.isAxiosError(error) && error.response?.status === 401),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: !signedOut,
  });

  // Signing out in one tab signs out every tab of this browser, instead of
  // leaving the others showing data until their next request fails.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("worknest-auth");
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === "signed-out") {
        setAccessToken(null);
        setSignedOut(true);
        queryClient.clear();
        runSignOutHooks();
        forgetSignedIn();
      }
    };
    return () => channel.close();
  }, [queryClient]);

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
    async (token: string, password: string) => {
      const { accessToken } = await verifyRegistrationRequest(token, password);
      return establishSession(accessToken);
    },
    [establishSession],
  );

  const logout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await logoutRequest();
    } catch {
      // Signed out here either way, but the server couldn't be told, so the
      // browser's session cookie may still work. Say so, don't hide it.
      toast.error(
        "Signed out on this device, but we couldn't end the session.",
        {
          description: "Try logging out again when you're back online.",
        },
      );
    } finally {
      setAccessToken(null);
      setSignedOut(true);
      queryClient.clear();
      runSignOutHooks();
      forgetSignedIn();
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("worknest-auth");
        channel.postMessage("signed-out");
        channel.close();
      }
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

  // Lets the landing page show the signed-in buttons straight away next time.
  const workspaceHint =
    state.status === "authenticated"
      ? resolvePostAuthPath(state.memberships)
      : state.status;
  useEffect(() => {
    if (workspaceHint === "loading") return;
    if (workspaceHint === "unauthenticated") forgetSignedIn();
    else rememberSignedIn(workspaceHint);
  }, [workspaceHint]);

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
