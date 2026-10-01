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
