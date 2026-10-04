// "Did you mean name@gmail.com?" under an email field. It waits until the
// person leaves the field, so it never nags in the middle of typing, and it
// only suggests: they stay in charge of what the address is.
export function EmailTypoHint({
  suggestion,
  onUse,
}: {
  suggestion: string | null;
  onUse: (email: string) => void;
}) {
  if (!suggestion) return null;
  return (
    <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
      Did you mean{" "}
      <button
        type="button"
        onClick={() => onUse(suggestion)}
        className="font-medium underline underline-offset-2"
      >
        {suggestion}
      </button>
      ?
    </p>
  );
}
