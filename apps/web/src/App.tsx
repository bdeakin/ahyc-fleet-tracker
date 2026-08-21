import { Navigate, Route, Routes } from "react-router-dom";
import { AdminPage } from "./pages/AdminPage";
import { AdventuresPage } from "./pages/AdventuresPage";
import { KioskPage } from "./pages/KioskPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<KioskPage />} />
      <Route path="/adventures" element={<AdventuresPage />} />
      <Route path="/adventures/:vesselId/:year" element={<AdventuresPage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
