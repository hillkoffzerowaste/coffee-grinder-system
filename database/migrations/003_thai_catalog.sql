-- Add whole-bean Thai-labelled products that the original English-unit parser omitted.
with source(sku,name,size_grams,unit,barcode) as (
  values
    ('RB-HK-0061','กาแฟซองแดง French 250 กรัม',250,'Pcs','8857109002741'),
    ('RB-HK-0015','กาแฟซองแดง French 500 กรัม',500,'Pcs','8857109002754'),
    ('RB-HK-0095','กาแฟซองแดง Italian 250 กรัม',250,'Pcs','8857109011237'),
    ('RB-HK-0060','กาแฟซองแดง Italian 500 กรัม',500,'Pcs','8857109002730')
), upserted_products as (
  insert into coffee.products(sku,name,size_grams,unit)
  select sku,name,size_grams,unit from source
  on conflict(sku) do update set name=excluded.name,size_grams=excluded.size_grams,unit=excluded.unit
  returning id,sku
)
insert into coffee.product_barcodes(product_id,barcode)
select p.id,s.barcode from source s join upserted_products p using(sku)
on conflict(barcode) do nothing;
