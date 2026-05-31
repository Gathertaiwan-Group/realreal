BEGIN;
UPDATE products SET category_id = '133ad6b1-ada9-4add-9d65-8bf99cf31355'
  WHERE category_id IN ('18f467f1-08be-4873-96b9-419035d25c42','f000cbd4-24da-4dd6-96dc-72d931baaab4','f267240a-3d59-44ef-b8cf-276d880fcb7d');
UPDATE products SET category_id = '0c27248d-807f-43a0-9a25-a50fc2bea69a'
  WHERE category_id = '72d7314f-9bed-42e3-ad0b-3719fff40e4c';
UPDATE products SET category_id = 'c6489e2f-1a47-45fc-ac39-034b177ccd06'
  WHERE category_id IN ('364b3a46-1ec2-43ad-a044-f0cb982e1cfd','4de98bf4-993a-4c12-98e2-314ae5920542');
DELETE FROM categories WHERE id IN ('18f467f1-08be-4873-96b9-419035d25c42','f000cbd4-24da-4dd6-96dc-72d931baaab4','f267240a-3d59-44ef-b8cf-276d880fcb7d','364b3a46-1ec2-43ad-a044-f0cb982e1cfd','4de98bf4-993a-4c12-98e2-314ae5920542','72d7314f-9bed-42e3-ad0b-3719fff40e4c');
UPDATE categories SET slug = 'gift' WHERE id = 'c6489e2f-1a47-45fc-ac39-034b177ccd06';
UPDATE categories SET sort_order = 1 WHERE slug = 'plant-based-powder';
UPDATE categories SET sort_order = 2 WHERE slug = 'freeze-dried';
UPDATE categories SET sort_order = 3 WHERE slug = 'sustain-life';
UPDATE categories SET sort_order = 4 WHERE slug = 'gift';
COMMIT;
