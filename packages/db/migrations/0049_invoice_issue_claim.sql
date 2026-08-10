-- 0049: 開立電子發票的 claim-then-act 鎖（結構上杜絕「一張訂單兩張發票」）
--
-- Background: 稽核發現開票路徑有可能對同一張訂單開出兩張真發票，而發票開出去撤不
-- 回來（財政部那邊多一張就是多一張，只能再開一張作廢單去沖銷，而客人的信箱裡已經
-- 躺著兩份稅務憑證）。目前之所以還沒發生，是因為最容易觸發的那段期間 Amego 剛好
-- 因 IP 白名單把所有請求都拒絕了 —— 是運氣，不是設計。
--
-- 缺口在 apps/api/src/workers/invoice-issuer.ts：
--   1. issueInvoice() 是不可逆副作用，打 /json/c0401 沒有帶任何冪等鍵
--   2. 從 Amego 回應到 DB update 落地之間，**資料庫裡沒有任何「已送出」的痕跡**
--   3. 兩道守門（.neq("status","issued") 與 status === "issued" 早退）都只看 persist
--      後的狀態，在那個窗口內全部放行
--   4. 行程在該窗口被殺（部署、OOM、BullMQ stalled 重投）→ 下一次重試直接再開一張
--
-- Design（抄 interval-books 的模型，不是抄它的程式碼——兩邊 schema 與框架不同）：
--
--   claim-then-act：呼叫 Amego **之前**先在 DB 原子地把該筆標成 'issuing'（宣告
--   「我要開了」），成功後才寫終局狀態。於是「已送出但還沒記錄」這個窗口在資料庫
--   裡是**看得見**的，而不是一段沒有痕跡的空白。
--
--   claim 的原子性由兩件事保證，且同在一個交易裡：
--     閘門 1  select ... from orders where id = ... for update
--             用訂單列本身當序列化點。invoices 目前沒有 order_id 的 unique
--             constraint（見下方 D 段），同一張訂單理論上可以有兩列 invoice；用
--             訂單列當鎖，即使有兩列也只會有一個 claim 通得過。
--     閘門 2  invoices 的 CAS：只有 pending、或「issuing 但已經過期」的列准轉成
--             issuing。RETURNING 沒有列 = 搶輸 = 這一次什麼都不要做。
--
--   stale 回收：claim 本身就會接手過期的 issuing，所以 reclaim_stale_invoices()
--   不是正確性必需品，是**誠實性**必需品——行程被砍掉之後，'issuing' 這個狀態說的
--   是「現在有人正在開」，而那是假的。撥回 pending 並寫上 error_message，這一列才
--   會重新出現在後台的待處理清單與人的眼睛裡。
--
--   最關鍵的一招在程式端（lib/amego.ts 的 findInvoiceByOrderId）：重試時先用
--   OrderId 向 Amego 反查，若對方其實已經開出來了就認回那張，而不是再開一張。
--   本檔提供它需要的那個訊號 —— `issue_attempts`。
--
-- ⚠️ 為什麼要新增 issue_attempts 而不是沿用 retry_count
--    invoice-issuer.ts 成功時把 retry_count 重設為 0，所以 retry_count **不能**反推
--    「這一列是不是重試過」。反查認回的判斷完全靠「以前是否送出過」，用一個會被歸零
--    的計數器去判斷，等於在最需要反查的那一次（前一次剛好成功寫進 Amego、我們沒記到）
--    選擇不反查。issue_attempts 由 claim 遞增、**永不歸零**，這是它存在的唯一理由。
--
-- ## 套用順序：**先 DB，後程式碼**
--    本檔只做加欄位、放寬 CHECK、建函式，全部向後相容：舊版程式碼（不認識
--    'issuing'、不呼叫這些函式）在套用後行為完全不變。反過來先部署程式碼則會在
--    claim RPC 上拿到 PGRST202（function not found），開票全數停擺。
--
-- ## 對既有 52 筆 invoices 的影響：無
--    - ADD COLUMN ... IF NOT EXISTS 兩個新欄位皆可為 NULL 或有 DEFAULT，不動既有值
--    - CHECK 只**放寬**（多允許一個 'issuing'），既有 pending/issued/voided 全部續存
--    - 沒有任何 UPDATE / DELETE 既有資料
--    - 27 筆卡住待補開的發票仍是 status='pending'，補開路徑
--      POST /admin/invoices/:id/reissue 照常可用（且在新設計下可安全重跑）
--
-- 本檔可重複執行（idempotent），符合本 repo「人工貼進 Supabase SQL Editor」的慣例。

