/**
 * 團隊待辦清單 (TodoList) - 核心業務邏輯與即時同步引擎
 * 支援：純前端本地測試模式 (LocalStorage) 與 Supabase 雲端多人即時同步 (Realtime)
 */

// ==========================================
// 1. 全域狀態與常數設定
// ==========================================
const CONFIG_STORAGE_KEY = 'teamsync_todo_cloud_config';
const AUTH_STORAGE_KEY = 'teamsync_todo_current_user';
const LOCAL_DATA_KEY = 'teamsync_todo_local_data';

// ==========================================
// 預設雲端資料庫連線設定 (填入後所有人開啟網頁皆自動連線)
// ==========================================
const DEFAULT_SUPABASE_CONFIG = {
  url: 'https://dofkukshtqmtdxiomzfn.supabase.co',
  key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRvZmt1a3NodHFtdGR4aW9temZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2MDUxNzUsImV4cCI6MjEwNjE4MTE3NX0.eI7CYshZxhBGVe9aaC_GRSJ3FKErsPgWHgvLv5LVGrU'
};

// 預設示範資料 (供無雲端連線時的本地體驗)
const INITIAL_LOCAL_STATE = {
  whitelist: [
    { id: 'u1', email: 'chaohsuan.ke@gmail.com', display_name: '系統管理員', role: 'admin' },
    { id: 'u2', email: 'sarah@example.com', display_name: '陳小華', role: 'member' }
  ],
  categories: [
    { id: 'c1', name: '工作專案', color: '#3b82f6' },
    { id: 'c2', name: '個人生活', color: '#10b981' },
    { id: 'c3', name: '緊急任務', color: '#ef4444' }
  ],
  todos: [
    {
      id: 't1',
      title: '繳交第三季專案報告',
      category_id: 'c1',
      assigned_emails: ['chaohsuan.ke@gmail.com'],
      due_date: new Date(Date.now() + 86400000 * 2).toISOString(),
      is_completed: false,
      created_by: 'chaohsuan.ke@gmail.com',
      created_at: new Date(Date.now() - 3600000 * 4).toISOString()
    },
    {
      id: 't2',
      title: '客戶簡報準備與架構檢視',
      category_id: 'c1',
      assigned_emails: ['sarah@example.com', 'chaohsuan.ke@gmail.com'],
      due_date: new Date(Date.now() + 86400000 * 3).toISOString(),
      is_completed: false,
      created_by: 'chaohsuan.ke@gmail.com',
      created_at: new Date(Date.now() - 3600000 * 2).toISOString()
    },
    {
      id: 't3',
      title: '團隊週會討論與時程同步',
      category_id: 'c3',
      assigned_emails: ['chaohsuan.ke@gmail.com'],
      due_date: new Date(Date.now() + 3600000 * 3).toISOString(),
      is_completed: false,
      created_by: 'chaohsuan.ke@gmail.com',
      created_at: new Date(Date.now() - 3600000 * 1).toISOString()
    },
    {
      id: 't4',
      title: '確認伺服器備份與環境變數設定',
      category_id: 'c2',
      assigned_emails: ['chaohsuan.ke@gmail.com'],
      due_date: new Date(Date.now() - 86400000).toISOString(),
      is_completed: true,
      created_by: 'chaohsuan.ke@gmail.com',
      created_at: new Date(Date.now() - 86400000 * 2).toISOString()
    }
  ]
};

// 可設定「同時通知」的帳號（僅管委會；其他成員不提供此選項，避免混淆）
const NOTIFY_CC_ACCOUNTS = ['hsinyueh.hoa@gmail.com'];
function canHaveNotifyCc(email) {
  return NOTIFY_CC_ACCOUNTS.includes(String(email || '').toLowerCase());
}

// 任務優先度選項
const PRIORITY_OPTIONS = {
  high: { label: '🔴 高', rank: 0 },
  normal: { label: '一般', rank: 1 },
  low: { label: '🔵 低', rank: 2 }
};

// 狀態管理物件
const appState = {
  currentUser: null,           // 當前登入的使用者資訊
  isCloudMode: false,          // 是否連接至 Supabase
  supabaseClient: null,        // Supabase 客戶端實例
  realtimeSubscription: null,  // 即時監聽頻道
  
  // 記憶體中資料快取
  whitelist: [],
  categories: [],
  todos: [],

  // 目前過濾與排序條件
  selectedCategory: 'all',     // 'all' 或分類 ID
  selectedStatus: 'all',       // 'all', 'active', 'completed'
  hideCompleted: false,        // 是否隱藏已完成事項
  sortBy: 'created_desc',      // 'created_desc', 'created_asc', 'start_asc', 'completed_desc', 'due_asc', 'priority', 'category', 'assignee'
  searchQuery: ''              // 關鍵字搜尋
};

// ==========================================
// 2. DOM 元素快取（延遲初始化，由 initDOM() 在 DOMContentLoaded 時執行）
// ==========================================
let DOM = {};

function initDOM() {
  DOM = {
    // 導航列
    statusBadge: document.getElementById('status-mode-badge'),
    loggedOutView: document.getElementById('logged-out-view'),
    loggedInView: document.getElementById('logged-in-view'),
    btnOpenLogin: document.getElementById('btn-open-login'),
    userDisplayName: document.getElementById('user-display-name'),
    userEmailText: document.getElementById('user-email-text'),
    userAvatarBadge: document.getElementById('user-avatar-badge'),
    btnOpenEditNickname: document.getElementById('btn-open-edit-nickname'),
    btnOpenWhitelist: document.getElementById('btn-open-whitelist'),
    btnOpenCloudConfig: document.getElementById('btn-open-cloud-config'),
    btnLogout: document.getElementById('btn-logout'),

    // 側邊欄
    categoryFilterList: document.getElementById('category-filter-list'),
    btnAddCategory: document.getElementById('btn-add-category'),
    filterTabs: document.getElementById('filter-tabs'),
    filterAll: document.getElementById('filter-all'),
    filterActive: document.getElementById('filter-active'),
    filterCompleted: document.getElementById('filter-completed'),
    countAll: document.getElementById('count-all'),
    countActive: document.getElementById('count-active'),
    countCompleted: document.getElementById('count-completed'),
    toggleHideCompleted: document.getElementById('toggle-hide-completed'),
    selectSortBy: document.getElementById('select-sort-by'),

    // 任務內容區
    formCreateTodo: document.getElementById('form-create-todo'),
    inputTodoTitle: document.getElementById('input-todo-title'),
    selectTodoCategory: document.getElementById('select-todo-category'),
    pickerTodoAssignee: document.getElementById('picker-todo-assignee'),
    inputTodoStart: document.getElementById('input-todo-start'),
    inputTodoDue: document.getElementById('input-todo-due'),
    currentCategoryIndicator: document.getElementById('current-category-indicator'),
    taskSummaryText: document.getElementById('task-summary-text'),
    inputSearchTasks: document.getElementById('input-search-tasks'),
    todoListContainer: document.getElementById('todo-list-container'),
    emptyState: document.getElementById('empty-state'),

    // 彈跳視窗
    modalLogin: document.getElementById('modal-login'),
    formLogin: document.getElementById('form-login'),
    inputLoginEmail: document.getElementById('input-login-email'),

    modalEditNickname: document.getElementById('modal-edit-nickname'),
    formEditNickname: document.getElementById('form-edit-nickname'),
    inputNewNickname: document.getElementById('input-new-nickname'),

    modalCategoryManager: document.getElementById('modal-category-manager'),
    formCreateCategory: document.getElementById('form-create-category'),
    inputCategoryName: document.getElementById('input-category-name'),

    modalEditCategory: document.getElementById('modal-edit-category'),
    formEditCategory: document.getElementById('form-edit-category'),
    inputEditCategoryId: document.getElementById('input-edit-category-id'),
    inputEditCategoryName: document.getElementById('input-edit-category-name'),
    btnDeleteCategory: document.getElementById('btn-delete-category'),

    modalWhitelistManager: document.getElementById('modal-whitelist-manager'),
    formAddWhitelist: document.getElementById('form-add-whitelist'),
    inputNewMemberEmail: document.getElementById('input-new-member-email'),
    inputNewMemberName: document.getElementById('input-new-member-name'),
    selectNewMemberRole: document.getElementById('select-new-member-role'),
    whitelistTableBody: document.getElementById('whitelist-table-body'),

    modalCloudConfig: document.getElementById('modal-cloud-config'),
    formCloudConfig: document.getElementById('form-cloud-config'),
    inputSupabaseUrl: document.getElementById('input-supabase-url'),
    inputSupabaseKey: document.getElementById('input-supabase-key'),
    btnResetToLocal: document.getElementById('btn-reset-to-local'),

    toastContainer: document.getElementById('toast-container')
  };

  // 統計 DOM 綁定成功/失敗數
  const total = Object.keys(DOM).length;
  const nullCount = Object.values(DOM).filter(v => v === null).length;
  if (nullCount > 0) {
    const missing = Object.entries(DOM).filter(([k, v]) => v === null).map(([k]) => k);
    console.warn(`[DOM] ${nullCount}/${total} 個元素未找到:`, missing);
  } else {
    console.log(`[DOM] 全部 ${total} 個元素綁定成功`);
  }
}

