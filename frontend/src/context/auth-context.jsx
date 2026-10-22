import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ApiError } from "@/lib/api";
import * as authService from "@/services/auth.service";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    status: "loading",
    session: null,
    error: null,
    notice: "",
  });

  const [pendingAction, setPendingAction] = useState(null);

  const sessionRef = useRef(null);
  const actionRef = useRef(null);
  const requestVersionRef = useRef(0);

  const acceptSession = useCallback((session) => {
    sessionRef.current = session;

    setState({
      status: "authenticated",
      session,
      error: null,
      notice: "",
    });
  }, []);

  const clearSession = useCallback((notice = "") => {
    sessionRef.current = null;

    setState({
      status: "unauthenticated",
      session: null,
      error: null,
      notice,
    });
  }, []);

  const refreshSession = useCallback(
    async ({ signal } = {}) => {
      if (actionRef.current) return;

      const version = ++requestVersionRef.current;

      setState((previous) => ({
        ...previous,
        status: "loading",
        error: null,
      }));

      try {
        const session = await authService.getCurrentUser({ signal });

        if (
          signal?.aborted ||
          version !== requestVersionRef.current
        ) {
          return;
        }

        acceptSession(session);
      } catch (error) {
        if (
          signal?.aborted ||
          version !== requestVersionRef.current
        ) {
          return;
        }

        if (
          error.status === 401 ||
          error.code === "CSRF_UNAVAILABLE"
        ) {
          clearSession();
          return;
        }

        sessionRef.current = null;

        setState({
          status: "error",
          session: null,
          error: error.message || "Unable to verify your session.",
          notice: "",
        });
      }
    },
    [acceptSession, clearSession]
  );

  useEffect(() => {
    const controller = new AbortController();

    void refreshSession({ signal: controller.signal });

    return () => controller.abort();
  }, [refreshSession]);

  const runAction = useCallback(async (name, action) => {
    if (actionRef.current) {
      throw new ApiError(
        "Please wait for the current request to finish.",
        {
          code: "AUTH_ACTION_PENDING",
        }
      );
    }

    actionRef.current = name;
    requestVersionRef.current += 1;
    setPendingAction(name);

    try {
      return await action();
    } finally {
      actionRef.current = null;
      setPendingAction(null);
    }
  }, []);

  const login = useCallback(
    (credentials) =>
      runAction("login", async () => {
        const session = await authService.login(credentials);
        acceptSession(session);
      }),
    [acceptSession, runAction]
  );

  const logout = useCallback(
    () =>
      runAction("logout", async () => {
        const session = sessionRef.current;

        if (session) {
          try {
            await authService.logout({
              csrfToken: session.csrfToken,
            });
          } catch (error) {
            if (error.status !== 401) throw error;
          }
        }

        clearSession();
      }),
    [clearSession, runAction]
  );

  const changePassword = useCallback(
    (passwords) =>
      runAction("password", async () => {
        const session = sessionRef.current;

        if (!session) {
          clearSession("Please sign in to continue.");

          throw new ApiError("Please sign in to continue.", {
            status: 401,
            code: "UNAUTHENTICATED",
          });
        }

        try {
          await authService.changePassword(passwords, {
            csrfToken: session.csrfToken,
          });
        } catch (error) {
          if (error.status === 401) {
            clearSession(
              "Your session has expired. Please sign in again."
            );
          }

          throw error;
        }

        clearSession(
          "Password changed successfully. Please sign in again."
        );
      }),
    [clearSession, runAction]
  );

  const getCsrfToken = useCallback(() => {
    if (actionRef.current) {
      throw new ApiError(
        "Please wait for the current account action to finish.",
        {
          code: "AUTH_ACTION_PENDING",
        }
      );
    }

    const session = sessionRef.current;

    if (!session) {
      throw new ApiError("Please sign in to continue.", {
        status: 401,
        code: "UNAUTHENTICATED",
      });
    }

    if (session.user.mustChangePassword) {
      throw new ApiError(
        "Change your password before continuing.",
        {
          status: 403,
          code: "PASSWORD_CHANGE_REQUIRED",
        }
      );
    }

    return session.csrfToken;
  }, []);

  const value = useMemo(
    () => ({
      status: state.status,
      user: state.session?.user ?? null,
      error: state.error,
      notice: state.notice,
      pendingAction,
      refreshSession,
      login,
      logout,
      changePassword,
      getCsrfToken,
    }),
    [
      state,
      pendingAction,
      refreshSession,
      login,
      logout,
      changePassword,
      getCsrfToken,
    ]
  );

  return (
    <AuthContext value={value}>
      {children}
    </AuthContext>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (context === null) {
    throw new Error(
      "useAuth must be used inside AuthProvider."
    );
  }

  return context;
}