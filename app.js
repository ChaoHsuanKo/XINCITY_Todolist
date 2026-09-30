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
      assigned_email: 'alex@example.com',
      due_date: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 16),
      is_completed: false,
      created_by: 'admin@example.com',
      created_at: new Date(Date.now() - 3600000 * 4).toISOString()
    },
    {
      id: 't2',
      title: '客戶簡報準備與架構檢視',
      category_id: 'c1',
      assigned_email: 'sarah@example.com',
      due_date: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 16),
      is_completed: false,
      created_by: 'alex@example.com',
      created_at: new Date(Date.now() - 3600000 * 2).toISOString()
    },
    {
      id: 't3',
      title: '團隊週會討論與時程同步',
      category_id: 'c3',
      assigned_email: 'alex@example.com',
      due_date: new Date().toISOString().slice(0, 16),
      is_completed: false,
      created_by: 'admin@example.com',
      created_at: new Date(Date.now() - 3600000 * 1).toISOString()
    },
    {
      id: 't4',
      title: '確認伺服器備份與環境變數設定',
      category_id: 'c2',
      assigned_email: 'admin@example.com',
      due_date: new Date(Date.now() - 86400000).toISOString().slice(0, 16),
      is_completed: true,
      created_by: 'admin@example.com',
      created_at: new Date(Date.now() - 86400000 * 2).toISOString()
    }
  ]
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
  sortBy: 'created_desc',      // 'created_desc', 'created_asc', 'due_asc', 'category', 'assignee'
  searchQuery: ''              // 關鍵字搜尋
};

