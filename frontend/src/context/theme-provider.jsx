import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

const STORAGE_KEY = "officehr-theme";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";
const VALID_THEMES = new Set(["light", "dark", "system"]);

const ThemeContext = createContext(null);

function readSavedTheme() {
  try {
    const savedTheme = window.localStorage.getItem(STORAGE_KEY);
    return VALID_THEMES.has(savedTheme) ? savedTheme : "system";
  } catch {
    return "system";
  }
}

function subscribeToSystemTheme(callback) {
  const mediaQuery = window.matchMedia(SYSTEM_DARK_QUERY);

  mediaQuery.addEventListener("change", callback);

  return () => {
    mediaQuery.removeEventListener("change", callback);
  };
}

function getSystemDarkSnapshot() {
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

function getServerDarkSnapshot() {
  return false;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readSavedTheme);

  const systemIsDark = useSyncExternalStore(
    subscribeToSystemTheme,
    getSystemDarkSnapshot,
    getServerDarkSnapshot
  );

  const resolvedTheme =
    theme === "system" ? (systemIsDark ? "dark" : "light") : theme;

  useLayoutEffect(() => {
    const root = document.documentElement;

    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    function handleStorageChange(event) {
      if (event.key === STORAGE_KEY || event.key === null) {
        setThemeState(readSavedTheme());
      }
    }

    window.addEventListener("storage", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  const setTheme = useCallback((nextTheme) => {
    if (!VALID_THEMES.has(nextTheme)) {
      throw new Error("Theme must be light, dark, or system.");
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, nextTheme);
    } catch {
      // Theme switching still works when browser storage is unavailable.
    }

    setThemeState(nextTheme);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
    }),
    [theme, resolvedTheme, setTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (context === null) {
    throw new Error("useTheme must be used inside ThemeProvider.");
  }

  return context;
}