import { Navigate, Route, Routes } from "react-router-dom";

import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import Analyze from "./pages/Analyze";
import Dashboard from "./pages/Dashboard";
import EntityListPage from "./pages/EntityListPage";
import Inbox from "./pages/Inbox";
import Login from "./pages/Login";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Workflows from "./pages/Workflows";

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
        <Route path="inbox" element={<Inbox />} />
        <Route path="analyze" element={<Analyze />} />
        <Route path="reports" element={<Reports />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="settings" element={<Settings />} />
        <Route path=":entity" element={<EntityListPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
