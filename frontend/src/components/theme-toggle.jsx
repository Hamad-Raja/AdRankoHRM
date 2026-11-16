import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/theme-provider";

export function ThemeToggle({ className }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  const Icon = isDark ? Sun : Moon;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg",
        "border border-border/80 bg-background/90 text-foreground shadow-2xs",
        "transition-colors hover:border-foreground/30 hover:bg-accent/50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className
      )}
    >
      <Icon aria-hidden="true" className={cn("size-5", isDark && "text-amber-400")} />
    </button>
  );
}
