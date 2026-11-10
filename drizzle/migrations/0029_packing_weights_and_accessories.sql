-- Packing list weight calculator (unit net + bag + poster + extra accessories),
-- preset weight defaults, and standalone container accessory lines.

ALTER TABLE product_presets ADD COLUMN unit_net_weight_grams INTEGER NOT NULL DEFAULT 0 CHECK (unit_net_weight_grams >= 0);
ALTER TABLE product_presets ADD COLUMN bag_weight_grams INTEGER NOT NULL DEFAULT 0 CHECK (bag_weight_grams >= 0);
ALTER TABLE product_presets ADD COLUMN poster_weight_grams INTEGER NOT NULL DEFAULT 0 CHECK (poster_weight_grams >= 0);
ALTER TABLE product_presets ADD COLUMN other_accessory_weight_grams INTEGER NOT NULL DEFAULT 0 CHECK (other_accessory_weight_grams >= 0);
ALTER TABLE product_presets ADD COLUMN extra_accessories_json TEXT;

UPDATE product_presets
SET unit_net_weight_grams = CASE
  WHEN piece_weight_grams IS NOT NULL AND piece_weight_grams > 0 THEN piece_weight_grams
  WHEN name LIKE '%2.4KG%' THEN 2400
  WHEN name LIKE '%2.7KG%' THEN 2700
  WHEN name LIKE '%3.7KG%' THEN 3700
  WHEN name LIKE '%5.7KG%' THEN 5700
  WHEN name LIKE '%3KG%' THEN 3000
  WHEN name LIKE '%4KG%' THEN 4000
  WHEN name LIKE '%6KG%' THEN 6000
  ELSE 0
END,
piece_weight_grams = COALESCE(
  piece_weight_grams,
  CASE
    WHEN name LIKE '%2.4KG%' THEN 2400
    WHEN name LIKE '%2.7KG%' THEN 2700
    WHEN name LIKE '%3.7KG%' THEN 3700
    WHEN name LIKE '%5.7KG%' THEN 5700
    WHEN name LIKE '%3KG%' THEN 3000
    WHEN name LIKE '%4KG%' THEN 4000
    WHEN name LIKE '%6KG%' THEN 6000
    ELSE NULL
  END
);

ALTER TABLE packing_lines ADD COLUMN line_type TEXT NOT NULL DEFAULT 'PRODUCT' CHECK (line_type IN ('PRODUCT', 'ACCESSORY'));
ALTER TABLE packing_lines ADD COLUMN unit_net_weight_grams INTEGER NOT NULL DEFAULT 0 CHECK (unit_net_weight_grams >= 0);
ALTER TABLE packing_lines ADD COLUMN bag_weight_grams INTEGER NOT NULL DEFAULT 0 CHECK (bag_weight_grams >= 0);
ALTER TABLE packing_lines ADD COLUMN poster_weight_grams INTEGER NOT NULL DEFAULT 0 CHECK (poster_weight_grams >= 0);
ALTER TABLE packing_lines ADD COLUMN other_accessory_weight_grams INTEGER NOT NULL DEFAULT 0 CHECK (other_accessory_weight_grams >= 0);
ALTER TABLE packing_lines ADD COLUMN extra_accessories_json TEXT;
ALTER TABLE packing_lines ADD COLUMN manual_weight_override INTEGER NOT NULL DEFAULT 0 CHECK (manual_weight_override IN (0, 1));
ALTER TABLE packing_lines ADD COLUMN include_pieces_in_reconciliation INTEGER NOT NULL DEFAULT 1 CHECK (include_pieces_in_reconciliation IN (0, 1));

