# Antigravity & AI Agent 工作區指引與記憶 (Workspace Instructions)

本檔案為本專案在任何電腦上使用 Google Antigravity、Cursor 或其他 AI Agent 工具時之**最高優先級專案記憶與開發指引**。

---

## 🛑 核心全域規則 (Global Rules)
- **語言限制**：所有輸出（包含回覆、思考、任務清單、分析、建議、程式碼註解）均**一律使用繁體中文**（Traditional Chinese），嚴禁使用簡體中文或其他語言。
- **程式碼風格**：
  - 核心採用原生 Vanilla HTML5 + CSS3 + JavaScript (ES6+)，維持零建置依賴（No-build）、輕量且高效的特點。
  - 視覺設計遵循 Slate & Indigo 現代極簡設計系統，重視微動畫、狀態反饋與細膩陰影。
  - 嚴格維持檔案與函數註解完整性。

---

## 📌 專案概況與業務脈絡
- **專案名稱**：Todo List 線上協作系統 (XINCITY Todolist)
- **倉庫位址**：`https://github.com/ChaoHsuanKo/XINCITY_Todolist.git`
- **正式發布網址**：`https://chaohsuanko.github.io/XINCITY_Todolist/`
- **主要目的**：為團隊設計之輕量化、即時同步的 TodoList 系統，具備 Google 帳號登入 + 白名單權限控管、即時雙向推播、多維度分類篩選排序。

---

## 🏛️ 系統架構與技術棧

### 1. 前端架構
- `index.html`：單頁繁體中文介面，內含導覽列、側邊欄分類、搜尋列、待辦卡片區及成員管理/雲端設定彈窗。
- `style.css`：自定義 CSS 設計系統、Flex/Grid 響應式佈局、打勾刪除線動畫、逾期/今日到期視覺標籤。
- `app.js`：核心邏輯處理模組，內建**雙模資料層**：
  - **雲端模式**：串接 Supabase Client (CDN 引入)，使用 WebSocket (`realtime`) 實作多人即時廣播同步。
  - **離線/本地模式**：當未設定 Supabase 金鑰或斷網時，自動回退到 LocalStorage，不中斷操作。

### 2. 後端與資料庫 (Supabase)
- **專案 ID**：`dofkukshtqmtdxiomzfn`
- **專案 URL**：`https://dofkukshtqmtdxiomzfn.supabase.co`
- **資料表規範**（詳見 `schema.sql`）：
  - `users_whitelist`：白名單帳號表（欄位：`id`, `email`, `display_name`, `role`, `created_at`）。
    - 系統最高管理員為：`chaohsuan.ke@gmail.com`（`role: 'admin'`）。
  - `categories`：分類標籤表（欄位：`id`, `name`, `color`, `created_at`）。
  - `todos`：待辦事項主表（欄位：`id`, `title`, `completed`, `category_id`, `assigned_to`, `due_date`, `created_by`, `created_at`）。
- **即時廣播**：已在 Supabase 啟用 `supabase_realtime` 監聽 `todos`、`categories`、`users_whitelist` 之變更。

---

## ⚠️ 重大架構決策 (Key Decisions)
1. **白名單機制**：
   - 雲端模式以 **Supabase Auth（Google 登入）** 驗證身分，僅 Google 帳號 Email 存在於 `users_whitelist` 者可使用。
   - 權限由資料庫 RLS 強制執行（`schema.sql` 第 10 節）：未登入者無法讀寫；成員可讀寫待辦、新增分類、以 `update_my_display_name()` 修改自己的暱稱；修改/刪除分類與管理白名單僅限 admin。前端的權限判斷僅為 UI 顯示用途。
   - 本地體驗模式（LocalStorage）無驗證，仍以輸入白名單 Email 的方式登入。
   - 一般成員僅能檢視與指派任務；最高管理員（`admin`）擁有頂部「成員管理」按鈕，可直接新增/移除白名單成員與切換權限。
2. **移除快捷測試帳號**：
   - 為防止非授權人員或測試按鈕導致權限混亂，登入彈窗已**完全移除**「管理員一鍵填入」等快捷測試按鈕，全面要求手動輸入真實授權之 Email 進行身分驗證。
3. **無建置步驟 (No-build)**：
   - 不使用 Webpack/Vite 等複雜打包工具，直接以靜態檔案託管於 GitHub Pages / GitLab Pages，開箱即用。

---

## 💻 另一台電腦繼續開發指引
當在全新環境開啟本專案時：
1. **本機預覽**：
   - 可直接使用 VS Code / Antigravity 的 `Live Server`，或執行 `python -m http.server 3000` / `npx serve .`。
2. **雲端連線設定**：
   - 首次開啟若未偵測到 Supabase 金鑰，點擊右上角「雲端設定」圖示，輸入 Supabase URL 與 `anon_key`，金鑰將持久化保存在瀏覽器的 `localStorage` 中。
3. **管理員測試**：
   - 雲端模式：以 Google 帳號 `chaohsuan.ke@gmail.com` 登入即為管理員。本機測試需在 Supabase → Authentication → URL Configuration 的 Redirect URLs 加入本機網址（如 `http://localhost:3000/**`）。
   - 本地體驗模式：輸入 `chaohsuan.ke@gmail.com` 即可。
