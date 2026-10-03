/**
 * Supabase Edge Function：任務指派 Email 通知 (notify-assignee)
 *
 * 由資料庫觸發器 notify_task_assignment()（schema.sql 第 11 節）在任務被指派負責人時呼叫，
 * 透過 Gmail SMTP 寄送任務資訊與直達連結給負責人，負責人為管委會時，並以副本 (CC) 寄給管理員設定的「同時通知」成員。
 *
 * 需於 Supabase → Edge Functions → Secrets 設定：
 *   GMAIL_USER          寄件 Gmail 帳號（管委會信箱）
 *   GMAIL_APP_PASSWORD  該帳號的 Google「應用程式密碼」（16 碼）
 *   WEBHOOK_SECRET      與觸發器共用的驗證密鑰，防止外部任意呼叫寄信
 *   SITE_URL            網站網址，例如 https://chaohsuanko.github.io/XINCITY_Todolist/
 *   MAIL_FROM_NAME      （選填）寄件者顯示名稱，預設「鑫悅管理委員會」
 * SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自動提供。
 *
 * 部署時須關閉「Verify JWT」（改以 WEBHOOK_SECRET 驗證）。
 */
import nodemailer from 'npm:nodemailer@6.9.16';
import { createClient } from 'npm:@supabase/supabase-js@2';

const PRIORITY_LABELS: Record<string, string> = { high: '🔴 高', normal: '一般', low: '🔵 低' };

// 防範 XSS：任務內容皆為使用者輸入，寫入 HTML 前必須逸出
function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 以台灣時區格式化日期時間
function formatTaipei(iso: string | null): string {
  if (!iso) return '未設定';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '未設定';
  return d.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: 'numeric', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  });
}

