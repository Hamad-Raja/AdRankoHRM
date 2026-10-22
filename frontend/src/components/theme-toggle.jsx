import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { useTheme } from "@/context/theme-provider";

export function ThemeToggle({ className }) {
  const { theme, setTheme } = useTheme();
  const Icon = theme === "system" ? Monitor : theme === "dark" ? Moon : Sun;

  return (
    <label
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2",
        "rounded-md border border-border bg-card px-3",
        "text-sm font-medium text-card-foreground",
        "cursor-pointer hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        "focus-visible:outline-ring",
        className
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <select
        aria-label="Theme"
        value={theme}
        onChange={(event) => setTheme(event.target.value)}
        className="min-w-0 cursor-pointer rounded-sm bg-card py-2 text-card-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  );
}
