-- ============================================================
-- RLS Policies for rendimientos.co (Supabase)
-- Run this in: Supabase Dashboard > SQL Editor
-- ============================================================

-- ─── Holdings Table ───

ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own holdings" ON public.holdings;
DROP POLICY IF EXISTS "Users can insert own holdings" ON public.holdings;
DROP POLICY IF EXISTS "Users can update own holdings" ON public.holdings;
DROP POLICY IF EXISTS "Users can delete own holdings" ON public.holdings;

CREATE POLICY "Users can view own holdings" ON public.holdings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own holdings" ON public.holdings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own holdings" ON public.holdings
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own holdings" ON public.holdings
  FOR DELETE USING (auth.uid() = user_id);

-- ─── Page Views Table ───

ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert page views" ON public.page_views;

CREATE POLICY "Anyone can insert page views" ON public.page_views
  FOR INSERT WITH CHECK (
    length(path) <= 200
    AND (referrer IS NULL OR length(referrer) <= 500)
  );

-- No SELECT/UPDATE/DELETE policies = no API access for reading/modifying
-- Query page_views only via Supabase Dashboard or service_role key

-- ─── Database Constraints ───

ALTER TABLE public.holdings
  DROP CONSTRAINT IF EXISTS holdings_asset_type_check;
ALTER TABLE public.holdings
  ADD CONSTRAINT holdings_asset_type_check
  CHECK (asset_type IN ('soberano', 'on', 'cer', 'lecap', 'fci', 'garantizado', 'cash', 'custom'));

ALTER TABLE public.holdings
  DROP CONSTRAINT IF EXISTS holdings_ticker_length;
ALTER TABLE public.holdings
  ADD CONSTRAINT holdings_ticker_length CHECK (length(ticker) <= 50);

ALTER TABLE public.holdings
  DROP CONSTRAINT IF EXISTS holdings_quantity_positive;
ALTER TABLE public.holdings
  ADD CONSTRAINT holdings_quantity_positive CHECK (quantity >= 0);

ALTER TABLE public.holdings
  DROP CONSTRAINT IF EXISTS holdings_price_non_negative;
ALTER TABLE public.holdings
  ADD CONSTRAINT holdings_price_non_negative CHECK (purchase_price >= 0);

ALTER TABLE public.page_views
  DROP CONSTRAINT IF EXISTS pv_path_length;
ALTER TABLE public.page_views
  ADD CONSTRAINT pv_path_length CHECK (length(path) <= 200);

ALTER TABLE public.page_views
  DROP CONSTRAINT IF EXISTS pv_referrer_length;
ALTER TABLE public.page_views
  ADD CONSTRAINT pv_referrer_length CHECK (referrer IS NULL OR length(referrer) <= 500);

-- ─── Limit Holdings Per User (prevent DB stuffing) ───

CREATE OR REPLACE FUNCTION check_holdings_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT count(*) FROM public.holdings WHERE user_id = NEW.user_id) >= 100 THEN
    RAISE EXCEPTION 'Maximum 100 holdings per user';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_holdings_limit ON public.holdings;
CREATE TRIGGER enforce_holdings_limit
  BEFORE INSERT ON public.holdings
  FOR EACH ROW EXECUTE FUNCTION check_holdings_limit();