-- ---------------------------------------------------------------------------
-- A) 新欄位
-- ---------------------------------------------------------------------------

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS issue_attempts INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN invoices.locked_at IS
  'claim 的時間戳。status=''issuing'' 時代表「有人正在開這張」；超過 stale 門檻視為
   該行程已死，claim 或 reclaim_stale_invoices() 可以接手。';

COMMENT ON COLUMN invoices.issue_attempts IS
  '這一列送出過幾次開立請求（由 claim_invoice_issue 遞增，**永不歸零**）。
   >0 代表「以前送出過」，開票前必須先向 Amego 反查有沒有已經開出來 —— 這是
   「Amego 開了但我們沒記到」唯一可靠的偵測訊號。不要用 retry_count 取代它：
   retry_count 成功時會被重設為 0。';

-- ---------------------------------------------------------------------------
-- B) status 放寬：多一個中間狀態 'issuing'
-- ---------------------------------------------------------------------------
-- 0001_initial.sql:144 的 inline CHECK 只允許 pending/issued/voided。
-- 這裡 DROP 舊的、ADD 新的（只增不減，既有列全部通過）。
-- 刻意**不**加 'failed'：失敗的列一律退回 'pending'，這樣後台既有的
-- 「status=pending」篩選、worker 的 .neq("status","issued")、以及 27 筆待補開的
-- 發票，行為與外觀全部維持不變。失敗的痕跡留在 error_message / retry_count。

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invoices'::regclass
      AND conname = 'invoices_status_check'
  ) THEN
    ALTER TABLE invoices DROP CONSTRAINT invoices_status_check;
  END IF;

  ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('pending', 'issuing', 'issued', 'voided'));
END $$;

-- 卡在 issuing 的列要能被便宜地掃出來（reclaim 與後台監控共用）。
CREATE INDEX IF NOT EXISTS idx_invoices_issuing_locked_at
  ON invoices (locked_at)
  WHERE status = 'issuing';

-- ---------------------------------------------------------------------------
-- C) claim_invoice_issue — 開票前唯一的入口
-- ---------------------------------------------------------------------------
-- claimed=true 才可以呼叫 Amego。claimed=false 時 reason 說明為什麼：
--   invoice_not_found  找不到對應的 invoice 列
--   already_issued     已經開過了（回傳發票號碼，呼叫端當成冪等成功）
--   voided             已作廢，不自動重開
--   locked             另一個執行緒正在開，這一次什麼都不要做
--   retries_exhausted  連續失敗到上限，等人處理（走 reissue 會把計數歸零）
--
-- p_order_id 與 p_invoice_id 給其中一個就好（兩個 producer 各給一種）：
--   lib/enqueue-post-payment.ts 給 orderId、routes/invoices.ts 給 invoiceId。
-- 兩者最後都會被解析到「同一張訂單的同一列」，因為序列化點是訂單列而不是發票列。

