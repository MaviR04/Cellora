import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { HomePage } from "./pages/HomePage";
import { CategoryPage } from "./pages/CategoryPage";
import { SearchPage } from "./pages/SearchPage";
import { ProductPage } from "./pages/ProductPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { LoginPage, SignupPage } from "./pages/AuthPages";
import { CartPage } from "./pages/CartPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { OrderPage, OrdersPage } from "./pages/OrderPages";
import { StaffIndex, StaffLayout } from "./pages/staff/StaffLayout";
import { FunnelPage, LivePage, TrendsPage } from "./pages/staff/AnalystPages";
import { CustomerPage, EscalationsPage, FailedCheckoutsPage, SessionPage, StaffOrderPage, SupportSearchPage } from "./pages/staff/SupportPages";
import { AuditPage, DataPage, HealthPage, UsersPage } from "./pages/staff/AdminPages";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="c/:kind" element={<CategoryPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="p/:slug" element={<ProductPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:orderNumber" element={<OrderPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        {/* Staff dashboards (Phase 8). The API enforces the role on every endpoint. */}
        <Route path="staff" element={<StaffLayout />}>
          <Route index element={<StaffIndex />} />
          <Route path="live" element={<LivePage />} />
          <Route path="funnel" element={<FunnelPage />} />
          <Route path="trends" element={<TrendsPage />} />
          <Route path="support" element={<SupportSearchPage />} />
          <Route path="support/failed-checkouts" element={<FailedCheckoutsPage />} />
          <Route path="support/escalations" element={<EscalationsPage />} />
          <Route path="support/customers/:id" element={<CustomerPage />} />
          <Route path="support/sessions/:sessionId" element={<SessionPage />} />
          <Route path="support/orders/:orderNumber" element={<StaffOrderPage />} />
          <Route path="admin/users" element={<UsersPage />} />
          <Route path="admin/data" element={<DataPage />} />
          <Route path="admin/health" element={<HealthPage />} />
          <Route path="admin/audit" element={<AuditPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
