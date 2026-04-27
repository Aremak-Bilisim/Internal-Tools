import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import AppLayout from './components/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ProductsPage from './pages/ProductsPage'
import OrdersPage from './pages/OrdersPage'
import ShipmentsPage from './pages/ShipmentsPage'
import ShipmentDetailPage from './pages/ShipmentDetailPage'
import OrderDetailPage from './pages/OrderDetailPage'
import CustomerQueryPage from './pages/CustomerQueryPage'
import CustomerNewPage from './pages/CustomerNewPage'
import CustomerEditPage from './pages/CustomerEditPage'
import SampleRequestsPage from './pages/SampleRequestsPage'
import SampleDetailPage from './pages/SampleDetailPage'
import PurchaseOrderNewPage from './pages/PurchaseOrderNewPage'

function PrivateRoute({ children }) {
  const token = useAuthStore((s) => s.token)
  return token ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <AppLayout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="shipments" element={<ShipmentsPage />} />
        <Route path="shipments/:id" element={<ShipmentDetailPage />} />
        <Route path="samples" element={<SampleRequestsPage />} />
        <Route path="samples/:id" element={<SampleDetailPage />} />
        <Route path="customer-query" element={<CustomerQueryPage />} />
        <Route path="customer-new" element={<CustomerNewPage />} />
        <Route path="customer-edit" element={<CustomerEditPage />} />
        <Route path="purchase-orders/new" element={<PurchaseOrderNewPage />} />
      </Route>
    </Routes>
  )
}
