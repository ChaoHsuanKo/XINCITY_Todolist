# 專案深度記憶與接手手冊 (Project Memory & Handoff Guide)

本手冊彙整了本專案從 0 到 1 的架構脈絡、歷史決策歷程、常見技術問答與接手開發事項，讓您在任何電腦環境下都能立即接續開發。

---

## 📅 開發歷史脈絡與里程碑 (Timeline)

1. **原型與規格定義**
   - 制定免密碼 Email 登入流程、團隊任務指派、多維度篩選排序（依照建立時間、分類、截止時間、指派人）。
   - 設計 Slate & Indigo 專業科技感設計風格，支援即時隱藏已完成事項與過期標籤。
   - 產出視覺架構圖 `wireframe.jpg`。

2. **前端介面與雙模資料層實作**
   - 撰寫純原生前端架構：`index.html`、`style.css`、`app.js`。
   - 實作雙模資料機制：LocalStorage（離線本地）與 Supabase（雲端即時連線），無論是否連網皆能保證使用者體驗順暢。

3. **Supabase 雲端資料庫建置**
   - 專案 ID：`dofkukshtqmtdxiomzfn`
   - 完成三張核心資料表：`users_whitelist`、`categories`、`todos`。
   - 啟用 Realtime 廣播（Publication: `supabase_realtime`），讓多人同時協作時無需手動刷新網頁即可看到變更。
   - 初始化設定預設管理員為 `chaohsuan.ke@gmail.com`。

4. **安全加固與細節調整**
   - 移除登入視窗中的快捷測試帳號填充按鈕，改為手動輸入 Email，以確保只有白名單中的授權成員能進入系統，杜絕權限外洩。
   - 強化成員管理介面，僅管理員登入後可透過彈窗即時新增、刪除成員或切換角色。

5. **CI/CD 自動化發布**
   - 支援 **GitHub Pages**：透過 `.github/workflows/pages.yml`，每次推送到 `main` 分支自動部署至 `https://chaohsuanko.github.io/XINCITY_Todolist/`。
   - 相容 **GitLab Pages**：保留 `.gitlab-ci.yml` 設定。

6. **類別管理功能擴充與即時反饋修復 (2026-10-01)**
   - **管理者專屬分類修改與刪除**：側邊欄自訂類別於管理員（`role: 'admin'`）登入時顯示 ✏️ 編輯按鈕，支援在彈窗內直接修改分類名稱、標籤色彩，或刪除分類（刪除時自動將關聯待辦改為未分類）。一般成員不顯示且無修改權限。
   - **修復新增分類即時反饋問題**：解決雲端模式下 `DataService.addCategory` 未即時將回傳資料加入本地狀態清單而導致畫面未即時反映新增類別的狀況，並強化表單防呆與 Toast 提示。

---

## 🗄️ 資料庫綱要與 SQL 定義

所有資料庫建立腳本均保存在 `schema.sql` 中。若要在另一個全新 Supabase 專案建立相同環境，直接複製 `schema.sql` 到 Supabase SQL Editor 執行即可：

- `users_whitelist`：
  - `id`: UUID (Primary Key, default `gen_random_uuid()`)
  - `email`: TEXT (Unique, Not Null)
  - `display_name`: TEXT
  - `role`: TEXT ('admin' 或 'member')
  - `created_at`: TIMESTAMPTZ (default `now()`)
- `categories`：
  - `id`: UUID
  - `name`: TEXT
  - `color`: TEXT (Hex 顏色碼，如 `#6366f1`)
  - `created_at`: TIMESTAMPTZ
- `todos`：
  - `id`: UUID
  - `title`: TEXT
  - `completed`: BOOLEAN (default `false`)
  - `category_id`: UUID (Foreign Key -> `categories.id`)
  - `assigned_to`: TEXT (對應白名單的 Email 或 Name)
  - `due_date`: TIMESTAMPTZ
  - `created_by`: TEXT
  - `created_at`: TIMESTAMPTZ

---

## 🔑 金鑰與環境變數管理說明

- 專案採純靜態前端架構，**不需要在程式碼中寫死敏感金鑰**。
- 使用者可在瀏覽器前端點擊頂部「雲端連線設定（齒輪圖示）」輸入 Supabase URL 與 `anon public key`。
- 金鑰會加密存放在當前瀏覽器的 `localStorage` 中。
- 換電腦時：
  1. 打開網頁或本地伺服器。
  2. 點擊齒輪圖示，填入相同的 Supabase URL 與 `anon_key`，即可直接連上雲端現有資料庫！

---

## 🚀 未來可擴充或優化方向 (Roadmap)

1. **子任務 / 檢查清單 (Subtasks)**：可在每張 Todo 卡片內新增可勾選的子步驟。
2. **檔案與圖片附件 (Attachments)**：整合 Supabase Storage 上傳關聯附件。
3. **活動日誌 / 變更軌跡 (Activity Log)**：記錄誰在何時修改了任務或標記完成。
4. **Email 到期提醒通知**：整合 Supabase Edge Functions 或 Webhook 在任務逾期前寄發通知信。
