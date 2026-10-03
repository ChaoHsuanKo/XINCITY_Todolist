-- ==========================================
-- 團隊待辦清單 (TodoList) Supabase 資料庫腳本
-- 請在 Supabase 後台的 "SQL Editor" 中貼上並執行即可一鍵完成
-- ==========================================

-- 1. 啟用 UUID 擴充功能
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. 建立使用者白名單表 (users_whitelist)
CREATE TABLE IF NOT EXISTS public.users_whitelist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 3. 建立分類標籤表 (categories)
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3b82f6',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 4. 建立待辦事項表 (todos)
CREATE TABLE IF NOT EXISTS public.todos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    assigned_email TEXT REFERENCES public.users_whitelist(email) ON UPDATE CASCADE ON DELETE SET NULL,
    due_date TIMESTAMPTZ,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    completed_at TIMESTAMPTZ
);

-- 5. 插入初始預設分類
INSERT INTO public.categories (name, color) VALUES
    ('工作專案', '#3b82f6'),
    ('個人生活', '#10b981'),
    ('緊急任務', '#ef4444')
ON CONFLICT DO NOTHING;

-- 6. 插入初始白名單示範使用者 (請自行替換成您的實際 Email)
INSERT INTO public.users_whitelist (email, display_name, role) VALUES
    ('chaohsuan.ke@gmail.com', '系統管理員', 'admin'),
    ('sarah@example.com', '陳小華', 'member')
ON CONFLICT (email) DO NOTHING;

-- 7. 啟用即時同步 (Realtime)
-- 將此三張表加入 supabase_realtime 發布頻道中，實現跨用戶畫面即時同步
ALTER PUBLICATION supabase_realtime ADD TABLE public.users_whitelist;
ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;

-- 8. 設定公開讀寫原則 (Row Level Security - RLS)
ALTER TABLE public.users_whitelist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;

-- 建立免認證 Anon Key 可存取之原則 (供前端使用)
CREATE POLICY "允許公開讀取白名單" ON public.users_whitelist FOR SELECT USING (true);
CREATE POLICY "允許公開更新暱稱" ON public.users_whitelist FOR UPDATE USING (true);
CREATE POLICY "允許管理員新增白名單" ON public.users_whitelist FOR INSERT WITH CHECK (true);
CREATE POLICY "允許管理員刪除白名單" ON public.users_whitelist FOR DELETE USING (true);

CREATE POLICY "允許所有人讀取分類" ON public.categories FOR SELECT USING (true);
CREATE POLICY "允許所有人維護分類" ON public.categories FOR ALL USING (true);

CREATE POLICY "允許所有人讀取待辦" ON public.todos FOR SELECT USING (true);
CREATE POLICY "允許所有人維護待辦" ON public.todos FOR ALL USING (true);

-- ==========================================
-- 9. 任務詳情擴充欄位 (2026-10-01 新增)
-- 若資料庫已建立，請在 SQL Editor 單獨執行以下指令即可完成升級
-- ==========================================
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high'));
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS subtasks JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ==========================================
-- 11. 任務指派 Email 通知 (2026-10-03 新增)
-- 任務被指派負責人（新增或改派）時，呼叫 Edge Function「notify-assignee」寄信給負責人。
-- 前置：已部署 supabase/functions/notify-assignee 並設定 Secrets。
-- ⚠️ 執行前請將下方 <WEBHOOK_SECRET> 替換為與 Edge Function Secrets 相同的密鑰
--    （密鑰請勿提交至 Git，此倉庫為公開狀態）
-- ==========================================

-- 11-1. 記錄指派者（用於判斷「自己指派給自己」不寄信，並顯示於信件中）
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS assigned_by TEXT;

-- 11-2. 啟用 pg_net（資料庫內發送非同步 HTTP 請求，於交易提交後才送出，不影響存檔速度）
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 11-3. 觸發器函式：僅在「指派了新的負責人」且「不是指派給自己」時呼叫 Edge Function
CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_email IS NULL THEN
    RETURN NEW;
  END IF;
  -- 負責人沒有變更（只改了其他欄位）則不重複寄信
  IF TG_OP = 'UPDATE' AND lower(NEW.assigned_email) IS NOT DISTINCT FROM lower(OLD.assigned_email) THEN
    RETURN NEW;
  END IF;
  -- 自己指派給自己不寄信（新增時若舊版前端未帶 assigned_by，以建立者判斷）
  IF lower(NEW.assigned_email) = lower(coalesce(NEW.assigned_by, CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by END, '')) THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://dofkukshtqmtdxiomzfn.supabase.co/functions/v1/notify-assignee',
    body := jsonb_build_object('todo_id', NEW.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '<WEBHOOK_SECRET>'
    ),
    timeout_milliseconds := 10000
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_todo_assigned ON public.todos;
CREATE TRIGGER on_todo_assigned
  AFTER INSERT OR UPDATE OF assigned_email ON public.todos
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_assignment();

-- 11-4. 寄信失敗排查：查看最近的 HTTP 呼叫結果（status_code 200 = 成功）
-- SELECT id, status_code, content, created FROM net._http_response ORDER BY created DESC LIMIT 10;

-- ==========================================
-- 12. 同時通知 (CC) 設定 (2026-10-03 新增)
-- 管理員可為每位成員設定「同時通知」名單：任務指派給該成員時，名單中的成員也會收到副本。
-- ⚠️ 執行前請將下方 <WEBHOOK_SECRET> 替換為與 Edge Function Secrets 相同的密鑰
-- ==========================================

-- 12-1. 成員的同時通知名單（Email 陣列）
ALTER TABLE public.users_whitelist ADD COLUMN IF NOT EXISTS notify_cc TEXT[] NOT NULL DEFAULT '{}';

-- 12-2. 更新觸發器：移除「自己指派給自己不寄信」判斷，改由 Edge Function 決定
--       （自己指派給自己時，負責人本人不收信，但同時通知名單的成員仍會收到）
CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_email IS NULL THEN
    RETURN NEW;
  END IF;
  -- 負責人沒有變更（只改了其他欄位）則不重複寄信
  IF TG_OP = 'UPDATE' AND lower(NEW.assigned_email) IS NOT DISTINCT FROM lower(OLD.assigned_email) THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://dofkukshtqmtdxiomzfn.supabase.co/functions/v1/notify-assignee',
    body := jsonb_build_object('todo_id', NEW.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', '<WEBHOOK_SECRET>'
    ),
    timeout_milliseconds := 10000
  );
  RETURN NEW;
END;
$$;

-- ==========================================
-- 13. 任務開始日期 (2026-10-03 新增)
-- 記錄問題提出／任務開始的日期，用於計算「已進行幾天」與「經幾天結案」。
-- 未設定時前端與通知信以建立日期為準。
-- ==========================================
ALTER TABLE public.todos ADD COLUMN IF NOT EXISTS start_date DATE;
