import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  clearSessionApiKey,
  getSessionApiKey,
  setSessionApiKey,
} from "../lib/session-key";

interface AuthContextValue {
  apiKey: string;
  hasApiKey: boolean;
  saveApiKey(value: string): void;
  clearApiKey(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState(getSessionApiKey);

  useEffect(() => {
    const update = () => setApiKey(getSessionApiKey());
    window.addEventListener("radar-api-key-change", update);
    return () => window.removeEventListener("radar-api-key-change", update);
  }, []);

  const saveApiKey = useCallback((value: string) => {
    setSessionApiKey(value);
    setApiKey(getSessionApiKey());
  }, []);
  const clearApiKey = useCallback(() => {
    clearSessionApiKey();
    setApiKey("");
  }, []);

  const value = useMemo(
    () => ({ apiKey, hasApiKey: Boolean(apiKey), saveApiKey, clearApiKey }),
    [apiKey, saveApiKey, clearApiKey],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
