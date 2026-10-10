import { beforeEach, describe, expect, it } from 'vitest';
import { API, makeApp, makeProduct, prisma, request, resetData } from '../helpers';

const app = makeApp();
beforeEach(resetData);

describe('product listing', () => {
  it('paginates with correct totals and caps page size', async () => {
    const cat = await prisma.category.create({ data: { name: 'C', slug: 'c' } });
    for (let i = 0; i < 25; i++) await makeProduct({ categoryId: cat.id, price: 1000 + i * 100 });
    const p1 = (await request(app).get(`${API}/products?pageSize=10&page=1`)).body;
    expect(p1.items).toHaveLength(10);
    expect(p1.total).toBe(25);
    expect(p1.totalPages).toBe(3);
    const p3 = (await request(app).get(`${API}/products?pageSize=10&page=3`)).body;
    expect(p3.items).toHaveLength(5);
    const ids = new Set([...p1.items, ...p3.items].map((i: { id: string }) => i.id));
    expect(ids.size).toBe(15); // no duplicates across pages
    expect((await request(app).get(`${API}/products?pageSize=1000`)).status).toBe(422);
    expect((await request(app).get(`${API}/products?page=0`)).status).toBe(422);
    expect((await request(app).get(`${API}/products?page=abc`)).status).toBe(422);
  });

  it('sorts, filters by price/category/stock and searches', async () => {
    const cat = await prisma.category.create({ data: { name: 'Gadgets', slug: 'gadgets' } });
    await makeProduct({ categoryId: cat.id, price: 5000, name: 'Alpha Lamp' });
    await makeProduct({ categoryId: cat.id, price: 9000, name: 'Beta Lamp', stock: 0 });
    await makeProduct({ price: 7000, name: 'Gamma Chair' });
    const asc = (await request(app).get(`${API}/products?sort=price_asc`)).body.items.map(
      (i: { priceMinor: number }) => i.priceMinor,
    );
    expect(asc).toEqual([5000, 7000, 9000]);
    const desc = (await request(app).get(`${API}/products?sort=price_desc`)).body.items.map(
      (i: { priceMinor: number }) => i.priceMinor,
    );
    expect(desc).toEqual([9000, 7000, 5000]);
    expect((await request(app).get(`${API}/products?category=gadgets`)).body.total).toBe(2);
    expect((await request(app).get(`${API}/products?minPrice=6000&maxPrice=8000`)).body.total).toBe(
      1,
    );
    expect((await request(app).get(`${API}/products?inStock=true`)).body.total).toBe(2);
    expect((await request(app).get(`${API}/products?q=lamp`)).body.total).toBe(2);
    expect((await request(app).get(`${API}/products?q=nomatchxyz`)).body.items).toEqual([]);
    expect((await request(app).get(`${API}/products?minPrice=9000&maxPrice=100`)).status).toBe(422);
    expect((await request(app).get(`${API}/products?sort=hacked`)).status).toBe(422);
  });

  it('treats injection-style search text as plain data', async () => {
    await makeProduct({ name: 'Normal Product' });
    const res = await request(app)
      .get(`${API}/products`)
      .query({ q: '\'; DROP TABLE "Product"; --' });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(await prisma.product.count()).toBe(1);
  });

  it('hides deleted and inactive products and never exposes internal fields', async () => {
    const live = await makeProduct();
    const gone = await makeProduct();
    await prisma.product.update({
      where: { id: gone.id },
      data: { deletedAt: new Date(), isActive: false },
    });
    const list = (await request(app).get(`${API}/products`)).body;
    expect(list.items.map((i: { id: string }) => i.id)).toEqual([live.id]);
    expect((await request(app).get(`${API}/products/${gone.slug}`)).status).toBe(404);
    const detail = (await request(app).get(`${API}/products/${live.slug}`)).body.product;
    expect(detail).not.toHaveProperty('deletedAt');
    expect(detail).toHaveProperty('maxQuantity');
  });

  it('returns product detail with related products', async () => {
    const cat = await prisma.category.create({ data: { name: 'R', slug: 'r' } });
    const a = await makeProduct({ categoryId: cat.id });
    await makeProduct({ categoryId: cat.id });
    const res = await request(app).get(`${API}/products/${a.slug}`);
    expect(res.body.product.related).toHaveLength(1);
    expect((await request(app).get(`${API}/products/does-not-exist`)).status).toBe(404);
  });
});
