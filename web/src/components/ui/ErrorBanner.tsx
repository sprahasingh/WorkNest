export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}
