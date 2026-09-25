import { createContext, useContext } from "react";
import type { Role } from "@/api/auth";

export interface OrgContextValue {
  orgId: string;
  orgName: string;
  role: Role;
}

export const OrgContext = createContext<OrgContextValue | undefined>(
  undefined,
);

export function useOrg(): OrgContextValue {
  const context = useContext(OrgContext);
  if (!context) {
    throw new Error("useOrg must be used within an OrgRoute");
  }
  return context;
}