// 開始日期 (YYYY-MM-DD)；未設定時以建立日期（台灣時區）為準
function formatStartDate(startDate: string | null, createdAt: string): string {
  const dateStr = startDate
    ? String(startDate).slice(0, 10)
    : new Date(createdAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }); // sv-SE 格式即 YYYY-MM-DD
  const [y, m, d] = dateStr.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  // 1. 驗證呼叫來源（僅允許帶有正確密鑰的資料庫觸發器）
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let todoId: string | undefined;
  try {
    ({ todo_id: todoId } = await req.json());
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }
  if (!todoId) return json({ error: 'Missing todo_id' }, 400);

  // 2. 以 service role 讀取最新任務資料（不採信呼叫端傳入的內容）
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: todo, error: todoErr } = await supabase.from('todos').select('*').eq('id', todoId).maybeSingle();
  if (todoErr) return json({ error: todoErr.message }, 500);
  if (!todo || !todo.assigned_email) return json({ skipped: '任務不存在或無負責人' });

  const { data: members, error: membersErr } = await supabase.from('users_whitelist').select('*');
  if (membersErr) return json({ error: membersErr.message }, 500);
  const findMember = (email: string | null) =>
    email ? (members || []).find(m => m.email.toLowerCase() === email.toLowerCase()) : undefined;

  // 只寄給白名單成員，避免被利用寄信給外部信箱
  const assignee = findMember(todo.assigned_email);
  if (!assignee) return json({ skipped: '負責人不在白名單中' });

  const assignedBy = (todo.assigned_by || '').toLowerCase();
  // 自己指派給自己：負責人本人不寄，但「同時通知」的成員仍會收到
  const notifyAssignee = assignedBy !== assignee.email.toLowerCase();

  // 同時通知 (CC)：僅管委會帳號適用（與前端 NOTIFY_CC_ACCOUNTS 一致）；僅限白名單成員，排除負責人本人與指派者
  const NOTIFY_CC_ACCOUNTS = ['hsinyueh.hoa@gmail.com'];
  const ccSource = NOTIFY_CC_ACCOUNTS.includes(assignee.email.toLowerCase()) && Array.isArray(assignee.notify_cc)
    ? assignee.notify_cc : [];
  const ccMembers = ccSource
    .map((email: string) => findMember(email))
    .filter((m, i, arr) =>
      m &&
      m.email.toLowerCase() !== assignee.email.toLowerCase() &&
      m.email.toLowerCase() !== assignedBy &&
      arr.findIndex(x => x?.email === m.email) === i // 去除重複
    ) as { email: string; display_name: string }[];

  if (!notifyAssignee && ccMembers.length === 0) {
    return json({ skipped: '自己指派給自己，且無同時通知對象' });
  }

  let categoryName = '未分類';
  if (todo.category_id) {
    const { data: cat } = await supabase.from('categories').select('name').eq('id', todo.category_id).maybeSingle();
    if (cat) categoryName = cat.name;
  }

  const assigner = findMember(todo.assigned_by);
  const assignerName = assigner?.display_name || todo.assigned_by || '團隊成員';
  const siteUrl = Deno.env.get('SITE_URL') || 'https://chaohsuanko.github.io/XINCITY_Todolist/';
  const taskUrl = `${siteUrl}?task=${encodeURIComponent(todo.id)}`;

  // 3. 組合信件內容
  // 開頭問候：一般為「負責人您好，指派者指派了任務給您」；自己指派給自己時改為通知同時通知成員
  const greetingText = notifyAssignee
    ? `${assignee.display_name} 您好，${assignerName} 指派了一項任務給您：`
    : `您好，${assignee.display_name} 已接下以下任務（您為同時通知對象）：`;
  const subtasks: { text: string; done: boolean }[] = Array.isArray(todo.subtasks) ? todo.subtasks : [];
  const subtasksHtml = subtasks.length
    ? `<ul style="margin:4px 0 0;padding-left:20px;">${subtasks
        .map(s => `<li style="margin:2px 0;${s.done ? 'color:#94a3b8;text-decoration:line-through;' : ''}">${escapeHtml(s.text)}</li>`)
        .join('')}</ul>`
    : '';

  const isOverdue = todo.due_date && new Date(todo.due_date) < new Date();
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:8px 12px;color:#64748b;white-space:nowrap;vertical-align:top;width:72px;">${label}</td>
      <td style="padding:8px 12px;color:#0f172a;">${value}</td>
    </tr>`;

  const html = `
  <div style="background:#f8fafc;padding:24px 12px;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:#1e293b;color:#f8fafc;padding:16px 24px;font-size:15px;font-weight:600;">📋 鑫悅待辦清單 ・ 新任務指派</div>
      <div style="padding:24px;">
        <p style="margin:0 0 16px;color:#334155;font-size:15px;">
          ${escapeHtml(greetingText)}
        </p>
        <h2 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${escapeHtml(todo.title)}</h2>
        ${ccMembers.length ? `<p style="margin:-8px 0 16px;color:#64748b;font-size:13px;">副本通知：${ccMembers.map(m => escapeHtml(m.display_name || m.email)).join('、')}</p>` : ''}
        <table style="width:100%;border-collapse:collapse;font-size:14px;background:#f8fafc;border-radius:8px;">
          ${row('分類', escapeHtml(categoryName))}
          ${row('開始日期', escapeHtml(formatStartDate(todo.start_date, todo.created_at)))}
          ${row('截止時間', `<span style="${isOverdue ? 'color:#dc2626;font-weight:600;' : ''}">${escapeHtml(formatTaipei(todo.due_date))}${isOverdue ? '（已逾期）' : ''}</span>`)}
          ${row('優先度', escapeHtml(PRIORITY_LABELS[todo.priority] || '一般'))}
          ${todo.description ? row('說明', `<div style="white-space:pre-wrap;">${escapeHtml(todo.description)}</div>`) : ''}
          ${subtasks.length ? row('子任務', `${subtasks.filter(s => s.done).length}/${subtasks.length} 已完成${subtasksHtml}`) : ''}
        </table>
        <div style="text-align:center;margin:28px 0 8px;">
          <a href="${escapeHtml(taskUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">查看任務詳情 →</a>
        </div>
        <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;text-align:center;">
          若按鈕無法點擊，請複製此連結至瀏覽器開啟：<br>
          <a href="${escapeHtml(taskUrl)}" style="color:#64748b;word-break:break-all;">${escapeHtml(taskUrl)}</a>
        </p>
      </div>
    </div>
    <p style="text-align:center;color:#94a3b8;font-size:12px;margin:16px 0 0;">此信件由系統自動寄出，請勿直接回覆。</p>
  </div>`;

  const text = [
    greetingText,
    '',
    `任務：${todo.title}`,
    ccMembers.length ? `副本通知：${ccMembers.map(m => m.display_name || m.email).join('、')}` : '',
    `分類：${categoryName}`,
    `開始日期：${formatStartDate(todo.start_date, todo.created_at)}`,
    `截止時間：${formatTaipei(todo.due_date)}`,
    `優先度：${PRIORITY_LABELS[todo.priority] || '一般'}`,
    todo.description ? `說明：\n${todo.description}` : '',
    '',
    `查看任務詳情：${taskUrl}`
  ].join('\n');

  // 4. 透過 Gmail SMTP 寄出（Supabase Edge Functions 不允許 587 埠，使用 465 SSL）
  // 去除所有空白：Google 顯示的應用程式密碼為「abcd efgh ijkl mnop」格式，複製時常夾帶空格
  const gmailUser = (Deno.env.get('GMAIL_USER') || '').trim();
  const gmailPass = (Deno.env.get('GMAIL_APP_PASSWORD') || '').replace(/\s/g, '');
  if (!gmailUser || !gmailPass) {
    return json({ error: '尚未設定 GMAIL_USER 或 GMAIL_APP_PASSWORD' }, 500);
  }
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPass }
  });

  // 收件人：負責人（自己指派給自己時改由同時通知成員為收件人）；副本：同時通知成員
  const toList = notifyAssignee ? [assignee.email] : ccMembers.map(m => m.email);
  const ccList = notifyAssignee ? ccMembers.map(m => m.email) : [];

  try {
    await transporter.sendMail({
      from: { name: Deno.env.get('MAIL_FROM_NAME') || '鑫悅管理委員會', address: gmailUser },
      to: toList,
      cc: ccList.length ? ccList : undefined,
      subject: `【新任務指派】${todo.title}`,
      text,
      html
    });
  } catch (err) {
    console.error('[notify-assignee] 寄信失敗:', err);
    // 附上排查資訊（僅帳號與密碼長度，不含密碼內容）；應用程式密碼應為 16 碼
    return json({
      error: `寄信失敗：${(err as Error).message}`,
      gmail_user: gmailUser,
      app_password_length: gmailPass.length
    }, 500);
  }

  console.log(`[notify-assignee] 已寄送任務 ${todo.id} 通知 to=${toList.join(',')} cc=${ccList.join(',')}`);
  return json({ sent: true, to: toList, cc: ccList });
});