// ==========================================
// 3. 提示訊息 (Toast) 模組
// ==========================================
function showToast(message, type = 'success') {
  // 動態查找容器，不依賴 DOM 快取（避免快取為 null 時崩潰）
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  // 使用 textContent 寫入訊息，避免使用者輸入（分類名稱、暱稱等）造成 XSS
  const icon = document.createElement('span');
  icon.textContent = type === 'success' ? '✓' : '⚠';
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(icon, text);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ==========================================
// 4. 資料層抽象管理 (本地 LocalStorage + 雲端 Supabase)
// ==========================================
const DataService = {
  // 初始化儲存環境
  async init() {
    let cloudConfig = null;
    const savedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (savedConfig) {
      try { cloudConfig = JSON.parse(savedConfig); } catch (e) {}
      // 使用者明確選擇「重設為本地模式」時，不套用預設雲端設定
      if (cloudConfig && cloudConfig.mode === 'local') cloudConfig = null;
    } else if (DEFAULT_SUPABASE_CONFIG.url && DEFAULT_SUPABASE_CONFIG.key) {
      cloudConfig = DEFAULT_SUPABASE_CONFIG;
    }

    if (cloudConfig && cloudConfig.url && cloudConfig.key && window.supabase) {
      try {
        appState.supabaseClient = window.supabase.createClient(cloudConfig.url, cloudConfig.key);
        appState.isCloudMode = true;
        this.setupRealtime();
      } catch (err) {
        console.error('雲端資料庫連線失敗，降級為本地模式', err);
      }
    }

    if (!appState.isCloudMode) {
      // 確保本地資料結構完備
      const localData = localStorage.getItem(LOCAL_DATA_KEY);
      if (!localData) {
        localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(INITIAL_LOCAL_STATE));
      }
    }

    this.updateModeIndicator();
    try {
      await this.fetchData();
    } catch (fetchErr) {
      if (!appState.isCloudMode) throw fetchErr;
      console.error('[DataService] 雲端資料讀取失敗，降級為本地模式:', fetchErr);
      await this.fallbackToLocal();
      showToast('雲端資料庫連線失敗，已暫時切換為本地模式', 'error');
    }
  },

  // 雲端無法使用時，完整切換為本地模式（避免雲端/本地資料混用）
  async fallbackToLocal() {
    if (appState.supabaseClient && appState.realtimeSubscription) {
      appState.supabaseClient.removeChannel(appState.realtimeSubscription);
    }
    appState.realtimeSubscription = null;
    appState.supabaseClient = null;
    appState.isCloudMode = false;
    if (!localStorage.getItem(LOCAL_DATA_KEY)) {
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(INITIAL_LOCAL_STATE));
    }
    this.updateModeIndicator();
    await this.fetchData();
  },

  updateModeIndicator() {
    if (appState.isCloudMode) {
      DOM.statusBadge.textContent = '雲端即時連線中';
      DOM.statusBadge.className = 'badge-status-mode online';
    } else {
      DOM.statusBadge.textContent = '本地體驗模式';
      DOM.statusBadge.className = 'badge-status-mode';
    }
  },

  // 啟用 Supabase Realtime 即時推播監聽
  setupRealtime() {
    if (!appState.supabaseClient) return;

    if (appState.realtimeSubscription) {
      appState.supabaseClient.removeChannel(appState.realtimeSubscription);
    }

    appState.realtimeSubscription = appState.supabaseClient
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos' }, () => {
        DataService.fetchTodos().then(() => {
          renderTodoList();
          renderCategories(); // 同步更新側邊欄分類計數
          syncTodoDetailFromRemote(); // 若詳情面板開啟中，同步最新內容
        }).catch(err => console.error('[Realtime] 重新讀取待辦失敗:', err));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => {
        DataService.fetchCategories().then(() => {
          renderCategories();
          renderTodoList();
        }).catch(err => console.error('[Realtime] 重新讀取分類失敗:', err));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users_whitelist' }, () => {
        DataService.fetchWhitelist().then(() => {
          syncCurrentUserFromWhitelist(); // 角色/暱稱變更或被移除時立即生效
          updateAssigneeDropdown();
          renderWhitelistTable();
          renderTodoList(); // 負責人暱稱可能已變更
        }).catch(err => console.error('[Realtime] 重新讀取白名單失敗:', err));
      })
      .subscribe();
  },

  // 取得所有資料
  async fetchData() {
    await Promise.all([
      this.fetchWhitelist(),
      this.fetchCategories(),
      this.fetchTodos()
    ]);
  },

  // 1. 取得白名單
  async fetchWhitelist() {
    if (appState.isCloudMode) {
      const { data, error } = await appState.supabaseClient.from('users_whitelist').select('*');
      if (error) throw error;
      appState.whitelist = data || [];
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) || '{}');
      appState.whitelist = local.whitelist || [];
    }
  },

  // 2. 取得分類
  async fetchCategories() {
    if (appState.isCloudMode) {
      const { data, error } = await appState.supabaseClient.from('categories').select('*');
      if (error) throw error;
      appState.categories = data || [];
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) || '{}');
      appState.categories = local.categories || [];
    }
  },

  // 3. 取得待辦事項
  async fetchTodos() {
    if (appState.isCloudMode) {
      const { data, error } = await appState.supabaseClient.from('todos').select('*');
      if (error) throw error;
      appState.todos = data || [];
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) || '{}');
      appState.todos = local.todos || [];
    }
  },

  // 更新待辦事項狀態 (勾選打勾)
  async toggleTodoStatus(todoId, isCompleted) {
    if (appState.isCloudMode) {
      const { error } = await appState.supabaseClient
        .from('todos')
        .update({
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null
        })
        .eq('id', todoId);
      if (error) throw error;
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY));
      const completedAt = isCompleted ? new Date().toISOString() : null;
      local.todos = local.todos.map(t => t.id === todoId ? { ...t, is_completed: isCompleted, completed_at: completedAt } : t);
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(local));
      appState.todos = local.todos;
    }
  },

  // 新增待辦事項
  async addTodo(todoData) {
    if (appState.isCloudMode) {
      const { data, error } = await appState.supabaseClient
        .from('todos')
        .insert([todoData])
        .select();
      if (error) throw error;
      return data[0];
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY));
      const newTodo = {
        id: 't_' + Date.now(),
        ...todoData,
        created_at: new Date().toISOString()
      };
      local.todos.unshift(newTodo);
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(local));
      appState.todos = local.todos;
      return newTodo;
    }
  },

  // 更新待辦事項詳細內容（標題、說明、分類、負責人、截止時間、優先度、子任務）
  async updateTodo(todoId, updates) {
    if (appState.isCloudMode) {
      const { data, error } = await appState.supabaseClient
        .from('todos')
        .update(updates)
        .eq('id', todoId)
        .select();
      if (error) throw error;
      const idx = appState.todos.findIndex(t => t.id === todoId);
      if (idx !== -1 && data && data[0]) {
        appState.todos[idx] = data[0];
      }
      return data ? data[0] : null;
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY));
      local.todos = local.todos.map(t => t.id === todoId ? { ...t, ...updates } : t);
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(local));
      appState.todos = local.todos;
      return local.todos.find(t => t.id === todoId);
    }
  },

  // 刪除待辦事項
  async deleteTodo(todoId) {
    if (appState.isCloudMode) {
      const { error } = await appState.supabaseClient.from('todos').delete().eq('id', todoId);
      if (error) throw error;
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY));
      local.todos = local.todos.filter(t => t.id !== todoId);
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(local));
      appState.todos = local.todos;
    }
  },

  // 新增分類
  async addCategory(name, color) {
    if (appState.isCloudMode) {
      const { data, error } = await appState.supabaseClient
        .from('categories')
        .insert([{ name, color }])
        .select();
      if (error) {
        console.error('Supabase 新增分類失敗:', error);
        throw error;
      }
      if (data && data[0]) {
        appState.categories.push(data[0]);
      }
      return data ? data[0] : null;
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY));
      const newCat = { id: 'c_' + Date.now(), name, color };
      local.categories.push(newCat);
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(local));
      appState.categories = local.categories;
      return newCat;
    }
  },

  // 修改分類 (僅限管理者)
  async updateCategory(categoryId, name, color) {
    if (!appState.currentUser || appState.currentUser.role !== 'admin') {
      throw new Error('只有系統管理者可以修改分類！');
    }

    if (appState.isCloudMode) {
      const { data, error } = await appState.supabaseClient
        .from('categories')
        .update({ name, color })
        .eq('id', categoryId)
        .select();
      if (error) {
        console.error('Supabase 修改分類失敗:', error);
        throw error;
      }
      const idx = appState.categories.findIndex(c => c.id === categoryId);
      if (idx !== -1 && data && data[0]) {
        appState.categories[idx] = data[0];
      }
      return data ? data[0] : null;
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY));
      const cat = local.categories.find(c => c.id === categoryId);
      if (cat) {
        cat.name = name;
        cat.color = color;
        localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(local));
        appState.categories = local.categories;
      }
      return cat;
    }
  },

  // 刪除分類 (僅限管理者)
  async deleteCategory(categoryId) {
    if (!appState.currentUser || appState.currentUser.role !== 'admin') {
      throw new Error('只有系統管理者可以刪除分類！');
    }

    if (appState.isCloudMode) {
      const { error } = await appState.supabaseClient
        .from('categories')
        .delete()
        .eq('id', categoryId);
      if (error) {
        console.error('Supabase 刪除分類失敗:', error);
        throw error;
      }
      appState.categories = appState.categories.filter(c => c.id !== categoryId);
      appState.todos.forEach(t => {
        if (t.category_id === categoryId) t.category_id = null;
      });
      if (appState.selectedCategory === categoryId) {
        appState.selectedCategory = 'all';
        DOM.currentCategoryIndicator.textContent = '所有分類';
      }
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY));
      local.categories = local.categories.filter(c => c.id !== categoryId);
      local.todos.forEach(t => {
        if (t.category_id === categoryId) t.category_id = null;
      });
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(local));
      appState.categories = local.categories;
      appState.todos = local.todos;
      if (appState.selectedCategory === categoryId) {
        appState.selectedCategory = 'all';
        DOM.currentCategoryIndicator.textContent = '所有分類';
      }
    }
  },

  // 更新使用者暱稱
  async updateUserNickname(email, newDisplayName) {
    if (appState.isCloudMode) {
      const { error } = await appState.supabaseClient
        .from('users_whitelist')
        .update({ display_name: newDisplayName })
        .eq('email', email);
      if (error) throw error;
      const target = appState.whitelist.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (target) {
        target.display_name = newDisplayName;
      }
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY));
      local.whitelist = local.whitelist.map(u => u.email.toLowerCase() === email.toLowerCase() ? { ...u, display_name: newDisplayName } : u);
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(local));
      appState.whitelist = local.whitelist;
    }
  },

  // 新增白名單成員
  async addWhitelistMember(email, displayName, role) {
    email = email.trim().toLowerCase();
    if (appState.isCloudMode) {
      const { data, error } = await appState.supabaseClient
        .from('users_whitelist')
        .insert([{ email, display_name: displayName, role }])
        .select();
      // 23505 = unique_violation
      if (error) throw error.code === '23505' ? new Error('此 Email 已經在白名單中') : error;
      return data[0];
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY));
      if (local.whitelist.some(u => u.email.toLowerCase() === email.toLowerCase())) {
        throw new Error('此 Email 已經在白名單中');
      }
      const newMember = { id: 'u_' + Date.now(), email, display_name: displayName, role };
      local.whitelist.push(newMember);
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(local));
      appState.whitelist = local.whitelist;
      return newMember;
    }
  },

  // 更新成員的「同時通知」名單（任務指派給該成員時，副本寄送的對象 Email 陣列）
  async updateMemberNotifyCc(email, ccEmails) {
    if (appState.isCloudMode) {
      const { error } = await appState.supabaseClient
        .from('users_whitelist')
        .update({ notify_cc: ccEmails })
        .eq('email', email);
      if (error) throw error;
      const target = appState.whitelist.find(u => u.email === email);
      if (target) target.notify_cc = ccEmails;
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY));
      local.whitelist = local.whitelist.map(u => u.email === email ? { ...u, notify_cc: ccEmails } : u);
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(local));
      appState.whitelist = local.whitelist;
    }
  },

  // 刪除白名單成員
  async removeWhitelistMember(email) {
    if (appState.isCloudMode) {
      const { error } = await appState.supabaseClient.from('users_whitelist').delete().eq('email', email);
      if (error) throw error;
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY));
      local.whitelist = local.whitelist.filter(u => u.email !== email);
      localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(local));
      appState.whitelist = local.whitelist;
    }
  }
};

