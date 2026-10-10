/** Compact OpenAPI 3 description, served by Swagger UI at /api/v1/docs when ENABLE_DOCS=true. */
type Op = [
  method: string,
  path: string,
  summary: string,
  tag: string,
  auth: 'none' | 'user' | 'admin',
];

const ops: Op[] = [
  ['get', '/health', 'Liveness probe', 'Health', 'none'],
  ['get', '/ready', 'Readiness probe (checks database)', 'Health', 'none'],
  [
    'post',
    '/auth/register',
    'Register (generic 202 response, no account enumeration)',
    'Auth',
    'none',
  ],
  ['post', '/auth/verify-email', 'Verify email with single-use token', 'Auth', 'none'],
  ['post', '/auth/resend-verification', 'Resend verification email', 'Auth', 'none'],
  [
    'post',
    '/auth/login',
    'Login; sets HttpOnly session cookie, returns CSRF token',
    'Auth',
    'none',
  ],
  ['post', '/auth/logout', 'Revoke current session', 'Auth', 'user'],
  ['get', '/auth/me', 'Current user + CSRF token (user is null when signed out)', 'Auth', 'none'],
  ['post', '/auth/forgot-password', 'Request password reset (generic 202)', 'Auth', 'none'],
  [
    'post',
    '/auth/reset-password',
    'Reset password with single-use token; revokes all sessions',
    'Auth',
    'none',
  ],
  ['get', '/users/me', 'Profile', 'Users', 'user'],
  ['patch', '/users/me', 'Update profile name', 'Users', 'user'],
  ['post', '/users/me/password', 'Change password', 'Users', 'user'],
  ['delete', '/users/me', 'Deactivate account', 'Users', 'user'],
  ['get', '/users/me/addresses', 'List addresses', 'Users', 'user'],
  ['post', '/users/me/addresses', 'Create address', 'Users', 'user'],
  ['patch', '/users/me/addresses/{id}', 'Update own address', 'Users', 'user'],
  ['delete', '/users/me/addresses/{id}', 'Delete own address (soft)', 'Users', 'user'],
  ['get', '/categories', 'List categories', 'Catalog', 'none'],
  [
    'get',
    '/products',
    'Search/filter/sort/paginate products (pageSize <= 48; price filters in paise)',
    'Catalog',
    'none',
  ],
  ['get', '/products/{slug}', 'Product details with related products', 'Catalog', 'none'],
  ['get', '/products/{id}/reviews', 'List reviews', 'Catalog', 'none'],
  ['get', '/products/{id}/review-eligibility', 'Can the current user review?', 'Catalog', 'user'],
  [
    'post',
    '/products/{id}/reviews',
    'Create review (delivered purchase required)',
    'Catalog',
    'user',
  ],
  ['get', '/cart', 'Get cart (server-computed prices)', 'Cart', 'user'],
  ['post', '/cart/items', 'Add item', 'Cart', 'user'],
  ['patch', '/cart/items/{productId}', 'Set quantity', 'Cart', 'user'],
  ['delete', '/cart/items/{productId}', 'Remove item', 'Cart', 'user'],
  ['get', '/wishlist', 'List wishlist', 'Wishlist', 'user'],
  ['put', '/wishlist/{productId}', 'Add to wishlist', 'Wishlist', 'user'],
  ['delete', '/wishlist/{productId}', 'Remove from wishlist', 'Wishlist', 'user'],
  ['post', '/checkout/quote', 'Server-side price quote', 'Orders', 'user'],
  ['post', '/orders', 'Create order (Idempotency-Key header required)', 'Orders', 'user'],
  ['get', '/orders', 'List own orders', 'Orders', 'user'],
  ['get', '/orders/{id}', 'Get own order with tracking', 'Orders', 'user'],
  ['post', '/orders/{id}/cancel', 'Cancel an unpaid order', 'Orders', 'user'],
  ['post', '/orders/{id}/pay/mock', 'MOCK payment simulation (dev only)', 'Payments', 'user'],
  [
    'post',
    '/payments/webhook/mock',
    'Signed (HMAC-SHA256, x-signature) idempotent payment webhook',
    'Payments',
    'none',
  ],
  ['post', '/support/messages', 'Contact support', 'Support', 'none'],
  ['get', '/admin/stats', 'Dashboard stats', 'Admin', 'admin'],
  ['get', '/admin/products', 'List products', 'Admin', 'admin'],
  ['post', '/admin/products', 'Create product', 'Admin', 'admin'],
  ['patch', '/admin/products/{id}', 'Update product', 'Admin', 'admin'],
  ['delete', '/admin/products/{id}', 'Soft-delete product', 'Admin', 'admin'],
  ['patch', '/admin/products/{id}/inventory', 'Set stock', 'Admin', 'admin'],
  ['post', '/admin/categories', 'Create category', 'Admin', 'admin'],
  ['patch', '/admin/categories/{id}', 'Rename category', 'Admin', 'admin'],
  ['delete', '/admin/categories/{id}', 'Delete empty category', 'Admin', 'admin'],
  ['get', '/admin/orders', 'List all orders', 'Admin', 'admin'],
  [
    'patch',
    '/admin/orders/{id}/status',
    'Change order status (validated transitions)',
    'Admin',
    'admin',
  ],
  ['get', '/admin/users', 'List users', 'Admin', 'admin'],
  ['patch', '/admin/users/{id}/role', 'Change role (revokes target sessions)', 'Admin', 'admin'],
  ['delete', '/admin/reviews/{id}', 'Delete review', 'Admin', 'admin'],
  ['get', '/admin/audit-logs', 'Audit log', 'Admin', 'admin'],
  ['get', '/admin/support-messages', 'Support inbox', 'Admin', 'admin'],
];

const paths: Record<string, Record<string, unknown>> = {};
for (const [method, path, summary, tag, auth] of ops) {
  const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  (paths[path] ??= {})[method] = {
    summary,
    tags: [tag],
    parameters: params,
    security: auth === 'none' ? [] : [{ cookieAuth: [] }],
    ...(auth === 'admin' ? { description: 'Requires the ADMIN role.' } : {}),
    ...(method !== 'get' && method !== 'delete' && auth !== 'none'
      ? { description: 'Requires header X-CSRF-Token.' }
      : {}),
    responses: {
      '200': { description: 'OK' },
      '4XX': { description: 'Error: { error: { code, message, requestId } }' },
    },
  };
}

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'ShopSphere API',
    version: '1.0.0',
    description:
      'Cookie-session API. Mutating requests need the X-CSRF-Token returned by login / GET /auth/me. Payments are MOCK only.',
  },
  servers: [{ url: '/api/v1' }],
  components: { securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sid' } } },
  paths,
};
