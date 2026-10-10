export interface User {
  id: string;
  email: string;
  name: string;
  role: 'CUSTOMER' | 'ADMIN';
  emailVerified: boolean;
}
export interface ProductCardData {
  id: string;
  slug: string;
  name: string;
  brand: string;
  priceMinor: number;
  mrpMinor: number;
  ratingAvg: number;
  ratingCount: number;
  image: { url: string; alt: string } | null;
  inStock: boolean;
  lowStock: boolean;
}
export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
}
export interface Category {
  id: string;
  name: string;
  slug: string;
  productCount: number;
}
export interface CartLine {
  productId: string;
  slug: string;
  name: string;
  image: string | null;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  available: number;
  issue: string | null;
}
export interface Cart {
  items: CartLine[];
  itemCount: number;
  subtotalMinor: number;
  hasIssues: boolean;
}
export interface Address {
  id: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
  isDefault: boolean;
}
export interface Order {
  id: string;
  status: string;
  createdAt: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  shippingMinor: number;
  totalMinor: number;
  shippingMethod: string;
  couponCode: string | null;
  shippingAddress: {
    name: string;
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    postalCode: string;
  };
  items: {
    productId: string;
    sku: string;
    name: string;
    unitPriceMinor: number;
    quantity: number;
    lineTotalMinor: number;
  }[];
  payment: { status: string; isMock: boolean; amountMinor: number } | null;
  tracking: { status: string; note: string | null; at: string }[];
  customer?: { email: string; name: string };
}