// ==========================================
// 5. 身份驗證與登入流程
// ==========================================
function checkExistingAuth() {
  console.log('[Auth] 開始檢查已存在的身份驗證...');
  console.log('[Auth] 白名單中共有', appState.whitelist.length, '位成員');

  const savedUserJson = sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
  if (savedUserJson) {
    console.log('[Auth] 發現儲存的身份資料');
    try {
      const user = JSON.parse(savedUserJson);
      console.log('[Auth] 嘗試驗證使用者:', user.email);

      // 確保仍存在於白名單
      const verified = appState.whitelist.find(u => u.email.toLowerCase() === user.email.toLowerCase());
      if (verified) {
        console.log('[Auth] 白名單驗證通過，角色:', verified.role);
        setUserSession(verified);
        return;
      } else {
        console.warn('[Auth] 使用者不在白名單中:', user.email, '→ 白名單內容:', appState.whitelist.map(u => u.email));
        showToast('您的帳號已從白名單中移除，請重新登入', 'error');
      }
    } catch (e) {
      console.error('[Auth] 解析儲存身份資料失敗:', e);
    }
  } else {
    console.log('[Auth] 無已儲存的身份資料，顯示登入視窗');
  }

  // 尚未登入則彈出登入視窗
  openModal('modal-login');
  renderNavbarAuth(false);
}

// 白名單變更時同步目前登入者的角色/暱稱；若已被移除則強制登出
function syncCurrentUserFromWhitelist() {
  if (!appState.currentUser) return;
  const latest = appState.whitelist.find(u => u.email.toLowerCase() === appState.currentUser.email.toLowerCase());
  if (!latest) {
    handleLogout();
    showToast('您的帳號已從白名單中移除', 'error');
    return;
  }
  if (latest.role !== appState.currentUser.role || latest.display_name !== appState.currentUser.display_name) {
    setUserSession(latest);
  }
}

function handleLogin(email) {
  const targetEmail = email.trim().toLowerCase();
  const user = appState.whitelist.find(u => u.email.toLowerCase() === targetEmail);

  if (!user) {
    showToast('抱歉，此 Email 未被管理者列入授權白名單！', 'error');
    return false;
  }

  setUserSession(user);
  closeModal('modal-login');
  openTaskFromUrl(); // 從 Email 連結進入時，登入後自動開啟該任務
  showToast(`歡迎回來，${user.display_name}！`, 'success');
  return true;
}

function setUserSession(user) {
  appState.currentUser = user;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  renderNavbarAuth(true);
}

function handleLogout() {
  appState.currentUser = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  sessionStorage.removeItem(AUTH_STORAGE_KEY);
  renderNavbarAuth(false);
  openModal('modal-login');
  showToast('已安全登出系統', 'success');
}

function renderNavbarAuth(isLoggedIn) {
  if (isLoggedIn && appState.currentUser) {
    DOM.loggedOutView.classList.add('hidden');
    DOM.loggedInView.classList.remove('hidden');

    const displayName = appState.currentUser.display_name || appState.currentUser.email.split('@')[0] || '使用者';
    DOM.userDisplayName.textContent = displayName;
    DOM.userEmailText.textContent = appState.currentUser.email || '';
    DOM.userAvatarBadge.textContent = displayName.charAt(0).toUpperCase();

    // 只有管理員看得見「成員管理」
    if (appState.currentUser.role === 'admin') {
      DOM.btnOpenWhitelist.classList.remove('hidden');
    } else {
      DOM.btnOpenWhitelist.classList.add('hidden');
    }
  } else {
    DOM.loggedOutView.classList.remove('hidden');
    DOM.loggedInView.classList.add('hidden');
  }

  // 身分切換時重新渲染分類列表 (以顯示/隱藏管理者編輯圖示)
  renderCategories();
}

// ==========================================
// 6. 介面渲染模組 (Categories, Assignees, Todo List)
// ==========================================

