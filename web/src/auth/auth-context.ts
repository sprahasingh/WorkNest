import { createContext, useContext } from "react";
import type {
  LoginInput,
  AuthRequestOptions,
  MeResponse,
  OrgMembership,
  RegisterInput,
  User,
} from "@/api/auth";

export type AuthState =
  | { status: "loading"; user: null; memberships: null }
  | { status: "authenticated"; user: User; memberships: OrgMembership[] }
  | { status: "unauthenticated"; user: null; memberships: null };

export type AuthContextValue = AuthState & {
  login: (
    input: LoginInput,
    options?: AuthRequestOptions,
  ) => Promise<MeResponse>;
  register: (input: RegisterInput) => Promise<{ email: string }>;
  verifyRegistration: (token: string) => Promise<MeResponse>;
  logout: () => Promise<void>;
  isLoggingOut: boolean;
  deleteAccount: () => Promise<void>;
  isDeletingAccount: boolean;
  refreshMemberships: () => Promise<void>;
  updateCurrentUser: (user: User) => void;
  establishSession: (
    accessToken: string,
    options?: AuthRequestOptions,
  ) => Promise<MeResponse>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
