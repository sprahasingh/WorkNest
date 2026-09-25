import { createContext, useContext } from "react";
import type {
  LoginInput,
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
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshMemberships: () => Promise<void>;
  establishSession: (accessToken: string) => Promise<MeResponse>;
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