// 渲染側邊欄分類清單與表單下拉選單
function renderCategories() {
  DOM.categoryFilterList.innerHTML = '';
  DOM.selectTodoCategory.innerHTML = '<option value="">選擇分類...</option>';

  const isAdmin = appState.currentUser && appState.currentUser.role === 'admin';

  // 1. 全部類別選項
  const allItem = document.createElement('li');
  allItem.className = `category-item ${appState.selectedCategory === 'all' ? 'active' : ''}`;
  allItem.innerHTML = `
    <div class="cat-label-group">
      <span class="cat-dot" style="background: #94a3b8;"></span>
      <span>全部分類</span>
    </div>
    <span class="cat-count">${appState.todos.length}</span>
  `;
  allItem.addEventListener('click', () => {
    appState.selectedCategory = 'all';
    DOM.currentCategoryIndicator.textContent = '所有分類';
    renderCategories();
    renderTodoList();
  });
  DOM.categoryFilterList.appendChild(allItem);

  // 2. 個別分類選項
  appState.categories.forEach(cat => {
    const count = appState.todos.filter(t => t.category_id === cat.id).length;
    const li = document.createElement('li');
    li.className = `category-item ${appState.selectedCategory === cat.id ? 'active' : ''}`;
    li.innerHTML = `
      <div class="cat-label-group">
        <span class="cat-dot" style="background: ${safeColor(cat.color)};"></span>
        <span>${escapeHtml(cat.name)}</span>
      </div>
      <div class="cat-right-group">
        ${isAdmin ? `
          <button type="button" class="btn-cat-action btn-cat-edit" title="修改分類 (管理者專用)" data-cat-id="${escapeHtml(cat.id)}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        ` : ''}
        <span class="cat-count">${count}</span>
      </div>
    `;

    // 點擊分類篩選（若點擊的是編輯按鈕則不觸發篩選切換）
    li.addEventListener('click', (e) => {
      if (e.target.closest('.btn-cat-edit')) return;
      appState.selectedCategory = cat.id;
      DOM.currentCategoryIndicator.textContent = cat.name;
      renderCategories();
      renderTodoList();
    });

    // 管理員可點擊編輯按鈕
    if (isAdmin) {
      const editBtn = li.querySelector('.btn-cat-edit');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openEditCategoryModal(cat);
        });
      }
    }

    DOM.categoryFilterList.appendChild(li);

    // 同步到新增待辦的下拉選單
    const option = document.createElement('option');
    option.value = cat.id;
    option.textContent = cat.name;
    DOM.selectTodoCategory.appendChild(option);
  });
}

// 開啟管理者編輯分類彈窗
function openEditCategoryModal(cat) {
  if (!appState.currentUser || appState.currentUser.role !== 'admin') {
    showToast('只有管理者可以修改分類！', 'error');
    return;
  }
  DOM.inputEditCategoryId.value = cat.id;
  DOM.inputEditCategoryName.value = cat.name;

  const radios = document.querySelectorAll('input[name="edit-cat-color"]');
  let matched = false;
  radios.forEach(radio => {
    if (radio.value.toLowerCase() === (cat.color || '').toLowerCase()) {
      radio.checked = true;
      matched = true;
    }
  });
  if (!matched && radios.length > 0) {
    radios[0].checked = true;
  }

  openModal('modal-edit-category');
}

// 取得任務的負責人 Email 清單（相容舊資料：僅有單一 assigned_email 時轉為陣列）
function getTodoAssignees(todo) {
  if (Array.isArray(todo.assigned_emails) && todo.assigned_emails.length) return todo.assigned_emails;
  return todo.assigned_email ? [todo.assigned_email] : [];
}

// 比較兩份負責人清單是否相同（不分大小寫與順序）
function sameAssignees(a, b) {
  const norm = list => list.map(e => String(e).toLowerCase()).sort().join(',');
  return norm(a) === norm(b);
}

// 負責人多選元件：按鈕顯示已選名單，展開後以勾選框選擇白名單成員
class AssigneePicker {
  constructor(root) {
    this.root = root;
    this.placeholder = root.dataset.placeholder || '指派負責人...';
    this.selected = [];
    root.innerHTML = `
      <button type="button" class="assignee-picker-toggle" aria-haspopup="listbox" aria-expanded="false">
        <span class="assignee-picker-label"></span>
        <span class="assignee-picker-caret">▼</span>
      </button>
      <div class="assignee-picker-panel" role="listbox" aria-multiselectable="true" hidden></div>`;
    this.toggleBtn = root.querySelector('.assignee-picker-toggle');
    this.labelEl = root.querySelector('.assignee-picker-label');
    this.panel = root.querySelector('.assignee-picker-panel');

    this.toggleBtn.addEventListener('click', () => this.setOpen(this.panel.hidden));
    this.panel.addEventListener('change', (e) => {
      const email = e.target.value;
      this.selected = e.target.checked
        ? [...this.selected, email]
        : this.selected.filter(x => x !== email);
      this.renderLabel();
    });
    // 點擊外部或按 Esc 收合
    document.addEventListener('click', (e) => {
      if (!root.contains(e.target)) this.setOpen(false);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) {
        e.stopPropagation();
        this.setOpen(false);
        this.toggleBtn.focus();
      }
    });
    this.renderOptions();
  }

  setOpen(open) {
    this.panel.hidden = !open;
    this.root.classList.toggle('open', open);
    this.toggleBtn.setAttribute('aria-expanded', String(open));
  }

  // 依白名單重建選項（保留仍存在的已選成員）
  renderOptions() {
    const members = appState.whitelist || [];
    this.selected = this.selected.filter(email => members.some(u => u.email === email));
    this.panel.innerHTML = members.length
      ? members.map(u => `
        <label class="assignee-picker-option">
          <input type="checkbox" value="${escapeHtml(u.email)}" ${this.selected.includes(u.email) ? 'checked' : ''}>
          <span>${escapeHtml(u.display_name || u.email)}</span>
          <small>${escapeHtml(u.email)}</small>
        </label>`).join('')
      : '<div class="assignee-picker-empty">尚無成員</div>';
    this.renderLabel();
  }

  renderLabel() {
    const names = this.selected.map(email => {
      const user = appState.whitelist.find(u => u.email === email);
      return user ? (user.display_name || user.email) : email;
    });
    this.labelEl.textContent = names.length ? names.join('、') : this.placeholder;
    this.labelEl.classList.toggle('is-placeholder', !names.length);
    this.toggleBtn.title = names.join('、');
  }

  getValue() {
    return [...this.selected];
  }

  setValue(emails) {
    // 白名單 Email 大小寫可能與任務資料不同，統一對應回白名單的寫法
    this.selected = (emails || [])
      .map(email => appState.whitelist.find(u => u.email.toLowerCase() === String(email).toLowerCase())?.email)
      .filter((email, i, arr) => email && arr.indexOf(email) === i);
    this.renderOptions();
  }
}

let createAssigneePicker = null;
let detailAssigneePicker = null;

// 更新指派負責人選單（白名單變動時重建選項）
function updateAssigneeDropdown() {
  if (!createAssigneePicker) createAssigneePicker = new AssigneePicker(DOM.pickerTodoAssignee);
  createAssigneePicker.renderOptions();
}

// 格式化到期時間顯示與逾期計算
function formatDueDate(dueString) {
  if (!dueString) return null;
  const dueDate = new Date(dueString);
  if (isNaN(dueDate.getTime())) return null;
  const now = new Date();

  // 以「日曆日」計算相差天數，避免以 24 小時區間誤判（例如明天到期被標為今天）
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(dueDate) - startOfDay(now)) / (1000 * 60 * 60 * 24));
  const dateFormatted = dueDate.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (dueDate < now) {
    return { text: `已逾期 (${dateFormatted})`, className: 'overdue' };
  } else if (diffDays === 0) {
    return { text: `今天到期 (${dateFormatted})`, className: 'urgent-today' };
  } else if (diffDays === 1) {
    return { text: `明天到期 (${dateFormatted})`, className: '' };
  } else {
    return { text: `截止：${dateFormatted}`, className: '' };
  }
}

// 渲染待辦事項清單
function renderTodoList() {
  let list = [...appState.todos];

  // 1. 類別過濾
  if (appState.selectedCategory !== 'all') {
    list = list.filter(t => t.category_id === appState.selectedCategory);
  }

  // 2. 狀態過濾 (全部 / 進行中 / 已完成)
  if (appState.selectedStatus === 'active') {
    list = list.filter(t => !t.is_completed);
  } else if (appState.selectedStatus === 'completed') {
    list = list.filter(t => t.is_completed);
  }

  // 3. 隱藏已完成開關
  if (appState.hideCompleted) {
    list = list.filter(t => !t.is_completed);
  }

  // 4. 關鍵字搜尋
  if (appState.searchQuery.trim()) {
    const query = appState.searchQuery.trim().toLowerCase();
    list = list.filter(t => {
      const matchTitle = (t.title || '').toLowerCase().includes(query)
        || (t.description || '').toLowerCase().includes(query);
      const matchAssignee = getTodoAssignees(t).some(email => {
        const assignee = appState.whitelist.find(u => u.email === email);
        return email.toLowerCase().includes(query)
          || (assignee && (assignee.display_name || '').toLowerCase().includes(query));
      });
      return matchTitle || matchAssignee;
    });
  }

  // 5. 多維度排序
  list.sort((a, b) => {
    switch (appState.sortBy) {
      case 'created_asc':
        return new Date(a.created_at) - new Date(b.created_at);
      case 'start_asc':
        return getTodoStartDate(a).localeCompare(getTodoStartDate(b));
      case 'completed_desc': {
        // 已完成且有完成時間者依完成時間新到舊，其餘（未完成或無紀錄）排在後面
        const timeA = a.is_completed && a.completed_at ? new Date(a.completed_at).getTime() : -Infinity;
        const timeB = b.is_completed && b.completed_at ? new Date(b.completed_at).getTime() : -Infinity;
        if (timeA === timeB) return 0;
        return timeB > timeA ? 1 : -1;
      }
      case 'due_asc':
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
      case 'priority': {
        const rankA = (PRIORITY_OPTIONS[a.priority] || PRIORITY_OPTIONS.normal).rank;
        const rankB = (PRIORITY_OPTIONS[b.priority] || PRIORITY_OPTIONS.normal).rank;
        return rankA - rankB;
      }
      case 'category':
        const catA = appState.categories.find(c => c.id === a.category_id)?.name || '';
        const catB = appState.categories.find(c => c.id === b.category_id)?.name || '';
        return catA.localeCompare(catB, 'zh-TW');
      case 'assignee':
        // 多位負責人時以第一位排序
        const nameA = appState.whitelist.find(u => u.email === getTodoAssignees(a)[0])?.display_name || '';
        const nameB = appState.whitelist.find(u => u.email === getTodoAssignees(b)[0])?.display_name || '';
        return nameA.localeCompare(nameB, 'zh-TW');
      case 'created_desc':
      default:
        return new Date(b.created_at) - new Date(a.created_at);
    }
  });

  // 更新計數標籤
  const totalCount = appState.todos.length;
  const activeCount = appState.todos.filter(t => !t.is_completed).length;
  const completedCount = appState.todos.filter(t => t.is_completed).length;

  DOM.countAll.textContent = totalCount;
  DOM.countActive.textContent = activeCount;
  DOM.countCompleted.textContent = completedCount;
  DOM.taskSummaryText.textContent = `共篩選出 ${list.length} 項任務`;

  DOM.todoListContainer.innerHTML = '';

  if (list.length === 0) {
    DOM.emptyState.classList.remove('hidden');
    return;
  }
  DOM.emptyState.classList.add('hidden');

  // 依序生成待辦卡片
  list.forEach(todo => {
    const card = document.createElement('div');
    card.className = `todo-card ${todo.is_completed ? 'completed' : ''}`;
    card.id = `todo-${todo.id}`;

    // 分類資訊
    const category = appState.categories.find(c => c.id === todo.category_id);
    const catColor = category ? safeColor(category.color) : '';
    const categoryHtml = category ? `
      <span class="badge-category" style="background-color: ${catColor}15; color: ${catColor}; border: 1px solid ${catColor}40;">
        <span class="cat-dot" style="background: ${catColor}; width:6px; height:6px;"></span>
        ${escapeHtml(category.name)}
      </span>
    ` : '';

    // 負責人資訊（可多位，每位一個徽章）
    const assigneeHtml = getTodoAssignees(todo).map(email => {
      const assignee = appState.whitelist.find(u => u.email === email);
      if (!assignee) return '';
      const assigneeName = assignee.display_name || assignee.email.split('@')[0] || '成員';
      return `
      <span class="assignee-badge" title="負責人: ${escapeHtml(assigneeName)} (${escapeHtml(assignee.email || '')})">
        <span class="assignee-avatar-mini">${escapeHtml(assigneeName.charAt(0).toUpperCase())}</span>
        <span>${escapeHtml(assigneeName)}</span>
      </span>`;
    }).join('');

    // 截止日期資訊
    const dueInfo = formatDueDate(todo.due_date);
    const dueHtml = dueInfo ? `
      <span class="due-badge ${dueInfo.className}">
        📅 ${dueInfo.text}
      </span>
    ` : '';

    // 開始日期與經過天數：進行中顯示已過幾天，已完成顯示經幾天結案
    const ageInfo = formatTodoAge(todo);
    const ageHtml = `<span class="age-badge ${ageInfo.className}" title="${escapeHtml(ageInfo.title)}">${ageInfo.text}</span>`;

    // 優先度資訊（一般優先度不顯示，避免畫面雜亂）
    const priorityInfo = PRIORITY_OPTIONS[todo.priority];
    const priorityHtml = priorityInfo && todo.priority !== 'normal' ? `
      <span class="priority-badge priority-${todo.priority}">${priorityInfo.label}</span>
    ` : '';

    // 詳情指示：說明備註與子任務進度
    const subtasks = Array.isArray(todo.subtasks) ? todo.subtasks : [];
    const doneSubtasks = subtasks.filter(s => s.done).length;
    const subtaskHtml = subtasks.length ? `
      <span class="detail-indicator ${doneSubtasks === subtasks.length ? 'all-done' : ''}" title="子任務進度">
        ☑ ${doneSubtasks}/${subtasks.length}
      </span>
    ` : '';
    const noteHtml = todo.description && todo.description.trim() ? `
      <span class="detail-indicator" title="此任務有詳細說明">📝</span>
    ` : '';

    card.innerHTML = `
      <div class="todo-left-main">
        <button type="button" class="custom-checkbox-btn" aria-label="切換完成狀態">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
        <span class="todo-title-text" title="${escapeHtml(todo.title)}">${escapeHtml(todo.title)}</span>
      </div>
      <div class="todo-right-meta">
        ${priorityHtml}
        ${noteHtml}
        ${subtaskHtml}
        ${categoryHtml}
        ${assigneeHtml}
        ${ageHtml}
        ${dueHtml}
        <button type="button" class="btn-card-delete" title="刪除此任務" aria-label="刪除任務">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    // 綁定 Checkbox 打勾事件
    const checkboxBtn = card.querySelector('.custom-checkbox-btn');
    checkboxBtn.addEventListener('click', async (e) => {
      e.stopPropagation(); // 避免同時觸發開啟詳情
      try {
        const nextStatus = !todo.is_completed;
        await DataService.toggleTodoStatus(todo.id, nextStatus);
        todo.is_completed = nextStatus;
        renderTodoList();
        renderCategories();
        showToast(nextStatus ? '已完成該事項！' : '已將事項標記為未完成', 'success');
      } catch (err) {
        showToast('更新失敗，請檢查權限或網路連線', 'error');
      }
    });

    // 綁定刪除事件
    const delBtn = card.querySelector('.btn-card-delete');
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation(); // 避免同時觸發開啟詳情
      if (confirm(`確定要刪除「${todo.title}」嗎？`)) {
        try {
          await DataService.deleteTodo(todo.id);
          renderTodoList();
          renderCategories();
          showToast('已刪除待辦事項', 'success');
        } catch (err) {
          showToast('刪除失敗', 'error');
        }
      }
    });

    // 點擊卡片其餘區域：開啟任務詳情
    card.classList.add('clickable');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.addEventListener('click', () => openTodoDetail(todo.id));
    card.addEventListener('keydown', (e) => {
      if (e.target === card && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openTodoDetail(todo.id);
      }
    });

    DOM.todoListContainer.appendChild(card);
  });
}