CREATE OR REPLACE FUNCTION public.claim_invoice_issue(
  p_order_id    UUID DEFAULT NULL,
  p_invoice_id  UUID DEFAULT NULL,
  p_stale_after INTERVAL DEFAULT '10 minutes',
  p_max_retries INT DEFAULT 10
)
RETURNS TABLE (
  claimed        BOOLEAN,
  reason         TEXT,
  invoice_id     UUID,
  order_id       UUID,
  attempt        INT,
  order_number   TEXT,
  invoice_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id UUID;
  v_order_no TEXT;
  v_inv      public.invoices%ROWTYPE;
  v_issued   public.invoices%ROWTYPE;
BEGIN
  IF p_order_id IS NULL AND p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'NEED_ORDER_ID_OR_INVOICE_ID';
  END IF;

  -- 先把兩種入口都收斂成 order_id。
  v_order_id := p_order_id;
  IF v_order_id IS NULL THEN
    SELECT i.order_id INTO v_order_id FROM public.invoices i WHERE i.id = p_invoice_id;
    IF v_order_id IS NULL THEN
      RETURN QUERY SELECT false, 'invoice_not_found', p_invoice_id, NULL::UUID, 0, NULL::TEXT, NULL::TEXT;
      RETURN;
    END IF;
  END IF;

  -- ---- 閘門 1：訂單列鎖 ---------------------------------------------------
  -- 序列化點。兩個並行的 claim 一定有一個先拿到列鎖，另一個要等它 commit 之後才
  -- 讀得到「已經被搶走」的狀態。少了這一道，兩邊會同時讀到 status='pending'。
  --
  -- 刻意**不**在這裡檢查 payment_status='paid'：那會讓任何 payment_status 不是
  -- 'paid' 字面值的既有訂單（含 27 筆待補開裡可能存在的邊界狀態）永遠開不出發票，
  -- 違反「不可以讓卡住的發票更難補開」。訂單列在這裡只當鎖用。
  SELECT o.order_number INTO v_order_no
    FROM public.orders o
   WHERE o.id = v_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invoice_not_found', p_invoice_id, v_order_id, 0, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- 這張訂單只要有**任何**一列已經開出去了，就絕不再開第二張——即使呼叫端指名的是
  -- 另一列。invoices 沒有 order_id 的 unique constraint，這一段就是補那個洞。
  SELECT * INTO v_issued
    FROM public.invoices i
   WHERE i.order_id = v_order_id
     AND i.status = 'issued'
   ORDER BY i.id
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT false, 'already_issued', v_issued.id, v_order_id,
                        COALESCE(v_issued.issue_attempts, 0), v_order_no, v_issued.invoice_number;
    RETURN;
  END IF;

  -- 挑出要開的那一列。指名 invoice_id 就用那一列；否則挑同一訂單裡最該被推進的
  -- 那一列（issuing 優先於 pending，其餘照 id 固定順序，結果可預期）。
  IF p_invoice_id IS NOT NULL THEN
    SELECT * INTO v_inv FROM public.invoices i WHERE i.id = p_invoice_id FOR UPDATE;
  ELSE
    SELECT * INTO v_inv
      FROM public.invoices i
     WHERE i.order_id = v_order_id
       AND i.status <> 'voided'
     ORDER BY (i.status = 'issuing') DESC, i.id
     LIMIT 1
       FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'invoice_not_found', p_invoice_id, v_order_id, 0, v_order_no, NULL::TEXT;
    RETURN;
  END IF;

  IF v_inv.status = 'voided' THEN
    RETURN QUERY SELECT false, 'voided', v_inv.id, v_order_id,
                        COALESCE(v_inv.issue_attempts, 0), v_order_no, v_inv.invoice_number;
    RETURN;
  END IF;

  IF COALESCE(v_inv.retry_count, 0) >= p_max_retries THEN
    RETURN QUERY SELECT false, 'retries_exhausted', v_inv.id, v_order_id,
                        COALESCE(v_inv.issue_attempts, 0), v_order_no, NULL::TEXT;
    RETURN;
  END IF;

  -- ---- 閘門 2：invoices 的 CAS -------------------------------------------
  -- 過期的 issuing 也放行：程序在呼叫 Amego 途中被砍掉時狀態會永遠停在 issuing，
  -- 沒有這一條就再也沒有人能接手（客人的發票也永遠不會開出來）。接手是安全的，
  -- 因為 issue_attempts 已經 >0，程式端一定會先向 Amego 反查。
  UPDATE public.invoices i
     SET status         = 'issuing',
         locked_at      = now(),
         issue_attempts = COALESCE(i.issue_attempts, 0) + 1,
         error_message  = NULL
   WHERE i.id = v_inv.id
     AND (i.status = 'pending'
          OR (i.status = 'issuing'
              AND (i.locked_at IS NULL OR i.locked_at < now() - p_stale_after)))
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    -- 有人比我們早一步。這是正常的併發結果，不是錯誤。
    RETURN QUERY SELECT false, 'locked', v_inv.id, v_order_id, 0, v_order_no, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'claimed', v_inv.id, v_order_id,
                      v_inv.issue_attempts, v_order_no, NULL::TEXT;
END $$;

COMMENT ON FUNCTION public.claim_invoice_issue(UUID, UUID, INTERVAL, INT) IS
  '開發票前的原子 claim：訂單列鎖 + invoices 的 CAS，同一交易。claimed=true 才可以
   呼叫 Amego。回傳的 attempt>1 代表這一列以前送出過，呼叫端必須先反查再開。';

-- ---------------------------------------------------------------------------
-- D) finish_invoice_issue — Amego 回 code 0（或反查認回）之後
-- ---------------------------------------------------------------------------
-- 這裡是「一張訂單開出兩張發票」的絆線。同一張訂單已經有一個**不同的**發票號碼，
-- 代表真的多開了一張稅務憑證；那不是可以 log 一行帶過的事，直接 raise，讓呼叫端的
-- 錯誤路徑吵起來（worker 的 failed handler 會送進 Sentry）。
--
-- 同一個號碼再寫一次是重送，回 false 當成成功——反查認回與 BullMQ 重投都會走到。

