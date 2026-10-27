import { ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/context/theme-provider";

export function ThemeToggle({ className }) {
  const { theme, setTheme } = useTheme();

  const Icon =
    theme === "system"
      ? Monitor
      : theme === "dark"
      ? Moon
      : Sun;

  const iconColor =
    theme === "dark"
      ? "text-emerald-400"
      : theme === "light"
      ? "text-amber-500"
      : "text-muted-foreground";

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <div className="pointer-events-none absolute left-2.5 z-10 flex items-center">
        <Icon className={cn("size-4 shrink-0 transition-colors", iconColor)} aria-hidden="true" />
      </div>

      <select
        aria-label="Theme"
        value={theme}
        onChange={(event) => setTheme(event.target.value)}
        className={cn(
          "h-9 w-auto cursor-pointer appearance-none rounded-lg",
          "border border-border/80 bg-background/90 hover:bg-accent/50",
          "pl-8 pr-8 text-xs font-semibold text-foreground",
          "shadow-2xs transition-all outline-none select-none",
          "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
          "hover:border-foreground/30"
        )}
      >
        <option value="light" className="bg-popover text-popover-foreground font-medium py-1">
          Light
        </option>
        <option value="dark" className="bg-popover text-popover-foreground font-medium py-1">
          Dark
        </option>
        <option value="system" className="bg-popover text-popover-foreground font-medium py-1">
          System
        </option>
      </select>

      <div className="pointer-events-none absolute right-2.5 z-10 flex items-center text-muted-foreground">
        <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
      </div>
    </div>
  );
}