// 渲染白名單成員管理表格 (Admin)
function renderWhitelistTable() {
  DOM.whitelistTableBody.innerHTML = '';
  const isAdmin = appState.currentUser?.role === 'admin';
  appState.whitelist.forEach(user => {
    // 同時通知對象：僅管委會帳號提供此設定，只顯示仍在白名單中的成員
    let ccCellHtml = '';
    if (canHaveNotifyCc(user.email)) {
      const ccMembers = getNotifyCcMembers(user);
      const ccHtml = ccMembers.length
        ? ccMembers.map(m => `<span class="notify-cc-chip" title="${escapeHtml(m.email)}">${escapeHtml(m.display_name || m.email)}</span>`).join('')
        : '<span class="notify-cc-empty">尚未設定</span>';
      ccCellHtml = `
        <div class="notify-cc-cell">
          ${ccHtml}
          ${isAdmin ? '<button type="button" class="btn-notify-cc-edit" title="設定指派給管委會時，同時通知哪些人">設定</button>' : ''}
        </div>
      `;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(user.email)}</strong></td>
      <td>${escapeHtml(user.display_name)}</td>
      <td><span class="badge" style="background:#e2e8f0;">${user.role === 'admin' ? '管理者' : '一般成員'}</span></td>
      <td>${ccCellHtml}</td>
      <td style="text-align: right;">
        ${appState.currentUser?.role === 'admin' && user.email !== appState.currentUser?.email ? `
          <button type="button" class="btn btn-outline-danger btn-sm" data-email="${escapeHtml(user.email)}">移除</button>
        ` : '<span style="color:#94a3b8; font-size:0.75rem;">當前登入者</span>'}
      </td>
    `;

    const ccEditBtn = tr.querySelector('.btn-notify-cc-edit');
    if (ccEditBtn) {
      ccEditBtn.addEventListener('click', () => openNotifyCcModal(user.email));
    }

    const removeBtn = tr.querySelector('.btn-outline-danger');
    if (removeBtn) {
      removeBtn.addEventListener('click', async () => {
        if (confirm(`確定將 ${user.email} 從白名單中移除？`)) {
          try {
            await DataService.removeWhitelistMember(user.email);
            renderWhitelistTable();
            updateAssigneeDropdown();
            showToast('已移除該成員白名單', 'success');
          } catch (err) {
            showToast('移除失敗', 'error');
          }
        }
      });
    }

    DOM.whitelistTableBody.appendChild(tr);
  });
}

// 取得成員的「同時通知」對象（過濾已不在白名單者與本人）
function getNotifyCcMembers(user) {
  const ccEmails = Array.isArray(user.notify_cc) ? user.notify_cc : [];
  return ccEmails
    .map(email => appState.whitelist.find(m => m.email.toLowerCase() === String(email).toLowerCase()))
    .filter(m => m && m.email.toLowerCase() !== user.email.toLowerCase());
}

// 開啟「同時通知」設定視窗：列出其他成員供勾選
function openNotifyCcModal(email) {
  if (appState.currentUser?.role !== 'admin') {
    showToast('只有系統管理員可以設定通知對象！', 'error');
    return;
  }
  const target = appState.whitelist.find(u => u.email === email);
  if (!target || !canHaveNotifyCc(target.email)) return;

  document.getElementById('notify-cc-target-email').value = target.email;
  document.getElementById('notify-cc-target-name').textContent = target.display_name || target.email;

  const selected = new Set(getNotifyCcMembers(target).map(m => m.email.toLowerCase()));
  const listEl = document.getElementById('notify-cc-list');
  listEl.innerHTML = '';
  appState.whitelist
    .filter(m => m.email !== target.email)
    .forEach(m => {
      const li = document.createElement('li');
      li.innerHTML = `
        <label>
          <input type="checkbox" value="${escapeHtml(m.email)}" ${selected.has(m.email.toLowerCase()) ? 'checked' : ''}>
          <span>${escapeHtml(m.display_name || m.email)}</span>
          <span class="notify-cc-email">${escapeHtml(m.email)}</span>
        </label>
      `;
      listEl.appendChild(li);
    });

  openModal('modal-notify-cc');
}

// 儲存「同時通知」設定
window.handleNotifyCcSubmit = async function(e) {
  if (e) e.preventDefault();
  if (appState.currentUser?.role !== 'admin') {
    showToast('只有系統管理員可以設定通知對象！', 'error');
    return;
  }
  const email = document.getElementById('notify-cc-target-email').value;
  if (!canHaveNotifyCc(email)) return;
  const ccEmails = [...document.querySelectorAll('#notify-cc-list input[type="checkbox"]:checked')].map(cb => cb.value);

  const saveBtn = document.getElementById('btn-save-notify-cc');
  saveBtn.disabled = true;
  saveBtn.textContent = '儲存中...';
  try {
    await DataService.updateMemberNotifyCc(email, ccEmails);
    renderWhitelistTable();
    closeModal('modal-notify-cc');
    showToast('已更新同時通知對象', 'success');
  } catch (err) {
    console.error('[NotifyCc] 更新失敗:', err);
    // 資料庫尚未新增 notify_cc 欄位時會失敗
    if (/notify_cc/.test(String(err.message || ''))) {
      showToast('資料庫缺少 notify_cc 欄位，請先於 Supabase 執行 schema.sql 第 12 節', 'error');
    } else {
      showToast('更新失敗，請檢查網路連線', 'error');
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '儲存設定';
  }
};

// ==========================================
// 7. 事件監聽與表單處理
// ==========================================
function bindEvents() {
  // 1. 登入表單送出
  DOM.formLogin.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = DOM.inputLoginEmail.value;
    if (handleLogin(email)) {
      DOM.formLogin.reset();
    }
  });

  // 開啟登入視窗
  DOM.btnOpenLogin.addEventListener('click', () => openModal('modal-login'));

  // 注意：登出、修改暱稱、新增/修改/刪除分類、開啟成員管理、開啟雲端設定
  // 皆已由 index.html 的 onclick / onsubmit 呼叫下方 window.* 全域函式處理，
  // 此處不可再以 addEventListener 重複綁定，否則會造成同一動作執行兩次（例如分類重複建立）。

  // 4. 白名單管理 (Admin) - 新增成員
  DOM.formAddWhitelist.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!appState.currentUser || appState.currentUser.role !== 'admin') {
      showToast('只有系統管理員具備成員管理權限！', 'error');
      return;
    }
    const email = DOM.inputNewMemberEmail.value.trim();
    const name = DOM.inputNewMemberName.value.trim();
    const role = DOM.selectNewMemberRole.value;

    try {
      await DataService.addWhitelistMember(email, name, role);
      renderWhitelistTable();
      updateAssigneeDropdown();
      DOM.formAddWhitelist.reset();
      showToast(`已成功將 ${name} 加入白名單`, 'success');
    } catch (err) {
      showToast(err.message || '新增白名單成員失敗', 'error');
    }
  });

  // 5. 雲端設定 (Supabase Config)
  DOM.formCloudConfig.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = DOM.inputSupabaseUrl.value.trim();
    const key = DOM.inputSupabaseKey.value.trim();

    if (url && key) {
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ url, key }));
      showToast('已儲存 Supabase 設定，重新整理頁面連線中...', 'success');
      setTimeout(() => window.location.reload(), 1200);
    }
  });

  DOM.btnResetToLocal.addEventListener('click', () => {
    // 寫入本地模式旗標（若僅刪除設定，重新載入後會自動套用 DEFAULT_SUPABASE_CONFIG 又連回雲端）
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({ mode: 'local' }));
    showToast('已重設為本地測試模式，重新載入中...', 'success');
    setTimeout(() => window.location.reload(), 1200);
  });

  // 6. 新增待辦事項送出
  DOM.formCreateTodo.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!appState.currentUser) {
      openModal('modal-login');
      showToast('請先輸入 Email 登入系統！', 'error');
      return;
    }

    const title = DOM.inputTodoTitle.value.trim();
    if (!title) return;

    const categoryId = DOM.selectTodoCategory.value || null;
    const assignedEmails = createAssigneePicker ? createAssigneePicker.getValue() : [];
    // datetime-local 值不含時區，需轉為 ISO 字串，否則資料庫會以 UTC 解讀而差 8 小時
    const dueDate = localInputToISO(DOM.inputTodoDue.value);
    const startDate = DOM.inputTodoStart.value || todayDateString();

    try {
      await DataService.addTodo({
        title,
        category_id: categoryId,
        assigned_emails: assignedEmails,
        assigned_email: assignedEmails[0] || null, // 保留第一位負責人，相容舊欄位
        assigned_by: assignedEmails.length ? appState.currentUser.email : null, // 指派者，供 Email 通知使用
        start_date: startDate,
        due_date: dueDate,
        is_completed: false,
        created_by: appState.currentUser.email
      });

      DOM.inputTodoTitle.value = '';
      DOM.inputTodoDue.value = '';
      DOM.inputTodoStart.value = todayDateString();
      renderTodoList();
      renderCategories();
      showToast('待辦事項已新增！', 'success');
    } catch (err) {
      console.error('[Todo] 新增任務失敗:', err);
      if (/assigned_emails/.test(String(err.message || ''))) {
        showToast('資料庫缺少新欄位，請先於 Supabase 執行 schema.sql 第 14 節升級指令', 'error');
      } else {
        showToast('新增待辦失敗', 'error');
      }
    }
  });

  // 7. 任務狀態過濾 Tabs
  DOM.filterTabs.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      DOM.filterTabs.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      appState.selectedStatus = tab.getAttribute('data-filter');
      renderTodoList();
    });
  });

  // 8. 隱藏已完成開關
  DOM.toggleHideCompleted.addEventListener('change', (e) => {
    appState.hideCompleted = e.target.checked;
    renderTodoList();
  });

  // 9. 排序下拉選單
  DOM.selectSortBy.addEventListener('change', (e) => {
    appState.sortBy = e.target.value;
    renderTodoList();
  });

  // 10. 關鍵字即時搜尋
  DOM.inputSearchTasks.addEventListener('input', (e) => {
    appState.searchQuery = e.target.value;
    renderTodoList();
  });

  // 10-1. 任務詳情面板：任何欄位變動即標記為未儲存，避免即時同步覆蓋使用者正在編輯的內容
  const formTodoDetail = document.getElementById('form-todo-detail');
  if (formTodoDetail) {
    formTodoDetail.addEventListener('input', () => { todoDetailState.dirty = true; });
    formTodoDetail.addEventListener('change', () => { todoDetailState.dirty = true; });
    // 勾選／取消完成時同步顯示完成日期欄位
    document.getElementById('detail-todo-completed').addEventListener('change', syncDetailCompletedDate);
  }

  // 子任務輸入框按 Enter：新增子任務而非送出整個表單
  const subtaskInput = document.getElementById('detail-subtask-input');
  if (subtaskInput) {
    subtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        window.handleAddSubtask();
      }
    });
  }

  // 11. 關閉彈跳視窗共用處理
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      closeModal(modalId);
    });
  });

  // 點選遮罩背景關閉
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop && backdrop.id !== 'modal-login') {
        backdrop.classList.add('hidden');
      }
    });
  });
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    console.log(`[Modal] 已開啟視窗: ${modalId}`);
  } else {
    console.warn(`[Modal] 找不到視窗元素: ${modalId}`);
  }
}
window.openModal = openModal;

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    console.log(`[Modal] 已關閉視窗: ${modalId}`);
  }
}
window.closeModal = closeModal;

// 全域保險函式：開啟修改暱稱視窗
window.openEditNicknameModal = function() {
  console.log('[Nickname] openEditNicknameModal 被觸發, 當前使用者:', appState.currentUser);
  if (!appState.currentUser) {
    showToast('請先輸入 Email 登入團隊系統！', 'error');
    openModal('modal-login');
    return;
  }
  const input = document.getElementById('input-new-nickname');
  if (input) {
    input.value = appState.currentUser.display_name || '';
    setTimeout(() => {
      input.focus();
      input.select();
    }, 100);
  }
  openModal('modal-edit-nickname');
};

// 全域保險函式：送出修改暱稱
window.handleEditNicknameSubmit = async function(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('input-new-nickname');
  const newName = input ? input.value.trim() : '';
  if (!newName) {
    showToast('請輸入有效的暱稱！', 'error');
    return;
  }
  if (!appState.currentUser) {
    showToast('登入狀態已過期，請重新登入', 'error');
    openModal('modal-login');
    return;
  }

  const saveBtn = document.getElementById('btn-save-nickname');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = '儲存中...';
  }

  try {
    await DataService.updateUserNickname(appState.currentUser.email, newName);
    appState.currentUser.display_name = newName;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(appState.currentUser));
    renderNavbarAuth(true);
    updateAssigneeDropdown();
    renderTodoList();
    closeModal('modal-edit-nickname');
    showToast('暱稱修改成功！', 'success');
  } catch (err) {
    console.error('修改暱稱失敗:', err);
    showToast(err.message || '暱稱修改失敗，請檢查網路連線', 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = '儲存暱稱';
    }
  }
};

// 全域保險函式：開啟成員管理視窗
window.openWhitelistModal = function() {
  if (!appState.currentUser || appState.currentUser.role !== 'admin') {
    showToast('只有系統管理員具備成員管理權限！', 'error');
    return;
  }
  renderWhitelistTable();
  openModal('modal-whitelist-manager');
};

// 全域保險函式：開啟雲端設定視窗
window.openCloudConfigModal = function() {
  const savedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
  if (savedConfig) {
    try {
      const { url, key } = JSON.parse(savedConfig);
      DOM.inputSupabaseUrl.value = url || '';
      DOM.inputSupabaseKey.value = key || '';
    } catch (e) {}
  }
  openModal('modal-cloud-config');
};

// 全域保險函式：登出處理
window.handleLogoutClick = function() {
  handleLogout();
};

// 全域保險函式：開啟新增分類視窗
window.openAddCategoryModal = function() {
  console.log('[Category] openAddCategoryModal 被觸發, 當前使用者:', appState.currentUser);
  if (!appState.currentUser) {
    showToast('請先輸入 Email 登入團隊系統！', 'error');
    openModal('modal-login');
    return;
  }
  openModal('modal-category-manager');
  const input = document.getElementById('input-category-name');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
};

// 全域保險函式：送出新增分類
window.handleCreateCategorySubmit = async function(e) {
  if (e) e.preventDefault();
  const nameInput = document.getElementById('input-category-name');
  const name = nameInput ? nameInput.value.trim() : '';
  const checkedColor = document.querySelector('input[name="cat-color"]:checked')?.value || '#3b82f6';

  if (!name) {
    alert('請輸入分類名稱！');
    return;
  }

  const submitBtn = document.getElementById('btn-save-category');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '建立中...';
  }

  try {
    const res = await DataService.addCategory(name, checkedColor);
    console.log('[Category] 新增分類成功:', res);
    renderCategories();
    renderTodoList();
    closeModal('modal-category-manager');
    if (nameInput) nameInput.value = '';
    showToast(`已成功建立分類「${name}」！`, 'success');
  } catch (err) {
    console.error('[Category] 建立分類失敗:', err);
    alert(`建立分類失敗: ${err.message || '請確認網路或資料庫連線'}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '建立分類';
    }
  }
};

