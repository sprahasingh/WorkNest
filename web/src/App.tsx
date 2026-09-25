import { useAuth } from "@/auth/auth-context";

function App() {
  const { status, user } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-slate-800">
          WorkNest — auth status check
        </h1>
        <p className="mt-4 text-lg text-slate-600">
          status: <span className="font-mono">{status}</span>
        </p>
        <p className="mt-1 text-lg text-slate-600">
          user: <span className="font-mono">{user?.email ?? "none"}</span>
        </p>
      </div>
    </div>
  );
}

export default App;