// ==========================================
// 2. DOM 元素快取
// ==========================================
const DOM = {
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
  selectTodoAssignee: document.getElementById('select-todo-assignee'),
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

// ==========================================
// 3. 提示訊息 (Toast) 模組
// ==========================================
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✓' : '⚠'}</span>
    <span>${message}</span>
  `;
  DOM.toastContainer.appendChild(toast);
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
        DataService.fetchTodos().then(renderTodoList);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => {
        DataService.fetchCategories().then(() => {
          renderCategories();
          renderTodoList();
        });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users_whitelist' }, () => {
        DataService.fetchWhitelist().then(() => {
          updateAssigneeDropdown();
          renderWhitelistTable();
        });
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
      if (!error && data) appState.whitelist = data;
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) || '{}');
      appState.whitelist = local.whitelist || [];
    }
  },

  // 2. 取得分類
  async fetchCategories() {
    if (appState.isCloudMode) {
      const { data, error } = await appState.supabaseClient.from('categories').select('*');
      if (!error && data) appState.categories = data;
    } else {
      const local = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) || '{}');
      appState.categories = local.categories || [];
    }
  },

  // 3. 取得待辦事項
  async fetchTodos() {
    if (appState.isCloudMode) {
      const { data, error } = await appState.supabaseClient.from('todos').select('*');
      if (!error && data) appState.todos = data;
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
      local.todos = local.todos.map(t => t.id === todoId ? { ...t, is_completed: isCompleted } : t);
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
    if (appState.isCloudMode) {
      const { data, error } = await appState.supabaseClient
        .from('users_whitelist')
        .insert([{ email, display_name: displayName, role }])
        .select();
      if (error) throw error;
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
  const savedUserJson = sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY);
  if (savedUserJson) {
    try {
      const user = JSON.parse(savedUserJson);
      // 確保仍存在於白名單
      const verified = appState.whitelist.find(u => u.email.toLowerCase() === user.email.toLowerCase());
      if (verified) {
        setUserSession(verified);
        return;
      }
    } catch (e) {
      console.error(e);
    }
  }

  // 尚未登入則彈出登入視窗
  openModal('modal-login');
  renderNavbarAuth(false);
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

    DOM.userDisplayName.textContent = appState.currentUser.display_name;
    DOM.userEmailText.textContent = appState.currentUser.email;
    DOM.userAvatarBadge.textContent = appState.currentUser.display_name.charAt(0);

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
        <span class="cat-dot" style="background: ${cat.color};"></span>
        <span>${escapeHtml(cat.name)}</span>
      </div>
      <div class="cat-right-group">
        ${isAdmin ? `
          <button type="button" class="btn-cat-action btn-cat-edit" title="修改分類 (管理者專用)" data-cat-id="${cat.id}">
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

// 更新指派負責人下拉選單
function updateAssigneeDropdown() {
  DOM.selectTodoAssignee.innerHTML = '<option value="">指派負責人...</option>';
  appState.whitelist.forEach(user => {
    const opt = document.createElement('option');
    opt.value = user.email;
    opt.textContent = `${user.display_name} (${user.email})`;
    DOM.selectTodoAssignee.appendChild(opt);
  });
}

// 格式化到期時間顯示與逾期計算
function formatDueDate(dueString) {
  if (!dueString) return null;
  const dueDate = new Date(dueString);
  const now = new Date();
  
  const diffDays = Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const dateFormatted = dueDate.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  if (diffDays < 0) {
    return { text: `已逾期 (${dateFormatted})`, className: 'overdue' };
  } else if (diffDays === 0 || diffDays === 1) {
    return { text: `今天到期 (${dateFormatted})`, className: 'urgent-today' };
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
      const matchTitle = t.title.toLowerCase().includes(query);
      const assignee = appState.whitelist.find(u => u.email === t.assigned_email);
      const matchAssignee = assignee && (assignee.display_name.toLowerCase().includes(query) || assignee.email.toLowerCase().includes(query));
      return matchTitle || matchAssignee;
    });
  }

  // 5. 多維度排序
  list.sort((a, b) => {
    switch (appState.sortBy) {
      case 'created_asc':
        return new Date(a.created_at) - new Date(b.created_at);
      case 'due_asc':
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date) - new Date(b.due_date);
      case 'category':
        const catA = appState.categories.find(c => c.id === a.category_id)?.name || '';
        const catB = appState.categories.find(c => c.id === b.category_id)?.name || '';
        return catA.localeCompare(catB, 'zh-TW');
      case 'assignee':
        const nameA = appState.whitelist.find(u => u.email === a.assigned_email)?.display_name || '';
        const nameB = appState.whitelist.find(u => u.email === b.assigned_email)?.display_name || '';
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
    const categoryHtml = category ? `
      <span class="badge-category" style="background-color: ${category.color}15; color: ${category.color}; border: 1px solid ${category.color}40;">
        <span class="cat-dot" style="background: ${category.color}; width:6px; height:6px;"></span>
        ${escapeHtml(category.name)}
      </span>
    ` : '';

    // 負責人資訊
    const assignee = appState.whitelist.find(u => u.email === todo.assigned_email);
    const assigneeHtml = assignee ? `
      <span class="assignee-badge" title="負責人: ${escapeHtml(assignee.display_name)} (${assignee.email})">
        <span class="assignee-avatar-mini">${escapeHtml(assignee.display_name.charAt(0))}</span>
        <span>${escapeHtml(assignee.display_name)}</span>
      </span>
    ` : '';

    // 截止日期資訊
    const dueInfo = formatDueDate(todo.due_date);
    const dueHtml = dueInfo ? `
      <span class="due-badge ${dueInfo.className}">
        📅 ${dueInfo.text}
      </span>
    ` : '';

    card.innerHTML = `
      <div class="todo-left-main">
        <button type="button" class="custom-checkbox-btn" aria-label="切換完成狀態" id="checkbox-${todo.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </button>
        <span class="todo-title-text" title="${escapeHtml(todo.title)}">${escapeHtml(todo.title)}</span>
      </div>
      <div class="todo-right-meta">
        ${categoryHtml}
        ${assigneeHtml}
        ${dueHtml}
        <button type="button" class="btn-card-delete" title="刪除此任務" aria-label="刪除任務" id="btn-del-${todo.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;

    // 綁定 Checkbox 打勾事件
    const checkboxBtn = card.querySelector(`#checkbox-${todo.id}`);
    checkboxBtn.addEventListener('click', async () => {
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
    const delBtn = card.querySelector(`#btn-del-${todo.id}`);
    delBtn.addEventListener('click', async () => {
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

    DOM.todoListContainer.appendChild(card);
  });
}

// 渲染白名單成員管理表格 (Admin)
function renderWhitelistTable() {
  DOM.whitelistTableBody.innerHTML = '';
  appState.whitelist.forEach(user => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(user.email)}</strong></td>
      <td>${escapeHtml(user.display_name)}</td>
      <td><span class="badge" style="background:#e2e8f0;">${user.role === 'admin' ? '管理者' : '一般成員'}</span></td>
      <td style="text-align: right;">
        ${user.email !== appState.currentUser?.email ? `
          <button type="button" class="btn btn-outline-danger btn-sm" data-email="${user.email}">移除</button>
        ` : '<span style="color:#94a3b8; font-size:0.75rem;">當前登入者</span>'}
      </td>
    `;

    const removeBtn = tr.querySelector('button');
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

  // 登出按鈕
  DOM.btnLogout.addEventListener('click', handleLogout);
  DOM.btnOpenLogin.addEventListener('click', () => openModal('modal-login'));

  // 2. 修改暱稱
  if (DOM.btnOpenEditNickname) {
    DOM.btnOpenEditNickname.addEventListener('click', () => {
      openEditNicknameModal();
    });
  }

  // 支援點擊個人資訊卡片直接修改暱稱
  const profileChip = document.getElementById('user-profile-chip');
  if (profileChip) {
    profileChip.addEventListener('click', () => {
      openEditNicknameModal();
    });
  }

  if (DOM.formEditNickname) {
    DOM.formEditNickname.addEventListener('submit', (e) => {
      handleEditNicknameSubmit(e);
    });
  }

  // 3. 新增分類
  DOM.btnAddCategory.addEventListener('click', () => {
    if (!appState.currentUser) {
      showToast('請先登入後再建立分類', 'error');
      openModal('modal-login');
      return;
    }
    openModal('modal-category-manager');
  });

  DOM.formCreateCategory.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = DOM.inputCategoryName.value.trim();
    const checkedColor = document.querySelector('input[name="cat-color"]:checked')?.value || '#3b82f6';
    if (!name) return;

    const submitBtn = DOM.formCreateCategory.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '建立中...';
    }

    try {
      await DataService.addCategory(name, checkedColor);
      renderCategories();
      renderTodoList();
      closeModal('modal-category-manager');
      DOM.formCreateCategory.reset();
      showToast(`已成功建立分類「${name}」！`, 'success');
    } catch (err) {
      console.error('建立分類失敗:', err);
      showToast(`建立分類失敗: ${err.message || '請確認網路連線'}`, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '建立分類';
      }
    }
  });

  // 3-1. 修改分類 (僅限管理者)
  DOM.formEditCategory.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!appState.currentUser || appState.currentUser.role !== 'admin') {
      showToast('權限不足：僅有系統管理員可修改分類！', 'error');
      return;
    }

    const catId = DOM.inputEditCategoryId.value;
    const name = DOM.inputEditCategoryName.value.trim();
    const checkedColor = document.querySelector('input[name="edit-cat-color"]:checked')?.value || '#3b82f6';
    if (!catId || !name) return;

    const submitBtn = DOM.formEditCategory.querySelector('button[type="submit"]');
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
      console.error('修改分類失敗:', err);
      showToast(`修改分類失敗: ${err.message || '請確認網路連線'}`, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = '儲存變更';
      }
    }
  });

  // 刪除分類 (僅限管理者)
  DOM.btnDeleteCategory.addEventListener('click', async () => {
    if (!appState.currentUser || appState.currentUser.role !== 'admin') {
      showToast('權限不足：僅有系統管理員可刪除分類！', 'error');
      return;
    }

    const catId = DOM.inputEditCategoryId.value;
    const currentCat = appState.categories.find(c => c.id === catId);
    const catName = currentCat ? currentCat.name : '此分類';

    if (!confirm(`確定要刪除「${catName}」分類嗎？\n刪除後，原本屬於該分類的待辦事項將自動變更為「未分類」。`)) {
      return;
    }

    DOM.btnDeleteCategory.disabled = true;
    try {
      await DataService.deleteCategory(catId);
      renderCategories();
      renderTodoList();
      closeModal('modal-edit-category');
      showToast(`已成功刪除分類「${catName}」`, 'success');
    } catch (err) {
      console.error('刪除分類失敗:', err);
      showToast(`刪除分類失敗: ${err.message || '請確認網路連線'}`, 'error');
    } finally {
      DOM.btnDeleteCategory.disabled = false;
    }
  });

  // 4. 白名單管理 (Admin)
  DOM.btnOpenWhitelist.addEventListener('click', () => {
    renderWhitelistTable();
    openModal('modal-whitelist-manager');
  });

  DOM.formAddWhitelist.addEventListener('submit', async (e) => {
    e.preventDefault();
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
  DOM.btnOpenCloudConfig.addEventListener('click', () => {
    const savedConfig = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (savedConfig) {
      const { url, key } = JSON.parse(savedConfig);
      DOM.inputSupabaseUrl.value = url || '';
      DOM.inputSupabaseKey.value = key || '';
    }
    openModal('modal-cloud-config');
  });

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
    localStorage.removeItem(CONFIG_STORAGE_KEY);
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
    const assignedEmail = DOM.selectTodoAssignee.value || null;
    const dueDate = DOM.inputTodoDue.value || null;

    try {
      await DataService.addTodo({
        title,
        category_id: categoryId,
        assigned_email: assignedEmail,
        due_date: dueDate,
        is_completed: false,
        created_by: appState.currentUser.email
      });

      DOM.inputTodoTitle.value = '';
      DOM.inputTodoDue.value = '';
      renderTodoList();
      renderCategories();
      showToast('待辦事項已新增！', 'success');
    } catch (err) {
      showToast('新增待辦失敗', 'error');
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

// ==========================================
// 8. 系統啟動入口
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  await DataService.init();
  updateAssigneeDropdown();
  renderCategories();
  renderTodoList();
  checkExistingAuth();
});