// 全域保險函式：送出修改分類 (管理者專用)
window.handleEditCategorySubmit = async function(e) {
  if (e) e.preventDefault();
  if (!appState.currentUser || appState.currentUser.role !== 'admin') {
    alert('權限不足：僅有系統管理員可修改分類！');
    return;
  }

  const catId = document.getElementById('input-edit-category-id')?.value;
  const nameInput = document.getElementById('input-edit-category-name');
  const name = nameInput ? nameInput.value.trim() : '';
  const checkedColor = document.querySelector('input[name="edit-cat-color"]:checked')?.value || '#3b82f6';

  if (!catId || !name) {
    alert('請輸入分類名稱！');
    return;
  }

  const submitBtn = document.getElementById('btn-save-edit-category');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '儲存中...';
  }

  try {
    await DataService.updateCategory(catId, name, checkedColor);
    if (appState.selectedCategory === catId) {
      DOM.currentCategoryIndicator.textContent = name;
    }
    renderCategories();
    renderTodoList();
    closeModal('modal-edit-category');
    showToast(`已成功更新分類「${name}」！`, 'success');
  } catch (err) {
    console.error('[Category] 修改分類失敗:', err);
    alert(`修改分類失敗: ${err.message || '請確認網路連線'}`);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '儲存變更';
    }
  }
};