CREATE OR REPLACE FUNCTION public.finish_invoice_issue(
  p_invoice_id     UUID,
  p_invoice_number TEXT,
  p_random_code    TEXT DEFAULT NULL,
  p_amego_id       TEXT DEFAULT NULL,
  p_issued_at      TIMESTAMPTZ DEFAULT now()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv   public.invoices%ROWTYPE;
  v_other public.invoices%ROWTYPE;
BEGIN
  IF p_invoice_number IS NULL OR length(btrim(p_invoice_number)) = 0 THEN
    RAISE EXCEPTION 'EMPTY_INVOICE_NUMBER';
  END IF;

  SELECT * INTO v_inv FROM public.invoices i WHERE i.id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_ROW_MISSING:%', p_invoice_id;
  END IF;

  -- 同一張訂單的**其他**列已經掛著另一個號碼 → 真的重複開立了。
  SELECT * INTO v_other
    FROM public.invoices i
   WHERE i.order_id = v_inv.order_id
     AND i.id <> v_inv.id
     AND i.status = 'issued'
     AND i.invoice_number IS DISTINCT FROM p_invoice_number
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'DOUBLE_ISSUE:order=% existing=% incoming=%',
      v_inv.order_id, v_other.invoice_number, p_invoice_number;
  END IF;

  IF v_inv.status = 'issued' THEN
    IF v_inv.invoice_number IS DISTINCT FROM p_invoice_number THEN
      RAISE EXCEPTION 'DOUBLE_ISSUE:invoice=% existing=% incoming=%',
        v_inv.id, v_inv.invoice_number, p_invoice_number;
    END IF;
    RETURN false;  -- 同號重送，冪等
  END IF;

  UPDATE public.invoices i
     SET status         = 'issued',
         invoice_number = p_invoice_number,
         random_code    = COALESCE(p_random_code, i.random_code),
         amego_id       = COALESCE(p_amego_id, p_invoice_number),
         issued_at      = COALESCE(p_issued_at, now()),
         error_message  = NULL,
         locked_at      = NULL,
         retry_count    = 0
   WHERE i.id = v_inv.id;

  RETURN true;
END $$;

COMMENT ON FUNCTION public.finish_invoice_issue(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) IS
  '記錄開立成功（或反查認回）並釋放 claim。同一訂單出現第二個發票號碼時 raise
   DOUBLE_ISSUE；同號重送回 false 當成冪等成功。';

-- ---------------------------------------------------------------------------
-- E) fail_invoice_issue — 開立失敗，把 claim 還回去
-- ---------------------------------------------------------------------------
-- 退回 'pending'（不是新狀態），所以後台清單、worker 查詢、補開路徑全部不受影響。
-- issue_attempts **不動**（它記的是「送出過幾次」，失敗也算送出過）。
-- p_permanent=true（統編格式錯、金額算錯等重試一萬次還是同一個答案的）直接把
-- retry_count 推到上限，之後的 claim 一律回 retries_exhausted，等人改資料。
--
-- 絕不碰 status='issued' 的列：發票已經開出去了，任何「還原成 pending」都是在
-- 邀請系統再開一張。

CREATE OR REPLACE FUNCTION public.fail_invoice_issue(
  p_invoice_id  UUID,
  p_error       TEXT,
  p_permanent   BOOLEAN DEFAULT false,
  p_max_retries INT DEFAULT 10
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_retry INT;
BEGIN
  UPDATE public.invoices i
     SET status        = 'pending',
         locked_at     = NULL,
         error_message = left(COALESCE(p_error, 'unknown'), 500),
         retry_count   = CASE WHEN p_permanent
                              THEN greatest(COALESCE(i.retry_count, 0) + 1, p_max_retries)
                              ELSE COALESCE(i.retry_count, 0) + 1
                         END
   WHERE i.id = p_invoice_id
     AND i.status <> 'issued'
  RETURNING i.retry_count INTO v_retry;

  RETURN COALESCE(v_retry, -1);
END $$;

COMMENT ON FUNCTION public.fail_invoice_issue(UUID, TEXT, BOOLEAN, INT) IS
  '記錄開立失敗並釋放 claim（退回 pending，留下 error_message）。p_permanent 把
   retry_count 推到上限以停止自動重試。永遠不碰已經 issued 的列。';

-- ---------------------------------------------------------------------------
-- F) reclaim_stale_invoices — 把卡在 issuing 的撿回來
-- ---------------------------------------------------------------------------
-- claim_invoice_issue 本身就會接手過期的 issuing，所以這支不是正確性必需品，而是
-- 誠實性必需品：行程被砍掉之後 'issuing' 說的是「現在有人正在開」，而那是假的。
-- 後台的 status=pending 篩選看不到它，人也看不到。撥回 pending 並寫上
-- error_message，這一列才會重新出現在待處理清單裡。
--
-- 撿回來之後重試是安全的，因為 issue_attempts 已經 >0，程式端一定會先反查 Amego。

