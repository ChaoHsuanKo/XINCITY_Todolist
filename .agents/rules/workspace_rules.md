---
description: 專案開發規範與繁體中文要求
globs: ["*"]
alwaysApply: true
---

# 專案規範與 Agent 記憶 (Workspace Rules)

1. **語言要求**：
   - 所有輸出（包含回覆、思考、任務清單、分析、建議、程式碼註解）均使用繁體中文（Traditional Chinese），嚴禁使用簡體或其他語言。

2. **專案架構原則**：
   - 保持原生 Vanilla HTML/CSS/JS，不引入打包編譯工具（維持零配置靜態部署特性）。
   - 資料庫採用 Supabase（資料表：`users_whitelist`, `categories`, `todos`）。
   - 權限管理為嚴格白名單制，登入需手動輸入 Email，最高管理者為 `chaohsuan.ke@gmail.com`。

3. **設計系統**：
   - 遵循 Slate & Indigo 色系與精緻微動畫體驗。