// 全域保險函式：刪除分類 (管理者專用)
window.handleDeleteCategoryClick = async function() {
  if (!appState.currentUser || appState.currentUser.role !== 'admin') {
    alert('權限不足：僅有系統管理員可刪除分類！');
    return;
  }

  const catId = document.getElementById('input-edit-category-id')?.value;
  const currentCat = appState.categories.find(c => c.id === catId);
  const catName = currentCat ? currentCat.name : '此分類';

  if (!confirm(`確定要刪除「${catName}」分類嗎？\n刪除後，原本屬於該分類的待辦事項將自動變更為「未分類」。`)) {
    return;
  }

  const btn = document.getElementById('btn-delete-category');
  if (btn) btn.disabled = true;

  try {
    await DataService.deleteCategory(catId);
    renderCategories();
    renderTodoList();
    closeModal('modal-edit-category');
    showToast(`已成功刪除分類「${catName}」`, 'success');
  } catch (err) {
    console.error('[Category] 刪除分類失敗:', err);
    alert(`刪除分類失敗: ${err.message || '請確認網路連線'}`);
  } finally {
    if (btn) btn.disabled = false;
  }
};

// ==========================================
// 任務詳情面板 (Todo Detail)
// ==========================================
// 詳情面板編輯狀態：目前開啟的任務 ID、子任務草稿、是否有未儲存變更
const todoDetailState = {
  todoId: null,
  subtasks: [],
  dirty: false
};

// 輔助函式：將 ISO 時間字串轉為 datetime-local 輸入框可用的本地時間格式
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 輔助函式：格式化完整日期時間（詳情面板中繼資訊用）
function formatDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// 開啟任務詳情面板並填入資料
function openTodoDetail(todoId) {
  const todo = appState.todos.find(t => t.id === todoId);
  if (!todo) {
    showToast('找不到此任務，可能已被刪除', 'error');
    return;
  }
  todoDetailState.todoId = todoId;
  fillTodoDetailForm(todo);
  openModal('modal-todo-detail');
}
window.openTodoDetail = openTodoDetail;

// 將任務資料填入詳情表單
function fillTodoDetailForm(todo) {
  // 分類下拉選單
  const catSelect = document.getElementById('detail-todo-category');
  catSelect.innerHTML = '<option value="">未分類</option>';
  appState.categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    catSelect.appendChild(opt);
  });

  // 負責人多選
  if (!detailAssigneePicker) detailAssigneePicker = new AssigneePicker(document.getElementById('detail-todo-assignee'));
  detailAssigneePicker.setOpen(false);

  document.getElementById('detail-todo-title').value = todo.title || '';
  document.getElementById('detail-todo-description').value = todo.description || '';
  catSelect.value = todo.category_id || '';
  detailAssigneePicker.setValue(getTodoAssignees(todo));
  document.getElementById('detail-todo-start').value = getTodoStartDate(todo);
  document.getElementById('detail-todo-due').value = isoToLocalInput(todo.due_date);
  document.getElementById('detail-todo-priority').value = PRIORITY_OPTIONS[todo.priority] ? todo.priority : 'normal';
  document.getElementById('detail-todo-completed').checked = !!todo.is_completed;
  document.getElementById('detail-todo-completed-date').value =
    todo.is_completed && todo.completed_at ? isoToLocalInput(todo.completed_at).slice(0, 10) : '';
  syncDetailCompletedDate();

  // 子任務草稿（深拷貝，取消時不影響原資料）
  todoDetailState.subtasks = (Array.isArray(todo.subtasks) ? todo.subtasks : []).map(s => ({ ...s }));
  renderDetailSubtasks();

  // 中繼資訊：建立者、建立時間、完成時間
  const creator = appState.whitelist.find(u => u.email === todo.created_by);
  const creatorName = creator ? creator.display_name : (todo.created_by || '未知');
  let metaText = `由 ${creatorName} 建立於 ${formatDateTime(todo.created_at)}`;
  if (todo.is_completed && todo.completed_at) {
    metaText += ` ・ 完成於 ${formatDateTime(todo.completed_at)}`;
  }
  document.getElementById('detail-todo-meta').textContent = metaText;

  todoDetailState.dirty = false;
}

// 詳情面板：勾選完成時顯示完成日期欄位（未填時預設今天），取消勾選則隱藏
function syncDetailCompletedDate() {
  const isCompleted = document.getElementById('detail-todo-completed').checked;
  const dateInput = document.getElementById('detail-todo-completed-date');
  document.getElementById('detail-completed-date-wrap').hidden = !isCompleted;
  if (isCompleted && !dateInput.value) dateInput.value = todayDateString();
  dateInput.max = todayDateString();
}

// 將詳情面板選定的完成日期換算為 completed_at：
// 日期未變沿用原時間、選今天記錄當下時間、補登過去日期則記為該日 00:00（本地時間）
function resolveCompletedAt(original, dateStr) {
  if (!dateStr) return new Date().toISOString();
  if (original.is_completed && original.completed_at
      && isoToLocalInput(original.completed_at).slice(0, 10) === dateStr) {
    return original.completed_at;
  }
  if (dateStr === todayDateString()) return new Date().toISOString();
  return new Date(`${dateStr}T00:00`).toISOString();
}

// 渲染子任務清單
function renderDetailSubtasks() {
  const listEl = document.getElementById('detail-subtask-list');
  const progressEl = document.getElementById('detail-subtask-progress');
  const subtasks = todoDetailState.subtasks;
  const doneCount = subtasks.filter(s => s.done).length;

  progressEl.textContent = subtasks.length ? `${doneCount}/${subtasks.length}` : '';
  listEl.innerHTML = '';

  subtasks.forEach((sub, index) => {
    const li = document.createElement('li');
    li.className = `subtask-item ${sub.done ? 'done' : ''}`;
    li.innerHTML = `
      <label class="subtask-check">
        <input type="checkbox" ${sub.done ? 'checked' : ''}>
        <span class="subtask-text">${escapeHtml(sub.text)}</span>
      </label>
      <button type="button" class="btn-subtask-remove" title="移除子任務" aria-label="移除子任務">&times;</button>
    `;
    li.querySelector('input').addEventListener('change', (e) => {
      sub.done = e.target.checked;
      todoDetailState.dirty = true;
      renderDetailSubtasks();
    });
    li.querySelector('.btn-subtask-remove').addEventListener('click', () => {
      todoDetailState.subtasks.splice(index, 1);
      todoDetailState.dirty = true;
      renderDetailSubtasks();
    });
    listEl.appendChild(li);
  });
}

// 新增子任務（按鈕或 Enter 觸發）
window.handleAddSubtask = function() {
  const input = document.getElementById('detail-subtask-input');
  const text = input.value.trim();
  if (!text) return;
  todoDetailState.subtasks.push({ id: 's_' + Date.now(), text, done: false });
  todoDetailState.dirty = true;
  input.value = '';
  renderDetailSubtasks();
  input.focus();
};

