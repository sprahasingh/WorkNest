import type { Screen } from "@/assets/screens";
import { cn } from "@/lib/cn";
import { PhoneFrame, Screenshot } from "./Screenshot";

// Phone screenshots in equal columns, each with its title underneath. On a
// narrow screen the row scrolls sideways one phone at a time instead of
// shrinking them, so every picture keeps the same size and alignment.
export function PhoneStrip({
  screens,
  label,
  className,
}: {
  screens: Screen[];
  label: string;
  className?: string;
}) {
  return (
    <ul
      aria-label={label}
      tabIndex={0}
      className={cn(
        "flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] sm:grid sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden",
        className,
      )}
      style={{
        gridTemplateColumns: `repeat(${screens.length}, minmax(0, 1fr))`,
      }}
    >
      {screens.map((screen) => (
        <li
          key={screen.key}
          className="w-[58%] shrink-0 snap-center sm:w-auto sm:shrink"
        >
          <PhoneFrame>
            <Screenshot screen={screen} />
          </PhoneFrame>
          <p className="mt-3 text-center text-sm font-medium text-slate-600 dark:text-slate-300">
            {screen.title}
          </p>
        </li>
      ))}
    </ul>
  );
}
