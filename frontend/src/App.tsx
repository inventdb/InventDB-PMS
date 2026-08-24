import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import Analyze from "./pages/Analyze";
import Dashboard from "./pages/Dashboard";
import EntityListPage from "./pages/EntityListPage";
import Login from "./pages/Login";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Workflows from "./pages/Workflows";
import Files from "./pages/Files";
import { Spinner } from "./components/ui";

// Import pulls in SheetJS to read workbooks in the browser — around 330 kB
// that no other room needs. Loading the route on demand keeps it out of the
// bundle everyone downloads to look at the dashboard.
const ImportPage = lazy(() => import("./pages/Import"));

function ProtectedLayout() {
  const { user, token } = useAuth();
  if (!user || !token) return <Navigate to="/login" replace />;
  return <Layout />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="analyze" element={<Analyze />} />
        <Route path="reports" element={<Reports />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="files" element={<Files />} />
        <Route
          path="import"
          element={
            <Suspense fallback={<Spinner />}>
              <ImportPage />
            </Suspense>
          }
        />
        <Route path="settings" element={<Settings />} />
        <Route path=":entity" element={<EntityListPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