// 送出任務詳情變更
window.handleTodoDetailSubmit = async function(e) {
  if (e) e.preventDefault();
  if (!appState.currentUser) {
    showToast('請先輸入 Email 登入系統！', 'error');
    openModal('modal-login');
    return;
  }

  const todoId = todoDetailState.todoId;
  const original = appState.todos.find(t => t.id === todoId);
  if (!original) {
    showToast('找不到此任務，可能已被刪除', 'error');
    closeModal('modal-todo-detail');
    return;
  }

  const title = document.getElementById('detail-todo-title').value.trim();
  if (!title) {
    showToast('任務標題不可為空白！', 'error');
    return;
  }

  const isCompleted = document.getElementById('detail-todo-completed').checked;
  const completedDate = document.getElementById('detail-todo-completed-date').value;
  const startDate = document.getElementById('detail-todo-start').value || getTodoStartDate(original);
  if (isCompleted && completedDate) {
    if (completedDate < startDate) {
      showToast('完成日期不可早於開始日期！', 'error');
      return;
    }
    if (completedDate > todayDateString()) {
      showToast('完成日期不可晚於今天！', 'error');
      return;
    }
  }
  const updates = {
    title,
    description: document.getElementById('detail-todo-description').value.trim() || null,
    category_id: document.getElementById('detail-todo-category').value || null,
    start_date: startDate,
    due_date: localInputToISO(document.getElementById('detail-todo-due').value),
    priority: document.getElementById('detail-todo-priority').value || 'normal',
    subtasks: todoDetailState.subtasks,
    is_completed: isCompleted
  };
  // 負責人變更時記錄指派者（資料庫觸發器據此寄送 Email 通知給新加入的負責人）
  const assignedEmails = detailAssigneePicker.getValue();
  if (!sameAssignees(assignedEmails, getTodoAssignees(original))) {
    updates.assigned_emails = assignedEmails;
    updates.assigned_email = assignedEmails[0] || null; // 保留第一位負責人，相容舊欄位
    updates.assigned_by = assignedEmails.length ? appState.currentUser.email : null;
  }
  // 完成時間：取消完成則清空；已完成則依面板上的完成日期記錄（可補登實際完成日）
  if (!isCompleted) {
    if (original.is_completed) updates.completed_at = null;
  } else {
    const completedAt = resolveCompletedAt(original, completedDate);
    if (completedAt !== original.completed_at) updates.completed_at = completedAt;
  }

  const saveBtn = document.getElementById('btn-save-todo-detail');
  saveBtn.disabled = true;
  saveBtn.textContent = '儲存中...';

  try {
    await DataService.updateTodo(todoId, updates);
    todoDetailState.dirty = false;
    renderTodoList();
    renderCategories();
    closeModal('modal-todo-detail');
    showToast('任務內容已更新！', 'success');
  } catch (err) {
    console.error('[TodoDetail] 更新任務失敗:', err);
    // 資料庫尚未執行升級腳本時，欄位不存在會導致更新失敗
    const msg = String(err.message || '');
    if (/assigned_emails/.test(msg)) {
      showToast('資料庫缺少新欄位，請先於 Supabase 執行 schema.sql 第 14 節升級指令', 'error');
    } else if (/description|priority|subtasks/.test(msg)) {
      showToast('資料庫缺少新欄位，請先於 Supabase 執行 schema.sql 第 9 節升級指令', 'error');
    } else {
      showToast('更新任務失敗，請檢查網路連線', 'error');
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '儲存變更';
  }
};

// 於詳情面板中刪除任務
window.handleTodoDetailDelete = async function() {
  const todo = appState.todos.find(t => t.id === todoDetailState.todoId);
  if (!todo) return;
  if (!confirm(`確定要刪除「${todo.title}」嗎？`)) return;
  try {
    await DataService.deleteTodo(todo.id);
    todoDetailState.todoId = null;
    closeModal('modal-todo-detail');
    renderTodoList();
    renderCategories();
    showToast('已刪除待辦事項', 'success');
  } catch (err) {
    showToast('刪除失敗', 'error');
  }
};

// 網址帶有 ?task=<任務ID>（例如從 Email 通知點擊進入）時，登入後自動開啟該任務詳情
function openTaskFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const taskId = params.get('task');
  if (!taskId || !appState.currentUser) return; // 尚未登入則保留參數，待登入後再開啟

  // 移除網址參數，避免重新整理時再次開啟
  params.delete('task');
  const query = params.toString();
  window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);

  if (appState.todos.some(t => t.id === taskId)) {
    openTodoDetail(taskId);
  } else {
    showToast('找不到此任務，可能已被刪除', 'error');
  }
}

// 即時同步：其他成員修改任務時，若本機詳情面板開啟且無未儲存變更，則自動更新內容
function syncTodoDetailFromRemote() {
  const modal = document.getElementById('modal-todo-detail');
  if (!modal || modal.classList.contains('hidden') || !todoDetailState.todoId) return;

  const todo = appState.todos.find(t => t.id === todoDetailState.todoId);
  if (!todo) {
    closeModal('modal-todo-detail');
    showToast('此任務已被其他成員刪除', 'error');
    return;
  }
  if (!todoDetailState.dirty) {
    fillTodoDetailForm(todo);
  }
}

// 輔助函式：防範 XSS 的字串逸出
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 輔助函式：驗證分類顏色為合法 Hex 色碼，避免惡意字串注入 style 屬性
function safeColor(color) {
  return /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#94a3b8';
}

// 輔助函式：取得本地時區「今天」的日期字串 (YYYY-MM-DD)，供 date 輸入框與開始日期預設值使用
function todayDateString() {
  return isoToLocalInput(new Date().toISOString()).slice(0, 10);
}

// 輔助函式：取得任務開始日期 (YYYY-MM-DD)；未設定時以建立日期（本地時區）為準
function getTodoStartDate(todo) {
  if (todo.start_date) return String(todo.start_date).slice(0, 10);
  return isoToLocalInput(todo.created_at).slice(0, 10) || todayDateString();
}

// 輔助函式：計算兩個日曆日 (YYYY-MM-DD) 相差的天數（以本地日期計算，不受時區影響）
function daysBetweenDates(fromDateStr, toDateStr) {
  const toUtcDay = str => {
    const [y, m, d] = str.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtcDay(toDateStr) - toUtcDay(fromDateStr)) / 86400000);
}

// 卡片顯示：開始日期與經過天數（進行中超過 30 天以醒目色提示）
const LONG_OPEN_DAYS = 30;
function formatTodoAge(todo) {
  const startDate = getTodoStartDate(todo);
  const [, m, d] = startDate.split('-').map(Number);
  const startLabel = `${m}/${d}`;

  if (todo.is_completed) {
    const completedDate = todo.completed_at ? isoToLocalInput(todo.completed_at).slice(0, 10) : '';
    if (!completedDate) {
      return { text: '✅ 已結案', className: 'age-closed', title: `開始日期 ${startDate}（無完成時間紀錄）` };
    }
    const days = Math.max(0, daysBetweenDates(startDate, completedDate));
    const [, cm, cd] = completedDate.split('-').map(Number);
    return {
      text: days === 0 ? `✅ ${cm}/${cd} 完成 ・ 當天結案` : `✅ ${cm}/${cd} 完成 ・ 經 ${days} 天`,
      className: 'age-closed',
      title: `開始 ${startDate} → 結案 ${completedDate}`
    };
  }

  const days = Math.max(0, daysBetweenDates(startDate, todayDateString()));
  return {
    text: days === 0 ? `🗓 ${startLabel} 起 ・ 今天` : `🗓 ${startLabel} 起 ・ 已 ${days} 天`,
    className: days >= LONG_OPEN_DAYS ? 'age-long' : '',
    title: `開始日期 ${startDate}`
  };
}

// 輔助函式：將 datetime-local 輸入值（本地時間、無時區）轉為帶時區的 ISO 字串
function localInputToISO(value) {
  if (!value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date.toISOString();
}

// ==========================================
// 8. 系統啟動入口
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[App] 系統啟動中...');

  // 最先初始化 DOM 快取（確保所有元素已存在於 DOM 中）
  initDOM();

  // 綁定所有事件（不依賴任何資料）
  bindEvents();

  // 新增任務的開始日期預設為今天
  if (DOM.inputTodoStart) DOM.inputTodoStart.value = todayDateString();

  // 初始化資料層（允許失敗，失敗則降級為本地模式）
  try {
    await DataService.init();
    console.log('[App] DataService 初始化完成，模式:', appState.isCloudMode ? '雲端' : '本地');
  } catch (err) {
    console.error('[App] DataService 初始化發生錯誤，降級為本地模式:', err);
    // 確保本地模式資料可用
    appState.isCloudMode = false;
    try {
      const localData = localStorage.getItem(LOCAL_DATA_KEY);
      if (!localData) {
        localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(INITIAL_LOCAL_STATE));
      }
      const parsed = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) || '{}');
      appState.whitelist = parsed.whitelist || [];
      appState.categories = parsed.categories || [];
      appState.todos = parsed.todos || [];
    } catch (e) {
      console.error('[App] 本地資料讀取也失敗:', e);
      appState.whitelist = INITIAL_LOCAL_STATE.whitelist;
      appState.categories = INITIAL_LOCAL_STATE.categories;
      appState.todos = INITIAL_LOCAL_STATE.todos;
    }
    DataService.updateModeIndicator();
  }

  // 以下步驟無論資料層成功或失敗都必須執行
  try {
    updateAssigneeDropdown();
  } catch (e) { console.error('[App] updateAssigneeDropdown 錯誤:', e); }

  try {
    renderCategories();
  } catch (e) { console.error('[App] renderCategories 錯誤:', e); }

  try {
    renderTodoList();
  } catch (e) { console.error('[App] renderTodoList 錯誤:', e); }

  // 最關鍵：必須執行身分驗證恢復，否則整個 UI 無法互動
  try {
    checkExistingAuth();
  } catch (e) { console.error('[App] checkExistingAuth 錯誤:', e); }

  try {
    openTaskFromUrl();
  } catch (e) { console.error('[App] openTaskFromUrl 錯誤:', e); }

  console.log('[App] 系統啟動完成，當前使用者:', appState.currentUser?.email || '未登入');
});
