# Todo List 線上協作系統

專為團隊協作打造的輕量化、即時同步 Todo List 線上系統，具備免密碼 Email 白名單登入、多維度分類與指派、即時狀態同步等功能。

---

## 📌 當前專案進度與備忘錄 (2026-09-29 更新)

### ✅ 已完成項目
1. **完整繁體中文介面開發**：
   - 頂部導航列：登入者狀態、修改個人暱稱、管理員「成員管理」、雲端連線設定、登出。
   - 側邊欄：分類標籤列表（含色票圓點）、任務狀態篩選、**隱藏已完成事項切換開關**、多維度排序選單。
   - 主操作區：快速新增任務列（標題、分類、指派人、截止時間）、關鍵字即時搜尋、待辦卡片清單（打勾刪除線動畫、到期與逾期警示）。
2. **Supabase 雲端資料庫正式打通**：
   - **Project ID**：`dofkukshtqmtdxiomzfn`
   - **Project URL**：`https://dofkukshtqmtdxiomzfn.supabase.co`
   - **資料庫資料表**：`users_whitelist`、`categories`、`todos` 已在雲端建置完畢。
   - **最高管理員**：`chaohsuan.ke@gmail.com`（具備管理者權限）。
   - **Realtime 即時推播**：已啟用，跨瀏覽器打勾/新增會即時自動同步。
3. **本地代碼庫與版本控制**：
   - 所有代碼已完成本地 Git 初次提交（Git Initial Commit），資料完整保存。

---

## 🚀 正式發布到 GitHub Pages

1. **推送本地程式碼至 GitHub**：
   - 遠端倉庫已設定：`https://github.com/ChaoHsuanKo/XINCITY_Todolist.git`
   - 在終端機執行推播：
     ```bash
     git push -u origin main
     ```
2. **自動部署與啟用 GitHub Pages**：
   - 專案內已包含 `.github/workflows/pages.yml`，推送後 GitHub Actions 會自動完成打包與部署。
   - 在 GitHub 倉庫的 **Settings** $\rightarrow$ **Pages**，將 **Source** 選為 **GitHub Actions**（若尚未自動切換）。
   - 部署完成後即可在 `https://chaohsuanko.github.io/XINCITY_Todolist/` 正式瀏覽線上系統！

---

## 一、 核心功能需求

### A. 登入與成員管理
1. **免密碼 Email 登入**：使用者僅需輸入 Email 即可快速登入。
2. **白名單權限控制**：系統維護允許登入的 Email 白名單，僅在白名單內的成員享有進入系統的權限。
3. **個人暱稱自訂**：登入後，成員可設定與修改個人顯示暱稱（Display Name），方便任務指派與識別。
4. **管理者控制台**：管理員登入後可透過「成員管理」彈窗，直接新增/移除團隊成員 Email 與切換權限。

### B. Todo 待辦事項功能
1. **分類與標籤管理**：
   - 支援建立、自訂不同類別與顏色標籤。
   - 待辦事項可明確歸類於特定類別。
2. **截止時間**：每筆待辦事項皆可設定預計到期與截止日期時間（支援逾期與今日到期自動警示）。
3. **負責人指派**：可從白名單成員清單中下拉選擇該事項的負責人。
4. **完成狀態**：提供 Checkbox 勾選功能，勾選完成後自動套用完成樣式（文字刪除線、淡化效果）。

### C. 頁面呈現與操作
1. **完成項目過濾**：提供切換開關，可一鍵「隱藏」或「顯示」已完成的待辦項目。
2. **多維度排序**：支援依照以下條件動態排序：
   - 建立日期（由新到舊 / 由舊到新）
   - 分類類別
   - 截止日期（即將到期優先）
   - 負責人
3. **即時搜尋**：輸入關鍵字即時比對任務名稱與負責人。

---

## 二、 系統架構：GitLab Pages ＋ Supabase 雲端資料庫

- **前端託管**：GitLab Pages（靜態託管，零成本維護）。
- **後端資料與即時同步**：Supabase（PostgreSQL + Realtime WebSocket 廣播）。
- **雙模支援**：內建本地離線測試模式，填入金鑰後無縫升級為雲端即時連線。

---

## 三、 專案檔案清單

| 檔案名稱 | 說明 |
| :--- | :--- |
| `index.html` | 繁體中文結構、導航列、側邊欄、任務清單與各項功能彈窗（Modal） |
| `style.css` | Slate & Indigo 設計系統、陰影、打勾刪除線微動畫與響應式 RWD |
| `app.js` | 核心邏輯、雙模資料層（LocalStorage + Supabase Realtime）、白名單權限、排序篩選 |
| `schema.sql` | Supabase 資料庫建表與 Realtime 廣播頻道的 SQL 腳本 |
| `.gitlab-ci.yml` | GitLab Pages 自動發布 CI/CD 腳本 |
| `wireframe.jpg` | 全繁體中文版 Wireframe 視覺介面設計圖 |
