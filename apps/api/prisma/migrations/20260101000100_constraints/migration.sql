-- Data-integrity CHECK constraints (Prisma's schema language cannot express these).
-- They are the last line of defence: even buggy application code cannot oversell stock
-- or store nonsensical prices.
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_positive" CHECK ("priceMinor" > 0 AND "mrpMinor" >= "priceMinor");
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_range" CHECK ("quantity" BETWEEN 1 AND 10);
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" > 0 AND "unitPriceMinor" > 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_totals_nonnegative" CHECK ("subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "shippingMinor" >= 0 AND "taxMinor" >= 0 AND "totalMinor" >= 0);
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_value_valid" CHECK ("value" > 0 AND ("type" <> 'PERCENT' OR "value" <= 100));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_nonnegative" CHECK ("amountMinor" >= 0);
