import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/guards';
import { Skeleton } from './components/ui';
import Account from './pages/Account';
import { ForgotPassword, Login, Register, ResetPassword, VerifyEmail } from './pages/AuthPages';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import Home from './pages/Home';
import { NotFound, Support, Wishlist } from './pages/Misc';
import { OrderDetail, OrdersList } from './pages/Orders';
import ProductDetail from './pages/ProductDetail';
import Products from './pages/Products';

const AdminPage = lazy(() => import('./pages/admin/AdminPage'));

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="products" element={<Products />} />
        <Route path="products/:slug" element={<ProductDetail />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route path="verify-email" element={<VerifyEmail />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route path="support" element={<Support />} />
        <Route element={<RequireAuth />}>
          <Route path="cart" element={<Cart />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="orders" element={<OrdersList />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="account" element={<Account />} />
          <Route path="wishlist" element={<Wishlist />} />
        </Route>
        <Route element={<RequireAuth admin />}>
          <Route
            path="admin"
            element={
              <Suspense fallback={<Skeleton className="h-64" />}>
                <AdminPage />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
