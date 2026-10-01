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
-- 10. 身分驗證與權限控管 (2026-10-02 新增)
-- 改以 Supabase Auth (Google 登入) 驗證身分，並以白名單限制資料存取。
--
-- ⚠️ 執行前提（順序很重要，否則所有人都會無法使用）：
--   1. Supabase 已啟用 Google 登入 (Authentication → Sign In / Providers → Google)
--   2. 支援 Google 登入的新版前端已部署，且管理員已確認可以成功登入
-- 執行後：
--   - 未登入者 (anon) 無法讀寫任何資料
--   - 白名單成員可讀寫待辦、新增分類、修改自己的暱稱
--   - 修改/刪除分類、管理白名單僅限 admin
-- ==========================================
BEGIN;

-- 10-1. 輔助函式
-- 目前登入者的 Email（小寫）；未登入時為空字串
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- 是否為白名單成員（SECURITY DEFINER：避免在 users_whitelist 自身的 RLS 中遞迴）
CREATE OR REPLACE FUNCTION public.is_whitelisted()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users_whitelist WHERE lower(email) = public.current_user_email()
  );
$$;

-- 是否為管理員
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users_whitelist
    WHERE lower(email) = public.current_user_email() AND role = 'admin'
  );
$$;

-- 修改自己的暱稱（只能改 display_name，無法藉此修改角色或他人資料）
CREATE OR REPLACE FUNCTION public.update_my_display_name(new_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF new_name IS NULL OR length(trim(new_name)) = 0 OR length(trim(new_name)) > 30 THEN
    RAISE EXCEPTION '暱稱長度需為 1 至 30 個字';
  END IF;
  UPDATE public.users_whitelist SET display_name = trim(new_name)
  WHERE lower(email) = public.current_user_email();
  IF NOT FOUND THEN
    RAISE EXCEPTION '您的帳號不在白名單中';
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_my_display_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_display_name(text) TO authenticated;

-- 10-2. 移除三張表上所有既有原則（包含第 8 節的公開讀寫原則）
-- 原則之間是 OR 關係，只要留下任何一條 USING (true) 就等於沒有防護，因此全部清除後重建
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('users_whitelist', 'categories', 'todos')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- 10-3. 白名單：成員可讀取；新增/修改/刪除限管理員
CREATE POLICY "成員可讀取白名單" ON public.users_whitelist
  FOR SELECT TO authenticated USING (public.is_whitelisted());
CREATE POLICY "管理員可新增白名單" ON public.users_whitelist
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "管理員可修改白名單" ON public.users_whitelist
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "管理員可刪除白名單" ON public.users_whitelist
  FOR DELETE TO authenticated USING (public.is_admin());

-- 10-4. 分類：成員可讀取與新增；修改/刪除限管理員
CREATE POLICY "成員可讀取分類" ON public.categories
  FOR SELECT TO authenticated USING (public.is_whitelisted());
CREATE POLICY "成員可新增分類" ON public.categories
  FOR INSERT TO authenticated WITH CHECK (public.is_whitelisted());
CREATE POLICY "管理員可修改分類" ON public.categories
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "管理員可刪除分類" ON public.categories
  FOR DELETE TO authenticated USING (public.is_admin());

-- 10-5. 待辦：成員可讀寫；新增時建立者必須是本人
CREATE POLICY "成員可讀取待辦" ON public.todos
  FOR SELECT TO authenticated USING (public.is_whitelisted());
CREATE POLICY "成員可新增待辦" ON public.todos
  FOR INSERT TO authenticated
  WITH CHECK (public.is_whitelisted() AND lower(created_by) = public.current_user_email());
CREATE POLICY "成員可修改待辦" ON public.todos
  FOR UPDATE TO authenticated USING (public.is_whitelisted()) WITH CHECK (public.is_whitelisted());
CREATE POLICY "成員可刪除待辦" ON public.todos
  FOR DELETE TO authenticated USING (public.is_whitelisted());

COMMIT;

-- 10-6. 執行後檢查：應列出 12 條原則，且皆為 {authenticated}
-- SELECT tablename, policyname, roles, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename IN ('users_whitelist', 'categories', 'todos')
-- ORDER BY tablename, cmd;