CREATE OR REPLACE FUNCTION public.reclaim_stale_invoices(
  p_stale_after INTERVAL DEFAULT '10 minutes',
  p_limit       INT DEFAULT 100
)
RETURNS TABLE (invoice_id UUID, order_id UUID, stuck_since TIMESTAMPTZ, attempts INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 THEN
    RAISE EXCEPTION 'INVALID_LIMIT:%', p_limit;
  END IF;

  -- 先撈 id（skip locked：正在跑的 claim 不要互相擋），再更新。
  SELECT array_agg(c.id) INTO v_ids
    FROM (
      SELECT i.id
        FROM public.invoices i
       WHERE i.status = 'issuing'
         AND (i.locked_at IS NULL OR i.locked_at < now() - p_stale_after)
       ORDER BY i.locked_at NULLS FIRST
       LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    ) c;

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.invoices i
     SET status        = 'pending',
         locked_at     = NULL,
         error_message = 'stale_issuing_reclaimed'
   WHERE i.id = ANY(v_ids)
  RETURNING i.id, i.order_id, i.locked_at, i.issue_attempts;
END $$;

COMMENT ON FUNCTION public.reclaim_stale_invoices(INTERVAL, INT) IS
  '把卡在 issuing 超過 p_stale_after 的發票撥回 pending，讓它重新出現在待處理清單。
   純為可觀測性存在（claim 本來就會接手過期的 issuing）。';

-- ---------------------------------------------------------------------------
-- G) 權限：SECURITY DEFINER，絕不能讓瀏覽器的金鑰碰得到
-- ---------------------------------------------------------------------------
-- execute 預設就 grant 給 public，所以「從 public revoke」才是真正生效的那一半；
-- anon / authenticated 是保險（0036 已對 invoices 開了 RLS，但函式繞過 RLS）。

DO $$
DECLARE sig TEXT;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.claim_invoice_issue(uuid, uuid, interval, int)',
    'public.finish_invoice_issue(uuid, text, text, text, timestamptz)',
    'public.fail_invoice_issue(uuid, text, boolean, int)',
    'public.reclaim_stale_invoices(interval, int)'
  ]
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM public', sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- H) 加碼：order_id 的 unique index（只有在資料本來就乾淨時才建）
-- ---------------------------------------------------------------------------
-- invoices 目前對 order_id 沒有任何 unique constraint，而
-- lib/enqueue-post-payment.ts 是 read-then-insert（.maybeSingle() 檢查再 insert），
-- 本身就有 race window：兩個並行的 webhook 可以各插一列。claim 用訂單列當鎖已經
-- 讓「兩列也只開一張」，這個 index 是把問題再往前擋一層。
--
-- 刻意**不**無條件建立：線上若已存在同一訂單多列 invoice，CREATE UNIQUE INDEX 會
-- 直接失敗，而本檔是人工貼進 SQL Editor 執行的，失敗會讓人以為整份 migration 沒生效。
-- 這裡先檢查，有重複就只印 NOTICE 跳過（claim 那一層仍然保護得住），並把重複列印
-- 出來讓人決定怎麼合併。
DO $$
DECLARE
  v_dupes INT;
BEGIN
  SELECT count(*) INTO v_dupes
    FROM (SELECT order_id FROM public.invoices GROUP BY order_id HAVING count(*) > 1) d;

  IF v_dupes > 0 THEN
    RAISE NOTICE '⚠️  invoices 有 % 個 order_id 對應到多列，略過建立 unique index。'
      ' claim_invoice_issue 的訂單列鎖仍然保證不會重複開立；請人工確認這些訂單：'
      ' SELECT order_id, count(*) FROM invoices GROUP BY order_id HAVING count(*) > 1;',
      v_dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_order_id_unique
      ON public.invoices (order_id);
    RAISE NOTICE '✅ 已建立 invoices(order_id) unique index。';
  END IF;
END $$;
