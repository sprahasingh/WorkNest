import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/auth/auth-context";
import { listSessions, revokeOtherSessions, revokeSession } from "@/api/auth";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { parseApiError } from "@/lib/apiError";
import { formatRelativeTime } from "@/lib/time";
import { deviceName } from "./deviceName";

// Every device that is signed in to this account, so a lost phone or a
// borrowed computer can be signed out from here.
export function SessionsCard() {
  const { logout, isLoggingOut } = useAuth();
  const queryClient = useQueryClient();
  const [signingOutAll, setSigningOutAll] = useState(false);

  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: listSessions,
  });

  const revoke = useMutation({
    mutationFn: revokeSession,
    onSuccess: () => {
      toast.success("Signed out of that device");
      return queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
    },
    onError: (error) => toast.error(parseApiError(error).message),
  });

  const signOutEverywhereElse = async () => {
    setSigningOutAll(true);
    try {
      await revokeOtherSessions();
      await queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
      toast.success("Signed out of other devices");
    } catch (error) {
      toast.error(parseApiError(error).message);
    } finally {
      setSigningOutAll(false);
    }
  };

  const others = (sessions.data ?? []).filter((item) => !item.current);

  return (
    <Card>
      <h2 className="font-medium text-slate-800 dark:text-slate-100">
        Where you&apos;re signed in
      </h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Don&apos;t recognise a device? Sign it out.
      </p>

      {sessions.isPending ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
          Loading…
        </p>
      ) : sessions.isError ? (
        <p className="mt-4 text-sm text-red-600 dark:text-red-400">
          Couldn&apos;t load your devices.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-700">
          {sessions.data.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {deviceName(item.device)}
                  {item.current && (
                    <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Active {formatRelativeTime(item.lastActiveAt)}
                </p>
              </div>
              {!item.current && (
                <Button
                  variant="secondary"
                  onClick={() => revoke.mutate(item.id)}
                  disabled={revoke.isPending}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          className="w-full sm:w-52"
          onClick={() => void logout()}
          loading={isLoggingOut && !signingOutAll}
          disabled={isLoggingOut || signingOutAll}
        >
          Log out of this device
        </Button>
        {others.length > 0 && (
          <Button
            variant="secondary"
            className="w-full sm:w-52"
            onClick={() => void signOutEverywhereElse()}
            loading={signingOutAll}
            disabled={isLoggingOut || signingOutAll}
          >
            Log out everywhere else
          </Button>
        )}
      </div>
    </Card>
  );
}
