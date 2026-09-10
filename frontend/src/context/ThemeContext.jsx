import { createContext, useContext, useEffect, useMemo, useState } from "react";

// Theme preference: "system" | "light" | "dark".
//
// "system" deliberately stamps nothing on <html>, so the CSS media query in
// tokens.css governs; an explicit choice stamps data-theme, which the token
// file scopes above the media query so the toggle wins in both directions.

const STORAGE_KEY = "savesmart_theme";
const ThemeContext = createContext(null);

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system"
      ? value
      : "system";
  } catch {
    // Private mode / blocked storage — fall back to following the OS.
    return "system";
  }
}

const prefersDark = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStored);
  // Tracked rather than read on demand, so that flipping the OS appearance
  // while on "system" updates the toggle's icon without a reload.
  const [systemDark, setSystemDark] = useState(prefersDark);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return undefined;
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* not being able to remember the choice shouldn't break the app */
    }
  }, [theme]);

  const value = useMemo(() => {
    // What the user is actually looking at right now — needed so the toggle
    // can show the mode it will switch *to*.
    const resolved = theme === "system" ? (systemDark ? "dark" : "light") : theme;
    return {
      theme,
      resolved,
      setTheme: setThemeState,
      toggle: () => setThemeState(resolved === "dark" ? "light" : "dark"),
    };
  }, [theme, systemDark]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
