import { Navigate, Route, Routes } from "react-router";
import { OAUTH_CALLBACK_PATH } from "@/auth/oauthReturn";
import { AppLayout } from "@/components/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PublicOnlyRoute } from "@/components/PublicOnlyRoute";
import { ViktorAutoSignIn } from "@/components/ViktorAutoSignIn";
import { ViktorProductAuthProvider } from "@/lib/viktor-spaces-access/ViktorProductAuthProvider";
import { SettingsPage } from "@/pages";
import { TnSignIn, TnSignUp } from "@/tn/TnSignIn";
import { OverviewPage } from "@/tn/OverviewPage";
import { JobsPage } from "@/tn/JobsPage";
import { AccessPage } from "@/tn/AccessPage";
import { CashPage } from "@/tn/CashPage";
import { ChatPage } from "@/tn/ChatPage";
import { GuidePage } from "@/tn/GuidePage";
import { MapPage } from "@/tn/MapPage";
import { MarketingPage } from "@/tn/MarketingPage";
import { DashboardShell } from "@/tn/Shell";
import { ViktorOAuthCallbackPage } from "@/pages/ViktorOAuthCallbackPage";

export function AuthenticatedRoutes() {
  return (
    <Routes>
      {/* No marketing landing page. The root goes straight to the dashboard,
          and the route guard sends signed out visitors to the sign in screen. */}
      <Route path="/" element={<Navigate to="/overview" replace />} />
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<TnSignIn />} />
        <Route path="/signup" element={<TnSignUp />} />
      </Route>

      {/* Return leg of "Sign in with Viktor" — outside the auth guards
          because it owns the loading/outcome handling itself. */}
      <Route path={OAUTH_CALLBACK_PATH} element={<ViktorOAuthCallbackPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardShell />}>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/cash" element={<CashPage />} />
          <Route path="/marketing" element={<MarketingPage />} />
          <Route path="/access" element={<AccessPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/chat" element={<ChatPage />} />
        </Route>
        <Route element={<AppLayout />}>
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="/dashboard" element={<Navigate to="/overview" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/overview" replace />} />
    </Routes>
  );
}

export function AuthenticatedAppRoutes() {
  return (
    <ViktorProductAuthProvider enabled>
      {/* Outside the routes so links carrying `viktor_sign_in=auto` work no
          matter which page they land on. */}
      <ViktorAutoSignIn />
      <AuthenticatedRoutes />
    </ViktorProductAuthProvider>
  );
}
