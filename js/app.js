import {
  ATTENDANCE_STATUSES,
  ATTRIBUTES,
  DRINK_LIMITS,
  DRINK_PLAN_TYPES,
  EVENT_STATUSES,
  RESERVATION_SEAT_ORDER,
  SEAT_TYPES,
  SLOT_LIMITS,
  STAFF_ATTENDANCE_STATUSES,
  TIME_SLOTS,
  buildDefaultState,
  archiveFinishedEvents,
  clone,
  createId,
  deleteDrinkPlan,
  deleteReservation,
  findEvent,
  findReservationBySlot,
  findStaffMember,
  findUser,
  formatDateLabel,
  formatDateTime,
  generateAttendanceDiscordText,
  generateReservationDiscordText,
  getActiveEvents,
  getActiveUsers,
  getArchivedEvents,
  getAttendanceEntry,
  getAttendanceEntriesForEvent,
  getAttendanceSummary,
  getDashboardIssues,
  getDrinkLimitStatuses,
  getDrinkTotals,
  getDrinkPlanTotals,
  getDrinkPlansForEvent,
  getGroupLabels,
  getLimitStatus,
  getMissingUsers,
  getReservationOpenAt,
  getReservationWarnings,
  getReservationsForEvent,
  getRoles,
  getSeatLimitStatuses,
  getActiveStaffMembers,
  getTimeSlotLabel,
  getMissingStaffMembers,
  getStaffAttendanceEntry,
  getStaffAttendanceSummary,
  getVacationExemptUsers,
  isEventArchived,
  isReservationFilled,
  isOnVacation,
  isReservationOpen,
  normalizeReservation,
  setRoleActive,
  setStaffMemberActive,
  setUserActive,
  sortedStaffMembers,
  sortedUsers,
  toLocalDateTimeString,
  upsertAttendance,
  upsertDrinkPlan,
  upsertEvent,
  upsertReservation,
  upsertRole,
  upsertStaffAttendance,
  upsertStaffMember,
  upsertUser,
  upsertVacation,
  wasReservationChangedAfterEventCutoff,
} from "./core.js";

const STORAGE_KEY = "abyss_host_event_manager_v1";
const SITE_SESSION_KEY = "abyss_site_unlocked";
const ADMIN_SESSION_KEY = "abyss_admin_unlocked";
const APP_CONFIG = window.ABYSS_CONFIG || {};

const root = document.querySelector("#app");
const toastRoot = document.querySelector("#toast");

let state = loadState();
let syncStatus = getInitialSyncStatus();
const archiveResult = archiveFinishedEvents(state);
if (archiveResult.changed) {
  state = archiveResult.state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
let siteUnlocked = sessionStorage.getItem(SITE_SESSION_KEY) === "1";
let adminUnlocked = sessionStorage.getItem(ADMIN_SESSION_KEY) === "1";
let view = {
  page: "attendance",
  adminTab: "dashboard",
  eventId: "",
  archiveEventId: "",
  attendanceUserId: "",
  staffAttendanceMemberId: "",
  reservationTab: "grid",
  dashboardDetailType: "",
  dashboardDetailKey: "",
  editingUserId: "",
  editingStaffMemberId: "",
  editingVacationId: "",
  editingEventId: "",
};

view.eventId = getDefaultEventId();
view.archiveEventId = getDefaultArchiveEventId();
view.attendanceUserId = getActiveUsers(state)[0]?.id || "";
view.staffAttendanceMemberId = getActiveStaffMembers(state)[0]?.id || "";

render();
initializeSharedState();

root.addEventListener("click", handleClick);
root.addEventListener("submit", handleSubmit);
root.addEventListener("change", handleChange);
window.setInterval(archiveEndedEvents, 60_000);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDefaultState();
    const parsed = JSON.parse(raw);
    if (!parsed?.meta || !Array.isArray(parsed.users)) return buildDefaultState();
    return migrateState(parsed);
  } catch (error) {
    console.warn(error);
    return buildDefaultState();
  }
}

function migrateState(saved) {
  const fresh = buildDefaultState();
  return {
    ...fresh,
    ...saved,
    event_dates: migrateEventDates(saved.event_dates || fresh.event_dates),
    reservations: migrateReservations(saved.reservations || [], saved.event_dates || fresh.event_dates),
    drink_plans: migrateDrinkPlans(saved.drink_plans || []),
    roles: saved.roles || fresh.roles,
    staff_members: saved.staff_members || [],
    staff_attendance_entries: saved.staff_attendance_entries || [],
    settings: { ...fresh.settings, ...(saved.settings || {}) },
    meta: { ...fresh.meta, ...(saved.meta || {}) },
  };
}

function migrateReservations(reservations, events) {
  return reservations.map((reservation) => {
    if (!reservation.late_warning) return reservation;
    const event = events.find((item) => item.id === reservation.event_date_id);
    if (wasReservationChangedAfterEventCutoff(event, reservation)) return reservation;
    return { ...reservation, late_warning: false };
  });
}

function migrateEventDates(events) {
  return events.map((event) => {
    if (!event.event_date) return event;
    const autoOpenAt = getReservationOpenAt(event.event_date);
    const legacyOpenAt = getLegacyReservationOpenAt(event.event_date);
    const shouldUpdateOpenAt = !event.reservation_open_at || event.reservation_open_at === legacyOpenAt;
    return {
      ...event,
      reservation_open_at: shouldUpdateOpenAt ? autoOpenAt : event.reservation_open_at,
    };
  });
}

function getLegacyReservationOpenAt(eventDate) {
  const date = new Date(`${eventDate}T00:00:00`);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  date.setHours(22, 0, 0, 0);
  return toLocalDateTimeString(date);
}

function migrateDrinkPlans(plans) {
  const stamp = new Date().toISOString();
  return plans.map((plan) => ({
    ...plan,
    id: plan.id || createId("plan"),
    created_at: plan.created_at || stamp,
    updated_at: plan.updated_at || plan.created_at || stamp,
    deleted_at: plan.deleted_at || null,
    is_deleted: Boolean(plan.is_deleted),
  }));
}

function isPlaceholder(value) {
  return !value || String(value).startsWith("PASTE_");
}

function getStorageMode() {
  return APP_CONFIG.storageMode === "supabase" && !isPlaceholder(APP_CONFIG.supabaseUrl) && !isPlaceholder(APP_CONFIG.supabaseAnonKey)
    ? "supabase"
    : "local";
}

function getInitialSyncStatus() {
  if (APP_CONFIG.storageMode === "supabase" && getStorageMode() !== "supabase") {
    return { mode: "error", text: "Supabase未設定。URL/keyを入力してください" };
  }
  const mode = getStorageMode();
  return { mode, text: mode === "supabase" ? "共有DBに接続中" : "この端末に保存" };
}

async function initializeSharedState() {
  if (syncStatus.mode !== "supabase") return;
  try {
    const remoteState = await loadSharedState();
    if (remoteState) {
      state = migrateState(remoteState);
      const result = archiveFinishedEvents(state);
      if (result.changed) {
        state = result.state;
        await saveSharedState(state);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      syncStatus = { mode: "supabase", text: "共有DBと同期済み" };
      render();
      return;
    }
    await saveSharedState(state);
    syncStatus = { mode: "supabase", text: "共有DBを初期化済み" };
    render();
  } catch (error) {
    console.error(error);
    syncStatus = { mode: "error", text: shortSyncError(error, "共有DBに接続できません") };
    render();
  }
}

function shortSyncError(error, fallback) {
  const message = String(error?.message || error || fallback);
  const status = message.match(/Supabase (?:load|save) failed: (\d+)/)?.[1];
  if (status) return `${fallback} (${status})`;
  return fallback;
}

async function loadSharedState() {
  const url = `${APP_CONFIG.supabaseUrl.replace(/\/$/, "")}/rest/v1/app_state?id=eq.${encodeURIComponent(
    APP_CONFIG.stateRowId || "host-event-manager",
  )}&select=payload`;
  const response = await fetch(url, {
    headers: getSupabaseHeaders(),
  });
  if (!response.ok) throw new Error(`Supabase load failed: ${response.status} ${await response.text()}`);
  const rows = await response.json();
  const payload = rows[0]?.payload;
  return payload && Object.keys(payload).length ? payload : null;
}

async function saveSharedState(nextState) {
  if (syncStatus.mode !== "supabase") return;
  const url = `${APP_CONFIG.supabaseUrl.replace(/\/$/, "")}/rest/v1/app_state`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...getSupabaseHeaders(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify({
      id: APP_CONFIG.stateRowId || "host-event-manager",
      payload: nextState,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) throw new Error(`Supabase save failed: ${response.status} ${await response.text()}`);
}

function getSupabaseHeaders() {
  const headers = { apikey: APP_CONFIG.supabaseAnonKey };
  if (!String(APP_CONFIG.supabaseAnonKey).startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${APP_CONFIG.supabaseAnonKey}`;
  }
  return headers;
}

function saveState(nextState, message = "保存しました。") {
  state = nextState;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (syncStatus.mode === "supabase") {
    saveSharedState(state)
      .then(() => {
        syncStatus = { mode: "supabase", text: "共有DBと同期済み" };
        render();
      })
      .catch((error) => {
        console.error(error);
        syncStatus = { mode: "error", text: shortSyncError(error, "共有DBへの保存に失敗") };
        render();
      });
  }
  showToast(message);
  render();
}

function archiveEndedEvents() {
  const result = archiveFinishedEvents(state);
  if (!result.changed) return;
  saveState(result.state, "終了したイベント日をアーカイブしました。");
}

function getDefaultEventId() {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  const activeEvents = state.event_dates.filter((event) => !isEventArchived(event));
  const open = activeEvents.find((event) => event.event_date >= todayKey && event.status !== "休み");
  return open?.id || activeEvents.find((event) => event.status !== "休み")?.id || activeEvents[0]?.id || "";
}

function getDefaultArchiveEventId() {
  const archived = getArchivedEvents(state).sort((a, b) => b.event_date.localeCompare(a.event_date));
  return archived[0]?.id || "";
}

function render() {
  if (!siteUnlocked) {
    root.innerHTML = renderSiteLogin();
    return;
  }

  const selectedEvent = findEvent(state, view.eventId);
  if (!selectedEvent || isEventArchived(selectedEvent)) view.eventId = getDefaultEventId();
  if (view.archiveEventId && !findEvent(state, view.archiveEventId)) view.archiveEventId = "";
  if (!findUser(state, view.attendanceUserId)) view.attendanceUserId = getActiveUsers(state)[0]?.id || "";
  const selectedStaffMember = findStaffMember(state, view.staffAttendanceMemberId);
  if (!selectedStaffMember || selectedStaffMember.is_active === false) view.staffAttendanceMemberId = getActiveStaffMembers(state)[0]?.id || "";

  root.innerHTML = `
    <div class="app-shell">
      <header class="app-header">
        <div class="brand-lockup">
          <img class="brand-mark" src="assets/abyss-logo.png" alt="ABYSS">
          <div>
            <p class="eyebrow">ABYSS Host Event Manager</p>
            <h1>ホスイベ勤怠・予約管理</h1>
          </div>
        </div>
        <nav class="top-nav" aria-label="主要画面">
          <span class="sync-pill ${syncStatus.mode}">${escapeHtml(syncStatus.text)}</span>
          ${navButton("attendance", "ホスト勤怠入力")}
          ${navButton("staffAttendance", "内勤勤怠入力")}
          ${navButton("reservation", "予約入力")}
          ${navButton("admin", "運営画面")}
        </nav>
      </header>
      <main>
        ${renderCurrentPage()}
      </main>
    </div>
  `;
}

function renderSiteLogin() {
  return `
    <div class="app-shell">
      <section class="panel login-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Password</p>
            <h2>サイトログイン</h2>
          </div>
        </div>
        <form class="stack" data-action="site-login">
          <label>
            <span>サイト全体パスワード</span>
            <input name="password" type="password" autocomplete="current-password" required autofocus>
          </label>
          <button class="primary-button" type="submit">サイトを表示</button>
        </form>
        <p class="login-note">運営パスワードでもログインできます。その場合は運営画面も同時に解放されます。</p>
      </section>
    </div>
  `;
}

function navButton(page, label) {
  return `<button class="nav-button ${view.page === page ? "is-active" : ""}" data-action="navigate" data-page="${page}" type="button">${label}</button>`;
}

function renderCurrentPage() {
  if (view.page === "staffAttendance") return renderStaffAttendancePage();
  if (view.page === "reservation") return renderReservationPage(false);
  if (view.page === "admin") return renderAdminPage();
  return renderAttendancePage();
}

function renderAttendancePage() {
  const event = findEvent(state, view.eventId);
  const events = getActiveEvents(state)
    .filter((item) => item.status !== "休み")
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const activeUsers = getActiveUsers(state);
  return `
    <section class="page-grid two-col">
      <div class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Host</p>
            <h2>ホスト勤怠まとめ入力</h2>
          </div>
          <span class="capacity ok">${events.length}日分</span>
        </div>
        <form class="bulk-attendance-form" data-action="save-bulk-attendance">
          <label>
            <span>ホスト名</span>
            <select name="user_id" data-role="attendance-user-select">
              ${activeUsers.map((user) => option(user.id, user.display_name, user.id === view.attendanceUserId)).join("")}
            </select>
          </label>
          <p class="plan-note">各日程の出欠をまとめて選択できます。何も選んでいない日は未入力のままです。</p>
          ${activeUsers.length && events.length ? `
            <button class="primary-button bulk-save-button" type="submit">まとめて登録 / 更新する</button>
            <div class="bulk-attendance-list">
              ${events.map((item) => renderBulkAttendanceRow(item)).join("")}
            </div>
          ` : `<p class="empty">入力対象の日程またはホストがありません。</p>`}
        </form>
      </div>
      <aside class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Status</p>
            <h2>${event ? formatDateLabel(event.event_date) : "対象日未設定"}</h2>
          </div>
          ${statusPill(event?.status || "未設定")}
        </div>
        <label>
          <span>確認する日付</span>
          <select data-role="event-select">
            ${renderEventOptions(view.eventId)}
          </select>
        </label>
        ${renderAttendanceSummaryCards(view.eventId)}
        <div class="subsection">
          <h3>未入力者</h3>
          ${renderNameList(getMissingUsers(state, view.eventId), "未入力者はいません。")}
        </div>
      </aside>
    </section>
  `;
}

function renderBulkAttendanceRow(event) {
  const entry = getAttendanceEntry(state, event.id, view.attendanceUserId);
  return `
    <div class="bulk-attendance-row">
      <input type="hidden" name="attendance_event_id" value="${event.id}">
      <div class="bulk-date">
        <h3>${formatDateLabel(event.event_date)}</h3>
        <span>${formatDateTime(event.reservation_open_at)} 解放</span>
      </div>
      <div class="bulk-status-options" role="radiogroup" aria-label="${formatDateLabel(event.event_date)} の出欠">
        ${ATTENDANCE_STATUSES.map((status) => `
          <label class="bulk-status-option status-${status}">
            <input name="status_${event.id}" type="radio" value="${status}" ${entry?.status === status ? "checked" : ""}>
            <span>${bulkAttendanceLabel(status)}</span>
          </label>
        `).join("")}
      </div>
      <label class="bulk-memo">
        <span>メモ</span>
        <input name="memo_${event.id}" value="${escapeAttr(entry?.memo || "")}" placeholder="任意">
      </label>
    </div>
  `;
}

function bulkAttendanceLabel(status) {
  if (status === "出勤") return "○ 出勤";
  if (status === "欠席") return "× 欠席";
  if (status === "未定") return "△ 未定";
  return status;
}

function renderStaffAttendancePage() {
  const event = findEvent(state, view.eventId);
  const events = getActiveEvents(state)
    .filter((item) => item.status !== "休み")
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  const staffMembers = getActiveStaffMembers(state);
  return `
    <section class="page-grid two-col">
      <div class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Staff</p>
            <h2>内勤勤怠まとめ入力</h2>
          </div>
          <span class="capacity ok">${events.length}日分</span>
        </div>
        <form class="bulk-attendance-form" data-action="save-bulk-staff-attendance">
          <label>
            <span>内勤名</span>
            <select name="staff_member_id" data-role="staff-attendance-member-select">
              ${staffMembers.map((member) => option(member.id, member.display_name, member.id === view.staffAttendanceMemberId)).join("")}
            </select>
          </label>
          <p class="plan-note">各日程の内勤出勤をまとめて選択できます。何も選んでいない日は未入力のままです。</p>
          ${staffMembers.length && events.length ? `
            <button class="primary-button bulk-save-button" type="submit">まとめて登録 / 更新する</button>
            <div class="bulk-attendance-list">
              ${events.map((item) => renderBulkStaffAttendanceRow(item)).join("")}
            </div>
          ` : `<p class="empty">入力対象の日程または内勤スタッフがありません。運営画面の「内勤一覧」から追加してください。</p>`}
        </form>
      </div>
      <aside class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Staff Status</p>
            <h2>${event ? formatDateLabel(event.event_date) : "対象日未設定"}</h2>
          </div>
          ${statusPill(event?.status || "未設定")}
        </div>
        <label>
          <span>確認する日付</span>
          <select data-role="event-select">
            ${renderEventOptions(view.eventId)}
          </select>
        </label>
        ${renderStaffAttendanceSummaryCards(view.eventId)}
        <div class="subsection">
          <h3>内勤未入力</h3>
          ${renderNameList(getMissingStaffMembers(state, view.eventId), "内勤の未入力者はいません。")}
        </div>
      </aside>
    </section>
  `;
}

function renderBulkStaffAttendanceRow(event) {
  const entry = getStaffAttendanceEntry(state, event.id, view.staffAttendanceMemberId);
  return `
    <div class="bulk-attendance-row">
      <input type="hidden" name="attendance_event_id" value="${event.id}">
      <div class="bulk-date">
        <h3>${formatDateLabel(event.event_date)}</h3>
        <span>${formatDateTime(event.reservation_open_at)} 解放</span>
      </div>
      <div class="bulk-status-options is-staff" role="radiogroup" aria-label="${formatDateLabel(event.event_date)} の内勤出勤">
        ${STAFF_ATTENDANCE_STATUSES.map((status) => `
          <label class="bulk-status-option status-${status}">
            <input name="status_${event.id}" type="radio" value="${status}" ${entry?.status === status ? "checked" : ""}>
            <span>${bulkAttendanceLabel(status)}</span>
          </label>
        `).join("")}
      </div>
      <label class="bulk-memo">
        <span>メモ</span>
        <input name="memo_${event.id}" value="${escapeAttr(entry?.memo || "")}" placeholder="任意">
      </label>
    </div>
  `;
}

function renderReservationPage(adminMode) {
  const event = findEvent(state, view.eventId);
  const locked = event && !adminMode && !isReservationOpen(event);
  const isHoliday = event?.status === "休み";
  return `
    <section class="panel page-panel">
      <div class="panel-heading wide-heading">
        <div>
          <p class="eyebrow">${adminMode ? "Admin" : "Host"}</p>
          <h2>${event ? formatDateLabel(event.event_date) : "予約入力"}</h2>
        </div>
        <div class="toolbar compact">
          <div class="tab-switch" aria-label="予約表示切替">
            ${reservationTabButton("grid", "予約入力")}
            ${reservationTabButton("towers", "タワー一覧")}
          </div>
          <select data-role="event-select" aria-label="対象日">
            ${renderEventOptions(view.eventId)}
          </select>
          ${statusPill(event?.status || "未設定")}
        </div>
      </div>
      ${view.reservationTab === "towers" ? renderTowerScheduleOverview() : `
        ${renderReservationOpenNotice(event, adminMode)}
        ${isHoliday ? `<div class="notice muted">この日は休みです。勤怠・予約入力対象外です。</div>` : ""}
        ${renderDrinkPlans(event?.id || "", { locked: Boolean(isHoliday || (event && isEventArchived(event))) })}
        ${renderReservationGrid(view.eventId, { adminMode, locked: Boolean(locked || isHoliday) })}
      `}
    </section>
  `;
}

function reservationTabButton(tab, label) {
  return `<button class="tab-button ${view.reservationTab === tab ? "is-active" : ""}" data-action="reservation-tab" data-tab="${tab}" type="button">${label}</button>`;
}

function renderReservationOpenNotice(event, adminMode) {
  if (!event) return "";
  if (event.status === "休み") return "";
  if (adminMode) {
    return `<div class="notice">運営画面では予約解放前でも代理入力できます。通常解放: ${formatDateTime(event.reservation_open_at)}</div>`;
  }
  if (isReservationOpen(event)) {
    return `<div class="notice success">予約入力受付中です。解放日時: ${formatDateTime(event.reservation_open_at)}</div>`;
  }
  return `<div class="notice muted">この日の予約入力は前週の日曜22:00から開始されます。現在は閲覧のみ可能です。解放日時: ${formatDateTime(event.reservation_open_at)}</div>`;
}

function renderDrinkPlans(eventId, { locked = false } = {}) {
  const event = findEvent(state, eventId);
  if (!event) return "";
  const plans = getDrinkPlansForEvent(state, eventId);
  const totals = getDrinkPlanTotals(state, eventId);
  return `
    <section class="drink-plan-panel">
      <div class="section-title">
        <h3>シャンパン・タワー事前予定</h3>
        <span class="capacity ok">予約解放前でも入力可</span>
      </div>
      <p class="plan-note">タワーやシャンパンを先に把握するための予定欄です。実際の予約枠・上限集計とは別管理です。</p>
      <form class="drink-plan-form" data-action="save-drink-plan">
        <input type="hidden" name="event_date_id" value="${eventId}">
        <label><span>予定タイミング</span><select name="time_slot" ${locked ? "disabled" : ""}>${TIME_SLOTS.map((slot) => option(slot, getTimeSlotLabel(slot), false)).join("")}</select></label>
        <label><span>担当ホスト</span><select name="host_user_id" ${locked ? "disabled" : ""}><option value="">未選択</option>${getActiveUsers(state).map((user) => option(user.id, user.display_name, false)).join("")}</select></label>
        <label><span>種類</span><select name="item_type" ${locked ? "disabled" : ""}>${DRINK_PLAN_TYPES.map((item) => option(item.key, item.label, item.key === "tower")).join("")}</select></label>
        <label><span>本数</span><input name="count" type="number" min="1" step="1" value="1" ${locked ? "disabled" : ""}></label>
        <label class="span-2"><span>メモ</span><input name="memo" placeholder="姫名、予定内容、確認事項など" ${locked ? "disabled" : ""}></label>
        <button class="primary-button" type="submit" ${locked ? "disabled" : ""}>予定を追加</button>
      </form>
      ${renderDrinkPlanTotals(totals)}
      ${renderDrinkPlanList(plans, locked)}
    </section>
  `;
}

function renderDrinkPlanTotals(totals) {
  return `
    <ul class="plan-total-list">
      ${DRINK_PLAN_TYPES.map((item) => `<li><span>${item.label}</span><strong>${totals[item.key] || 0}</strong></li>`).join("")}
    </ul>
  `;
}

function renderDrinkPlanList(plans, locked) {
  if (!plans.length) return `<p class="empty">事前予定はまだありません。</p>`;
  return `
    <div class="table-wrap plan-table-wrap">
      <table class="data-table plan-table">
        <thead><tr><th>予定</th><th>担当ホスト</th><th>種類</th><th>本数</th><th>メモ</th><th>操作</th></tr></thead>
        <tbody>
          ${plans.map((plan) => {
            const type = DRINK_PLAN_TYPES.find((item) => item.key === plan.item_type);
            return `
              <tr>
                <td>${getTimeSlotLabel(plan.time_slot)}</td>
                <td>${escapeHtml(findUser(state, plan.host_user_id)?.display_name || "未選択")}</td>
                <td>${escapeHtml(type?.label || plan.item_type)}</td>
                <td>${Number(plan.count) || 0}</td>
                <td>${escapeHtml(plan.memo || "")}</td>
                <td><button class="icon-button danger" data-action="delete-drink-plan" data-plan-id="${escapeAttr(plan.id || "")}" type="button" ${locked || !plan.id ? "disabled" : ""}>削除</button></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTowerScheduleOverview() {
  const events = getActiveEvents(state)
    .filter((event) => event.status !== "休み")
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  if (!events.length) return `<p class="empty">今後の開催日はありません。</p>`;
  return `
    <section class="tower-overview">
      <div class="section-title">
        <h3>この先のタワー予約状況</h3>
        <span class="capacity ok">空き日をまとめて確認</span>
      </div>
      <div class="tower-summary-list">
        ${events.map((event) => renderTowerScheduleItem(event)).join("")}
      </div>
    </section>
  `;
}

function renderTowerScheduleItem(event) {
  const actualTowerCount = getDrinkTotals(state, event.id).tower || 0;
  const plannedTowers = getDrinkPlansForEvent(state, event.id).filter((plan) => plan.item_type === "tower");
  const plannedTowerCount = plannedTowers.reduce((total, plan) => total + (Number(plan.count) || 0), 0);
  const total = actualTowerCount + plannedTowerCount;
  const towerLimit = DRINK_LIMITS.tower.limit;
  const { level } = getLimitStatus(total, towerLimit);
  const reservations = getReservationsForEvent(state, event.id).filter((reservation) => Number(reservation.tower_count) > 0);
  return `
    <article class="tower-summary-item ${level}">
      <div class="tower-summary-main">
        <div>
          <p class="eyebrow">Tower</p>
          <h3>${formatDateLabel(event.event_date)}</h3>
        </div>
        <span class="capacity ${level}">${total} / ${towerLimit} ${total === 0 ? "空き" : total <= towerLimit ? "予定あり" : `超過 +${total - towerLimit}`}</span>
      </div>
      <div class="tower-counts">
        <span>実予約 <strong>${actualTowerCount}</strong></span>
        <span>事前予定 <strong>${plannedTowerCount}</strong></span>
      </div>
      ${reservations.length || plannedTowers.length ? `
        <ul class="tower-detail-list">
          ${reservations.map((reservation) => renderTowerReservationDetail(reservation)).join("")}
          ${plannedTowers.map((plan) => renderTowerPlanDetail(plan)).join("")}
        </ul>
      ` : `<p class="empty">タワー予定なし</p>`}
    </article>
  `;
}

function renderTowerReservationDetail(reservation) {
  const hostName = findUser(state, reservation.host_user_id)?.display_name || "未選択";
  const slot = `${getTimeSlotLabel(reservation.time_slot)} ${reservation.seat_type} ${reservation.group_no}`;
  const guest = reservation.princess_name ? ` / ${reservation.princess_name}` : "";
  const memo = reservation.memo ? ` / ${reservation.memo}` : "";
  return `<li><span class="inline-pill active">実予約</span><strong>${escapeHtml(slot)}</strong><em>${escapeHtml(hostName)}${escapeHtml(guest)}${escapeHtml(memo)}</em></li>`;
}

function renderTowerPlanDetail(plan) {
  const hostName = findUser(state, plan.host_user_id)?.display_name || "未選択";
  const memo = plan.memo ? ` / ${plan.memo}` : "";
  return `<li><span class="inline-pill muted">事前予定</span><strong>${escapeHtml(getTimeSlotLabel(plan.time_slot))}</strong><em>${escapeHtml(hostName)} / ${Number(plan.count) || 0}本${escapeHtml(memo)}</em></li>`;
}

function renderReservationGrid(eventId, { adminMode = false, locked = false } = {}) {
  const event = findEvent(state, eventId);
  if (!event) return `<div class="empty">イベント日を作成してください。</div>`;
  return TIME_SLOTS.map((timeSlot) => {
    return RESERVATION_SEAT_ORDER.map((seatType) => renderReservationSection(eventId, timeSlot, seatType, adminMode, locked)).join("");
  }).join("");
}

function renderReservationSection(eventId, timeSlot, seatType, adminMode, locked) {
  const key = `${timeSlot}:${seatType}`;
  const count = getSeatLimitStatuses(state, eventId)[key];
  const noIvanColumn = seatType === SEAT_TYPES[0];
  const rows = getGroupLabels(seatType)
    .map((groupNo) => {
      const reservation = findReservationBySlot(state, eventId, timeSlot, seatType, groupNo);
      return renderReservationRow(reservation, { eventId, timeSlot, seatType, groupNo, adminMode, locked, noIvanColumn });
    })
    .join("");
  return `
    <section class="reservation-section">
      <div class="section-title">
        <h3>${getTimeSlotLabel(timeSlot)} ${seatType}</h3>
        <span class="capacity ${count.level}">${count.total} / ${count.limit}${count.level === "full" ? " 満席" : ""}${count.level === "over" ? " 超過" : ""}</span>
      </div>
      <div class="reservation-grid ${noIvanColumn ? "no-ivan-column" : ""}" role="table">
        <div class="grid-head" role="row">
          <span>組数</span><span>担当ホスト</span><span>姫名</span>${noIvanColumn ? "" : "<span>アイバン名</span>"}<span>属性</span>
          <span>P</span><span>R</span><span>B</span><span>G</span><span>タワー</span><span>メモ</span><span>操作</span>
        </div>
        ${rows}
      </div>
    </section>
  `;
}

function renderReservationRow(reservation, context) {
  const disabled = context.locked ? "disabled" : "";
  const data = reservation || {
    id: "",
    host_user_id: "",
    princess_name: "",
    ivan_name: "",
    attribute: "リピ",
    purple_count: 0,
    red_count: 0,
    blue_count: 0,
    green_count: 0,
    tower_count: 0,
    memo: "",
  };
  const warnings = reservation ? getReservationWarnings(state, reservation) : [];
  const rowClass = warnings.length ? "has-warning" : "";
  return `
    <div class="grid-row slot-row ${rowClass}" data-reservation-id="${data.id || ""}" data-event-id="${context.eventId}" data-time-slot="${context.timeSlot}" data-seat-type="${context.seatType}" data-group-no="${context.groupNo}" role="row">
      <div class="grid-cell fixed" data-label="組数"><strong>${context.groupNo}</strong></div>
      <label class="grid-cell" data-label="担当ホスト">
        <select data-field="host_user_id" ${disabled}>
          <option value="">未選択</option>
          ${getActiveUsers(state).map((user) => option(user.id, user.display_name, user.id === data.host_user_id)).join("")}
        </select>
      </label>
      ${textCell("princess_name", "姫名", data.princess_name, disabled)}
      ${context.noIvanColumn ? "" : textCell("ivan_name", "アイバン名", data.ivan_name, disabled)}
      <label class="grid-cell" data-label="属性">
        <select data-field="attribute" ${disabled}>
          ${ATTRIBUTES.map((attribute) => option(attribute, attribute, attribute === data.attribute)).join("")}
        </select>
      </label>
      ${numberCell("purple_count", "P", data.purple_count, disabled)}
      ${numberCell("red_count", "R", data.red_count, disabled)}
      ${numberCell("blue_count", "B", data.blue_count, disabled)}
      ${numberCell("green_count", "G", data.green_count, disabled)}
      <label class="grid-cell" data-label="タワー">
        <select data-field="tower_count" ${disabled}>
          ${option("0", "なし", Number(data.tower_count) === 0)}
          ${option("1", "あり", Number(data.tower_count) > 0)}
        </select>
      </label>
      ${textCell("memo", "メモ", data.memo, disabled)}
      <div class="grid-cell actions" data-label="操作">
        <button class="icon-button save" data-action="save-reservation" type="button" ${disabled}>保存</button>
        <button class="icon-button danger" data-action="delete-reservation" type="button" ${disabled || !data.id ? "disabled" : ""}>削除</button>
      </div>
      ${warnings.length ? `<div class="row-warning">${warnings.map(escapeHtml).join(" / ")}</div>` : ""}
    </div>
  `;
}

function textCell(field, label, value, disabled) {
  return `<label class="grid-cell" data-label="${label}"><input data-field="${field}" value="${escapeAttr(value || "")}" ${disabled}></label>`;
}

function numberCell(field, label, value, disabled) {
  return `<label class="grid-cell compact-input" data-label="${label}"><input data-field="${field}" type="number" min="0" step="1" value="${Number(value) || 0}" ${disabled}></label>`;
}

function renderAdminPage() {
  if (!adminUnlocked) return renderAdminLogin();
  return `
    <section class="admin-layout">
      <aside class="admin-sidebar panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Admin</p>
            <h2>運営画面</h2>
          </div>
        </div>
        <select data-role="event-select" aria-label="対象日">
          ${renderEventOptions(view.eventId)}
        </select>
        <div class="side-nav">
          ${adminTabButton("dashboard", "運営トップ")}
          ${adminTabButton("attendance", "ホスト勤怠")}
          ${adminTabButton("staffAttendance", "内勤勤怠")}
          ${adminTabButton("missing", "未入力者")}
          ${adminTabButton("hosts", "ホスト一覧")}
          ${adminTabButton("staff", "内勤一覧")}
          ${adminTabButton("vacations", "長期休暇")}
          ${adminTabButton("events", "イベント日")}
          ${adminTabButton("reservations", "予約管理")}
          ${adminTabButton("archive", "アーカイブ")}
          ${adminTabButton("totals", "シャンパン集計")}
          ${adminTabButton("discord", "Discord文面")}
          ${adminTabButton("histories", "変更履歴")}
          ${adminTabButton("data", "データ")}
        </div>
        <button class="ghost-button" data-action="admin-logout" type="button">ログアウト</button>
      </aside>
      <div class="admin-content">
        ${renderAdminContent()}
      </div>
    </section>
  `;
}

function renderAdminLogin() {
  return `
    <section class="panel login-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Password</p>
          <h2>運営画面ログイン</h2>
        </div>
      </div>
      <form class="stack" data-action="admin-login">
        <label>
          <span>共通パスワード</span>
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <button class="primary-button" type="submit">運営画面を表示</button>
      </form>
    </section>
  `;
}

function adminTabButton(tab, label) {
  return `<button class="side-button ${view.adminTab === tab ? "is-active" : ""}" data-action="admin-tab" data-tab="${tab}" type="button">${label}</button>`;
}

function renderAdminContent() {
  if (view.adminTab === "attendance") return renderAdminAttendance();
  if (view.adminTab === "staffAttendance") return renderAdminStaffAttendance();
  if (view.adminTab === "missing") return renderAdminMissing();
  if (view.adminTab === "hosts") return renderHostManagement();
  if (view.adminTab === "staff") return renderStaffManagement();
  if (view.adminTab === "vacations") return renderVacationManagement();
  if (view.adminTab === "events") return renderEventManagement();
  if (view.adminTab === "reservations") return renderReservationPage(true);
  if (view.adminTab === "archive") return renderArchive();
  if (view.adminTab === "totals") return renderTotals();
  if (view.adminTab === "discord") return renderDiscordTools();
  if (view.adminTab === "histories") return renderHistories();
  if (view.adminTab === "data") return renderDataTools();
  return renderAdminDashboard();
}

function renderAdminDashboard() {
  const event = findEvent(state, view.eventId);
  const issues = getDashboardIssues(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading wide-heading">
        <div>
          <p class="eyebrow">Dashboard</p>
          <h2>${event ? formatDateLabel(event.event_date) : "運営トップ"}</h2>
        </div>
        ${statusPill(event?.status || "未設定")}
      </div>
      <div class="dashboard-grid">
        <div class="mini-panel">
          <h3>ホスト勤怠</h3>
          ${renderAttendanceSummaryCards(view.eventId, { detailType: "hostAttendance" })}
          ${renderDashboardDetailFor("hostAttendance")}
        </div>
        <div class="mini-panel">
          <h3>内勤勤怠</h3>
          ${renderStaffAttendanceSummaryCards(view.eventId, { detailType: "staffAttendance" })}
          ${renderDashboardDetailFor("staffAttendance")}
        </div>
        <div class="mini-panel">
          <h3>予約枠</h3>
          ${renderSeatStatusList(view.eventId, { detailType: "seat" })}
          ${renderDashboardDetailFor("seat")}
        </div>
        <div class="mini-panel">
          <h3>シャンパン・タワー</h3>
          ${renderDrinkStatusList(view.eventId, { detailType: "drink" })}
          ${renderDashboardDetailFor("drink")}
        </div>
        <div class="mini-panel">
          <h3>確認が必要</h3>
          ${issues.length ? `<ul class="issue-list">${issues.map((issue) => `<li class="${issue.level}">⚠ ${escapeHtml(issue.text)}</li>`).join("")}</ul>` : `<p class="empty">要確認項目はありません。</p>`}
        </div>
      </div>
    </section>
  `;
}

function renderAdminAttendance() {
  const event = findEvent(state, view.eventId);
  const rows = getActiveUsers(state).map((user) => {
    const entry = getAttendanceEntry(state, view.eventId, user.id);
    const vacation = event && isOnVacation(state, user.id, event.event_date);
    return `
      <tr>
        <td>${escapeHtml(user.display_name)}</td>
        <td>${escapeHtml(user.role)}${vacation ? `<span class="inline-pill muted">長期休暇</span>` : ""}</td>
        <td>
          <select data-field="status">
            ${ATTENDANCE_STATUSES.map((status) => option(status, status, status === (entry?.status || "出勤"))).join("")}
          </select>
        </td>
        <td><input data-field="memo" value="${escapeAttr(entry?.memo || "")}"></td>
        <td><button class="icon-button save" data-action="admin-save-attendance" data-user-id="${user.id}" type="button">保存</button></td>
      </tr>
    `;
  }).join("");
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Attendance</p><h2>ホスト勤怠管理</h2></div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>ホスト</th><th>状態</th><th>出欠</th><th>メモ</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderAdminStaffAttendance() {
  const event = findEvent(state, view.eventId);
  const staffMembers = getActiveStaffMembers(state);
  const rows = staffMembers.map((member) => {
    const entry = getStaffAttendanceEntry(state, view.eventId, member.id);
    return `
      <tr>
        <td>${escapeHtml(member.display_name)}</td>
        <td>${escapeHtml(member.staff_type || "内勤")}</td>
        <td>
          <select data-field="status">
            ${STAFF_ATTENDANCE_STATUSES.map((status) => option(status, status, status === (entry?.status || "出勤"))).join("")}
          </select>
        </td>
        <td><input data-field="memo" value="${escapeAttr(entry?.memo || "")}"></td>
        <td><button class="icon-button save" data-action="admin-save-staff-attendance" data-staff-member-id="${member.id}" type="button">保存</button></td>
      </tr>
    `;
  }).join("");
  return `
    <section class="panel page-panel">
      <div class="panel-heading wide-heading">
        <div><p class="eyebrow">Staff Attendance</p><h2>${event ? formatDateLabel(event.event_date) : ""} 内勤勤怠管理</h2></div>
        ${statusPill(event?.status || "未設定")}
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>内勤サマリー</h3>
          ${renderStaffAttendanceSummaryCards(view.eventId)}
        </div>
        <div class="mini-panel">
          <h3>未入力</h3>
          ${renderNameList(getMissingStaffMembers(state, view.eventId), "内勤の未入力者はいません。")}
        </div>
      </div>
      ${staffMembers.length ? `
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>内勤</th><th>区分</th><th>出欠</th><th>メモ</th><th>操作</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      ` : `<p class="empty">内勤スタッフが未登録です。「内勤一覧」から追加してください。</p>`}
    </section>
  `;
}

function renderAdminMissing() {
  const event = findEvent(state, view.eventId);
  const missing = getMissingUsers(state, view.eventId);
  const missingStaff = getMissingStaffMembers(state, view.eventId);
  const exempt = getVacationExemptUsers(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Missing</p><h2>${event ? formatDateLabel(event.event_date) : ""} 未入力者</h2></div>
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>未入力</h3>
          ${renderNameList(missing, "未入力者はいません。")}
        </div>
        <div class="mini-panel">
          <h3>内勤未入力</h3>
          ${renderNameList(missingStaff, "内勤の未入力者はいません。")}
        </div>
        <div class="mini-panel">
          <h3>催促対象外</h3>
          ${renderNameList(exempt, "長期休暇中の対象者はいません。", "長期休暇中")}
        </div>
      </div>
    </section>
  `;
}

function renderHostManagement() {
  const editing = view.editingUserId ? findUser(state, view.editingUserId) : null;
  const users = sortedUsers(state.users);
  const roles = getRoles(state);
  const roleOptions = [...roles];
  if (editing?.role && !roleOptions.some((role) => role.name === editing.role)) {
    const inactiveRole = getRoles(state, true).find((role) => role.name === editing.role);
    roleOptions.push(inactiveRole || { name: editing.role, is_active: false });
  }
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Hosts</p><h2>ホスト一覧管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-user" type="button">新規追加に戻る</button>` : ""}
      </div>
      <form class="form-grid" data-action="save-user">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>ホスト名</span><input name="display_name" value="${escapeAttr(editing?.display_name || "")}" required></label>
        <label><span>読み仮名</span><input name="kana" value="${escapeAttr(editing?.kana || "")}"></label>
        <label><span>ロール</span><select name="role">${roleOptions.map((role) => option(role.name, role.is_active === false ? `${role.name}（無効）` : role.name, role.name === (editing?.role || "ホスト"))).join("")}</select></label>
        <label class="check-label"><input name="is_active" type="checkbox" ${editing?.is_active !== false ? "checked" : ""}> 有効</label>
        <label class="span-2"><span>メモ</span><input name="note" value="${escapeAttr(editing?.note || "")}"></label>
        <button class="primary-button" type="submit">${editing ? "更新する" : "追加する"}</button>
      </form>
      <div class="mini-panel role-manager">
        <h3>ロール管理</h3>
        <form class="role-form" data-action="save-role">
          <label><span>追加するロール名</span><input name="name" placeholder="例: 幹部候補"></label>
          <button class="primary-button" type="submit">ロールを追加</button>
        </form>
        <div class="role-chip-list">
          ${getRoles(state, true).map((role) => `
            <span class="role-chip ${role.is_active === false ? "is-disabled" : ""}">
              ${escapeHtml(role.name)}
              ${role.is_active === false
                ? `<button data-action="enable-role" data-role-name="${escapeAttr(role.name)}" type="button">有効化</button>`
                : `<button data-action="disable-role" data-role-name="${escapeAttr(role.name)}" type="button">無効化</button>`}
            </span>
          `).join("")}
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>ホスト名</th><th>読み</th><th>ロール</th><th>状態</th><th>メモ</th><th>操作</th></tr></thead>
          <tbody>
            ${users.map((user) => `
              <tr>
                <td>${escapeHtml(user.display_name)}</td>
                <td>${escapeHtml(user.kana || "")}</td>
                <td>${escapeHtml(user.role)}</td>
                <td>${user.is_active ? `<span class="inline-pill active">有効</span>` : `<span class="inline-pill muted">無効</span>`}</td>
                <td>${escapeHtml(user.note || "")}</td>
                <td>
                  <div class="row-actions">
                    <button class="icon-button" data-action="edit-user" data-user-id="${user.id}" type="button">編集</button>
                    ${user.is_active
                      ? `<button class="icon-button danger" data-action="disable-user" data-user-id="${user.id}" type="button">無効化</button>`
                      : `<button class="icon-button save" data-action="enable-user" data-user-id="${user.id}" type="button">有効化</button>`}
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderStaffManagement() {
  const editing = view.editingStaffMemberId
    ? state.staff_members.find((member) => member.id === view.editingStaffMemberId)
    : null;
  const staffMembers = sortedStaffMembers(state.staff_members || []);
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Staff</p><h2>内勤一覧管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-staff-member" type="button">新規追加に戻る</button>` : ""}
      </div>
      <form class="form-grid" data-action="save-staff-member">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>内勤名</span><input name="display_name" value="${escapeAttr(editing?.display_name || "")}" required></label>
        <label><span>読み仮名</span><input name="kana" value="${escapeAttr(editing?.kana || "")}"></label>
        <label><span>区分</span><input name="staff_type" value="${escapeAttr(editing?.staff_type || "内勤")}" placeholder="例: 内勤 / 受付 / 会計"></label>
        <label class="check-label"><input name="is_active" type="checkbox" ${editing?.is_active !== false ? "checked" : ""}> 有効</label>
        <label class="span-2"><span>メモ</span><input name="note" value="${escapeAttr(editing?.note || "")}"></label>
        <button class="primary-button" type="submit">${editing ? "更新する" : "追加する"}</button>
      </form>
      <div class="notice muted">ホスト一覧とは別管理です。ここに登録した人だけが「内勤出勤」の対象になります。</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>内勤名</th><th>読み</th><th>区分</th><th>状態</th><th>メモ</th><th>操作</th></tr></thead>
          <tbody>
            ${staffMembers.map((member) => `
              <tr>
                <td>${escapeHtml(member.display_name)}</td>
                <td>${escapeHtml(member.kana || "")}</td>
                <td>${escapeHtml(member.staff_type || "内勤")}</td>
                <td>${member.is_active ? `<span class="inline-pill active">有効</span>` : `<span class="inline-pill muted">無効</span>`}</td>
                <td>${escapeHtml(member.note || "")}</td>
                <td>
                  <div class="row-actions">
                    <button class="icon-button" data-action="edit-staff-member" data-staff-member-id="${member.id}" type="button">編集</button>
                    ${member.is_active
                      ? `<button class="icon-button danger" data-action="disable-staff-member" data-staff-member-id="${member.id}" type="button">無効化</button>`
                      : `<button class="icon-button save" data-action="enable-staff-member" data-staff-member-id="${member.id}" type="button">有効化</button>`}
                  </div>
                </td>
              </tr>
            `).join("") || `<tr><td colspan="6">内勤スタッフは未登録です。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderVacationManagement() {
  const editing = view.editingVacationId
    ? state.long_vacations.find((vacation) => vacation.id === view.editingVacationId)
    : null;
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Vacation</p><h2>長期休暇管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-vacation" type="button">新規追加に戻る</button>` : ""}
      </div>
      <form class="form-grid" data-action="save-vacation">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>対象ホスト</span><select name="user_id">${getActiveUsers(state).map((user) => option(user.id, user.display_name, user.id === editing?.user_id)).join("")}</select></label>
        <label><span>休暇開始日</span><input name="start_date" type="date" value="${editing?.start_date || ""}" required></label>
        <label><span>休暇終了日</span><input name="end_date" type="date" value="${editing?.end_date || ""}" required></label>
        <label class="check-label"><input name="is_active" type="checkbox" ${editing?.is_active !== false ? "checked" : ""}> 有効</label>
        <label class="span-2"><span>理由・メモ</span><input name="reason" value="${escapeAttr(editing?.reason || "")}"></label>
        <button class="primary-button" type="submit">${editing ? "更新する" : "追加する"}</button>
      </form>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>ホスト</th><th>期間</th><th>状態</th><th>理由</th><th>操作</th></tr></thead>
          <tbody>
            ${state.long_vacations.map((vacation) => `
              <tr>
                <td>${escapeHtml(findUser(state, vacation.user_id)?.display_name || "不明")}</td>
                <td>${escapeHtml(vacation.start_date)} - ${escapeHtml(vacation.end_date)}</td>
                <td>${vacation.is_active ? "有効" : "無効"}</td>
                <td>${escapeHtml(vacation.reason || "")}</td>
                <td><button class="icon-button" data-action="edit-vacation" data-vacation-id="${vacation.id}" type="button">編集</button></td>
              </tr>
            `).join("") || `<tr><td colspan="5">長期休暇は未登録です。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderEventManagement() {
  const editing = view.editingEventId ? findEvent(state, view.editingEventId) : null;
  const activeEvents = state.event_dates.filter((event) => !isEventArchived(event));
  const archivedCount = getArchivedEvents(state).length;
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 7);
  const newDate = toLocalDateTimeString(defaultDate).slice(0, 10);
  const eventDate = editing?.event_date || newDate;
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Events</p><h2>イベント日管理</h2></div>
        ${editing ? `<button class="ghost-button" data-action="new-event" type="button">新規追加に戻る</button>` : ""}
      </div>
      <form class="form-grid" data-action="save-event">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label><span>イベント日</span><input name="event_date" type="date" value="${eventDate}" data-role="event-date-input" required></label>
        <label><span>ステータス</span><select name="status">${EVENT_STATUSES.map((status) => option(status, status, status === (editing?.status || "受付中"))).join("")}</select></label>
        <label><span>予約解放日時</span><input name="reservation_open_at" type="datetime-local" value="${editing?.reservation_open_at || getReservationOpenAt(eventDate)}" data-role="reservation-open-input"></label>
        <label class="span-2"><span>メモ</span><input name="note" value="${escapeAttr(editing?.note || "")}"></label>
        <button class="primary-button" type="submit">${editing ? "更新する" : "追加する"}</button>
      </form>
      <div class="notice muted">終了した日付は自動でアーカイブに移動します。過去の予約は「アーカイブ」タブから確認できます。現在のアーカイブ: ${archivedCount}件</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>日付</th><th>ステータス</th><th>予約解放</th><th>メモ</th><th>操作</th></tr></thead>
          <tbody>
            ${activeEvents.map((event) => `
              <tr class="${event.status === "休み" ? "holiday-row" : ""}">
                <td>${formatDateLabel(event.event_date)}</td>
                <td>${statusPill(event.status)}</td>
                <td>${formatDateTime(event.reservation_open_at)}</td>
                <td>${escapeHtml(event.note || "")}</td>
                <td><button class="icon-button" data-action="edit-event" data-event-id="${event.id}" type="button">編集</button></td>
              </tr>
            `).join("") || `<tr><td colspan="5">受付中または休み予定のイベント日はありません。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderArchive() {
  const archivedEvents = getArchivedEvents(state).sort((a, b) => b.event_date.localeCompare(a.event_date));
  if (!archivedEvents.length) {
    return `
      <section class="panel page-panel">
        <div class="panel-heading">
          <div><p class="eyebrow">Archive</p><h2>アーカイブ</h2></div>
        </div>
        <p class="empty">終了済みのイベント日はまだありません。イベント日が終わると自動でここに移動します。</p>
      </section>
    `;
  }
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Archive</p>
          <h2>アーカイブ</h2>
        </div>
      </div>
      <div class="notice muted">終了したイベント日の予約を日付ごとに折りたたんで確認できます。ここでは編集せず、当日の最終予約と集計だけを見返します。</div>
      <div class="archive-list">
        ${archivedEvents.map((event) => renderArchiveItem(event)).join("")}
      </div>
    </section>
  `;
}

function renderArchiveItem(event) {
  const isOpen = view.archiveEventId === event.id;
  const reservations = getReservationsForEvent(state, event.id);
  const deletedReservations = getReservationsForEvent(state, event.id, true).filter((reservation) => reservation.is_deleted);
  return `
    <section class="archive-item ${isOpen ? "is-open" : ""}">
      <button class="archive-toggle" data-action="toggle-archive" data-event-id="${event.id}" type="button" aria-expanded="${isOpen}">
        <span>${formatDateLabel(event.event_date)}</span>
        <strong>予約 ${reservations.length}件</strong>
        <em>${deletedReservations.length ? `削除履歴 ${deletedReservations.length}件` : "削除履歴なし"}</em>
        ${statusPill(event.status)}
      </button>
      ${isOpen ? `
        <div class="archive-body">
          <div class="split">
            <div class="mini-panel">
              <h3>予約枠</h3>
              ${renderSeatStatusList(event.id)}
            </div>
            <div class="mini-panel">
              <h3>シャンパン・タワー</h3>
              ${renderDrinkStatusList(event.id)}
            </div>
          </div>
          ${renderDrinkPlans(event.id, { locked: true })}
          <div class="subsection">
            <h3>予約アーカイブ</h3>
            ${renderReservationGrid(event.id, { adminMode: true, locked: true })}
          </div>
          ${renderDeletedReservations(deletedReservations)}
        </div>
      ` : ""}
    </section>
  `;
}

function renderDeletedReservations(deletedReservations) {
  if (!deletedReservations.length) return "";
  return `
    <div class="subsection">
      <h3>削除済み予約</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>削除日時</th><th>枠</th><th>担当ホスト</th><th>姫名</th><th>メモ</th></tr></thead>
          <tbody>
            ${deletedReservations.map((reservation) => `
              <tr>
                <td>${formatDateTime(reservation.deleted_at)}</td>
                <td>${getTimeSlotLabel(reservation.time_slot)} ${reservation.seat_type} ${reservation.group_no}</td>
                <td>${escapeHtml(findUser(state, reservation.host_user_id)?.display_name || "未選択")}</td>
                <td>${escapeHtml(reservation.princess_name || "")}</td>
                <td>${escapeHtml(reservation.memo || "")}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderTotals() {
  const event = findEvent(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Limits</p><h2>${event ? formatDateLabel(event.event_date) : ""} シャンパン・タワー状況</h2></div>
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>シャンパン・タワー</h3>
          ${renderDrinkStatusList(view.eventId)}
        </div>
        <div class="mini-panel">
          <h3>予約枠</h3>
          ${renderSeatStatusList(view.eventId)}
        </div>
      </div>
    </section>
  `;
}

function renderDiscordTools() {
  const attendanceText = generateAttendanceDiscordText(state, view.eventId);
  const reservationText = generateReservationDiscordText(state, view.eventId);
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Discord</p><h2>Discord文面生成</h2></div>
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>未入力者催促文</h3>
          <textarea class="copy-text" data-copy-source="attendance" rows="10" readonly>${escapeHtml(attendanceText)}</textarea>
          <button class="primary-button" data-action="copy-text" data-source="attendance" type="button">コピー</button>
        </div>
        <div class="mini-panel">
          <h3>予約確認文</h3>
          <textarea class="copy-text" data-copy-source="reservation" rows="10" readonly>${escapeHtml(reservationText)}</textarea>
          <button class="primary-button" data-action="copy-text" data-source="reservation" type="button">コピー</button>
        </div>
      </div>
    </section>
  `;
}

function renderHistories() {
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">History</p><h2>変更履歴</h2></div>
      </div>
      <div class="table-wrap">
        <table class="data-table history-table">
          <thead><tr><th>日時</th><th>対象</th><th>内容</th><th>変更前</th><th>変更後</th></tr></thead>
          <tbody>
            ${state.histories.map((history) => `
              <tr>
                <td>${formatDateTime(history.changed_at)}</td>
                <td>${escapeHtml(history.target_type)}</td>
                <td>${escapeHtml(history.change_note || "")}</td>
                <td><code>${escapeHtml(summarizePayload(history.before_payload))}</code></td>
                <td><code>${escapeHtml(summarizePayload(history.after_payload))}</code></td>
              </tr>
            `).join("") || `<tr><td colspan="5">履歴はまだありません。</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDataTools() {
  return `
    <section class="panel page-panel">
      <div class="panel-heading">
        <div><p class="eyebrow">Data</p><h2>データ管理</h2></div>
      </div>
      <div class="split">
        <div class="mini-panel">
          <h3>バックアップ</h3>
          <p>ブラウザの localStorage に保存されたデータをJSONで書き出します。</p>
          <button class="primary-button" data-action="export-json" type="button">JSONを書き出す</button>
        </div>
        <div class="mini-panel">
          <h3>初期化</h3>
          <p>このブラウザ内のデータを初期状態に戻します。必要な場合だけ実行してください。</p>
          <button class="danger-button" data-action="reset-data" type="button">初期データに戻す</button>
        </div>
      </div>
      <textarea class="copy-text" data-copy-source="export" rows="12" readonly></textarea>
    </section>
  `;
}

function renderDashboardDetail() {
  const { dashboardDetailType: type, dashboardDetailKey: key } = view;
  if (!type || !key) return "";
  if (type === "hostAttendance") return renderHostAttendanceDetail(key);
  if (type === "staffAttendance") return renderStaffAttendanceDetail(key);
  if (type === "seat") return renderSeatDetail(key);
  if (type === "drink") return renderDrinkDetail(key);
  return "";
}

function renderDashboardDetailFor(type) {
  return view.dashboardDetailType === type ? renderDashboardDetail() : "";
}

function renderHostAttendanceDetail(status) {
  const event = findEvent(state, view.eventId);
  const title = `${event ? formatDateLabel(event.event_date) : ""} ホスト勤怠: ${status}`;
  const items = getHostAttendanceDetailItems(status);
  return renderDashboardDetailPanel(title, renderDetailList(items, "対象者はいません。"));
}

function getHostAttendanceDetailItems(status) {
  if (status === "未入力") {
    return getMissingUsers(state, view.eventId).map((user) => ({ title: user.display_name, meta: user.role || "ホスト" }));
  }
  if (status === "長期休暇") {
    return getVacationExemptUsers(state, view.eventId).map((user) => ({ title: user.display_name, meta: "長期休暇中" }));
  }
  return getActiveUsers(state)
    .map((user) => ({ user, entry: getAttendanceEntry(state, view.eventId, user.id) }))
    .filter(({ entry }) => entry?.status === status)
    .map(({ user, entry }) => ({ title: user.display_name, meta: [user.role, entry.memo].filter(Boolean).join(" / ") }));
}

function renderStaffAttendanceDetail(status) {
  const event = findEvent(state, view.eventId);
  const title = `${event ? formatDateLabel(event.event_date) : ""} 内勤勤怠: ${status}`;
  const items = status === "未入力"
    ? getMissingStaffMembers(state, view.eventId).map((member) => ({ title: member.display_name, meta: member.staff_type || "内勤" }))
    : getActiveStaffMembers(state)
      .map((member) => ({ member, entry: getStaffAttendanceEntry(state, view.eventId, member.id) }))
      .filter(({ entry }) => entry?.status === status)
      .map(({ member, entry }) => ({ title: member.display_name, meta: [member.staff_type || "内勤", entry.memo].filter(Boolean).join(" / ") }));
  return renderDashboardDetailPanel(title, renderDetailList(items, "対象者はいません。"));
}

function renderSeatDetail(slotKey) {
  const [timeSlot, seatType] = slotKey.split(":");
  const reservations = getGroupLabels(seatType)
    .map((groupNo) => ({ groupNo, reservation: findReservationBySlot(state, view.eventId, timeSlot, seatType, groupNo) }))
    .filter(({ reservation }) => reservation && isReservationFilled(reservation));
  const emptyGroups = getGroupLabels(seatType)
    .filter((groupNo) => !findReservationBySlot(state, view.eventId, timeSlot, seatType, groupNo));
  const items = reservations.map(({ groupNo, reservation }) => {
    const hostName = findUser(state, reservation.host_user_id)?.display_name || "未選択";
    const drinks = [
      reservation.tower_count ? "タワー" : "",
      reservation.purple_count ? `P${reservation.purple_count}` : "",
      reservation.red_count ? `R${reservation.red_count}` : "",
      reservation.blue_count ? `B${reservation.blue_count}` : "",
      reservation.green_count ? `G${reservation.green_count}` : "",
    ].filter(Boolean).join(" / ");
    return {
      title: `${groupNo} ${hostName}`,
      meta: [reservation.princess_name, reservation.attribute, drinks, reservation.memo].filter(Boolean).join(" / "),
    };
  });
  const body = `
    ${renderDetailList(items, "この枠の予約はまだありません。")}
    <p class="detail-note">空き枠: ${emptyGroups.length ? emptyGroups.join("、") : "なし"}</p>
  `;
  return renderDashboardDetailPanel(`予約枠: ${getTimeSlotLabel(timeSlot)} ${seatType}`, body);
}

function renderDrinkDetail(drinkKey) {
  const item = DRINK_LIMITS[drinkKey];
  if (!item) return "";
  const reservations = getReservationsForEvent(state, view.eventId)
    .filter((reservation) => Number(reservation[drinkKey === "tower" ? "tower_count" : `${drinkKey}_count`]) > 0)
    .map((reservation) => {
      const count = Number(reservation[drinkKey === "tower" ? "tower_count" : `${drinkKey}_count`]) || 0;
      const hostName = findUser(state, reservation.host_user_id)?.display_name || "未選択";
      return {
        title: `実予約 ${count}本`,
        meta: [`${getTimeSlotLabel(reservation.time_slot)} ${reservation.seat_type} ${reservation.group_no}`, hostName, reservation.princess_name, reservation.memo].filter(Boolean).join(" / "),
      };
    });
  const plans = getDrinkPlansForEvent(state, view.eventId)
    .filter((plan) => plan.item_type === drinkKey)
    .map((plan) => ({
      title: `事前予定 ${Number(plan.count) || 0}本`,
      meta: [getTimeSlotLabel(plan.time_slot), findUser(state, plan.host_user_id)?.display_name || "未選択", plan.memo].filter(Boolean).join(" / "),
    }));
  return renderDashboardDetailPanel(`${item.label}の内訳`, renderDetailList([...reservations, ...plans], "登録はまだありません。"));
}

function renderDashboardDetailPanel(title, body) {
  return `
    <section class="dashboard-detail-panel">
      <div class="section-title">
        <h3>${escapeHtml(title)}</h3>
        <button class="icon-button" data-action="dashboard-detail-clear" type="button">閉じる</button>
      </div>
      ${body}
    </section>
  `;
}

function renderDetailList(items, emptyText) {
  if (!items.length) return `<p class="empty">${emptyText}</p>`;
  return `
    <ul class="detail-list">
      ${items.map((item) => `<li><strong>${escapeHtml(item.title)}</strong>${item.meta ? `<span>${escapeHtml(item.meta)}</span>` : ""}</li>`).join("")}
    </ul>
  `;
}

function renderAttendanceSummaryCards(eventId, options = {}) {
  const summary = getAttendanceSummary(state, eventId);
  return `
    <div class="summary-grid">
      ${Object.entries(summary).map(([key, value]) => renderSummaryCard(key, value, options.detailType)).join("")}
    </div>
  `;
}

function renderStaffAttendanceSummaryCards(eventId, options = {}) {
  const summary = getStaffAttendanceSummary(state, eventId);
  return `
    <div class="summary-grid">
      ${Object.entries(summary).map(([key, value]) => renderSummaryCard(key, value, options.detailType)).join("")}
    </div>
  `;
}

function renderSummaryCard(key, value, detailType = "") {
  if (!detailType) {
    return `<div class="summary-card status-${key}"><span>${escapeHtml(key)}</span><strong>${value}</strong></div>`;
  }
  const selected = view.dashboardDetailType === detailType && view.dashboardDetailKey === key;
  const attrs = `data-action="dashboard-detail" data-detail-type="${detailType}" data-detail-key="${escapeAttr(key)}"`;
  return `<button class="summary-card dashboard-trigger status-${key} ${selected ? "is-selected" : ""}" ${attrs} type="button"><span>${escapeHtml(key)}</span><strong>${value}</strong></button>`;
}

function renderSeatStatusList(eventId, options = {}) {
  const statuses = getSeatLimitStatuses(state, eventId);
  return `<ul class="status-list">${Object.entries(statuses)
    .map(([key, item]) => {
      const selected = view.dashboardDetailType === options.detailType && view.dashboardDetailKey === key;
      const attrs = options.detailType
        ? `data-action="dashboard-detail" data-detail-type="${options.detailType}" data-detail-key="${escapeAttr(key)}"`
        : "";
      return `<li class="${item.level} dashboard-list-item ${selected ? "is-selected" : ""}" ${attrs}><span>${key.replace(":", " ")}</span><strong>${item.total} / ${item.limit}</strong><em>${item.text}</em></li>`;
    })
    .join("")}</ul>`;
}

function renderDrinkStatusList(eventId, options = {}) {
  const statuses = getDrinkLimitStatuses(state, eventId);
  return `<ul class="status-list">${Object.entries(statuses)
    .map(([key, item]) => {
      const selected = view.dashboardDetailType === options.detailType && view.dashboardDetailKey === key;
      const attrs = options.detailType
        ? `data-action="dashboard-detail" data-detail-type="${options.detailType}" data-detail-key="${escapeAttr(key)}"`
        : "";
      return `<li class="${item.level} dashboard-list-item ${selected ? "is-selected" : ""}" ${attrs}><span>${item.label}</span><strong>${item.total} / ${item.limit}</strong><em>${item.text}</em></li>`;
    })
    .join("")}</ul>`;
}

function renderNameList(users, emptyText, suffix = "") {
  if (!users.length) return `<p class="empty">${emptyText}</p>`;
  return `<ul class="name-list">${users.map((user) => `<li>${escapeHtml(user.display_name)}${suffix ? `<span>${suffix}</span>` : ""}</li>`).join("")}</ul>`;
}

function renderEventOptions(selectedId) {
  const events = state.event_dates.filter((event) => !isEventArchived(event));
  return events
    .map((event) => option(event.id, `${formatDateLabel(event.event_date)} ${event.status === "休み" ? "休み" : ""}`, event.id === selectedId))
    .join("") || `<option value="">対象日がありません</option>`;
}

function renderArchiveEventOptions(selectedId) {
  const events = getArchivedEvents(state).sort((a, b) => b.event_date.localeCompare(a.event_date));
  return events
    .map((event) => option(event.id, `${formatDateLabel(event.event_date)} ${event.status}`, event.id === selectedId))
    .join("") || `<option value="">アーカイブはまだありません</option>`;
}

function statusPill(status) {
  return `<span class="status-pill status-event-${status}">${escapeHtml(status)}</span>`;
}

function option(value, label, selected = false) {
  return `<option value="${escapeAttr(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "navigate") {
    view.page = button.dataset.page;
    render();
    return;
  }
  if (action === "admin-tab") {
    view.adminTab = button.dataset.tab;
    render();
    return;
  }
  if (action === "reservation-tab") {
    view.reservationTab = button.dataset.tab;
    render();
    return;
  }
  if (action === "dashboard-detail") {
    const same = view.dashboardDetailType === button.dataset.detailType && view.dashboardDetailKey === button.dataset.detailKey;
    view.dashboardDetailType = same ? "" : button.dataset.detailType;
    view.dashboardDetailKey = same ? "" : button.dataset.detailKey;
    render();
    return;
  }
  if (action === "dashboard-detail-clear") {
    view.dashboardDetailType = "";
    view.dashboardDetailKey = "";
    render();
    return;
  }
  if (action === "admin-logout") {
    adminUnlocked = false;
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    render();
    return;
  }
  if (action === "toggle-archive") {
    view.archiveEventId = view.archiveEventId === button.dataset.eventId ? "" : button.dataset.eventId;
    render();
    return;
  }
  if (action === "save-reservation") saveReservationFromRow(button);
  if (action === "delete-reservation") deleteReservationFromRow(button);
  if (action === "delete-drink-plan") deleteDrinkPlanFromButton(button);
  if (action === "admin-save-attendance") saveAdminAttendance(button);
  if (action === "admin-save-staff-attendance") saveAdminStaffAttendance(button);
  if (action === "edit-user") {
    view.editingUserId = button.dataset.userId;
    render();
  }
  if (action === "edit-staff-member") {
    view.editingStaffMemberId = button.dataset.staffMemberId;
    render();
  }
  if (action === "disable-staff-member") {
    disableStaffMemberFromButton(button);
    return;
  }
  if (action === "enable-staff-member") {
    const result = setStaffMemberActive(state, button.dataset.staffMemberId, true);
    applyResult(result, "内勤を有効化しました。");
    return;
  }
  if (action === "disable-user") {
    disableUserFromButton(button);
    return;
  }
  if (action === "enable-user") {
    const result = setUserActive(state, button.dataset.userId, true);
    applyResult(result, "ホストを有効化しました。");
    return;
  }
  if (action === "disable-role") {
    const result = setRoleActive(state, button.dataset.roleName, false);
    applyResult(result, "ロールを無効化しました。");
    return;
  }
  if (action === "enable-role") {
    const result = setRoleActive(state, button.dataset.roleName, true);
    applyResult(result, "ロールを有効化しました。");
    return;
  }
  if (action === "new-user") {
    view.editingUserId = "";
    render();
  }
  if (action === "new-staff-member") {
    view.editingStaffMemberId = "";
    render();
  }
  if (action === "edit-vacation") {
    view.editingVacationId = button.dataset.vacationId;
    render();
  }
  if (action === "new-vacation") {
    view.editingVacationId = "";
    render();
  }
  if (action === "edit-event") {
    view.editingEventId = button.dataset.eventId;
    render();
  }
  if (action === "new-event") {
    view.editingEventId = "";
    render();
  }
  if (action === "copy-text") copyText(button.dataset.source);
  if (action === "export-json") exportJson();
  if (action === "reset-data") resetData();
}

function disableUserFromButton(button) {
  const user = findUser(state, button.dataset.userId);
  if (!user) {
    showToast("対象ホストが見つかりません。", "error");
    return;
  }
  const ok = window.confirm(`${user.display_name} を無効化します。入力候補と未入力判定から外れます。過去の予約履歴には名前が残ります。`);
  if (!ok) return;
  const result = setUserActive(state, user.id, false);
  if (result.ok && view.editingUserId === user.id) view.editingUserId = "";
  applyResult(result, "ホストを無効化しました。");
}

function disableStaffMemberFromButton(button) {
  const staffMember = state.staff_members.find((member) => member.id === button.dataset.staffMemberId);
  if (!staffMember) {
    showToast("対象内勤が見つかりません。", "error");
    return;
  }
  const ok = window.confirm(`${staffMember.display_name} を無効化します。内勤出勤の入力候補と未入力判定から外れます。過去の出勤履歴には名前が残ります。`);
  if (!ok) return;
  const result = setStaffMemberActive(state, staffMember.id, false);
  if (result.ok && view.editingStaffMemberId === staffMember.id) view.editingStaffMemberId = "";
  applyResult(result, "内勤を無効化しました。");
}

function handleSubmit(event) {
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  event.preventDefault();
  const action = form.dataset.action;
  const data = Object.fromEntries(new FormData(form).entries());

  if (action === "save-attendance") {
    const result = upsertAttendance(state, data);
    applyResult(result, "勤怠を保存しました。");
  }
  if (action === "save-bulk-attendance") {
    saveBulkAttendance(form);
    return;
  }
  if (action === "save-staff-attendance") {
    const result = upsertStaffAttendance(state, data);
    applyResult(result, "内勤出勤を保存しました。");
  }
  if (action === "save-bulk-staff-attendance") {
    saveBulkStaffAttendance(form);
    return;
  }
  if (action === "site-login") {
    if (data.password === state.settings.adminPassword) {
      siteUnlocked = true;
      adminUnlocked = true;
      sessionStorage.setItem(SITE_SESSION_KEY, "1");
      sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
      showToast("サイトと運営画面を表示しました。");
      render();
    } else if (data.password === state.settings.sitePassword) {
      siteUnlocked = true;
      sessionStorage.setItem(SITE_SESSION_KEY, "1");
      showToast("サイトを表示しました。");
      render();
    } else {
      showToast("パスワードが違います。", "error");
    }
  }
  if (action === "admin-login") {
    if (data.password === state.settings.adminPassword) {
      adminUnlocked = true;
      sessionStorage.setItem(ADMIN_SESSION_KEY, "1");
      showToast("運営画面を表示しました。");
      render();
    } else {
      showToast("パスワードが違います。", "error");
    }
  }
  if (action === "save-user") {
    const result = upsertUser(state, { ...data, is_active: form.elements.is_active.checked });
    if (result.ok) view.editingUserId = "";
    applyResult(result, "ホスト情報を保存しました。");
  }
  if (action === "save-staff-member") {
    const result = upsertStaffMember(state, { ...data, is_active: form.elements.is_active.checked });
    if (result.ok) view.editingStaffMemberId = "";
    applyResult(result, "内勤情報を保存しました。");
  }
  if (action === "save-role") {
    const result = upsertRole(state, { name: data.name, is_active: true });
    applyResult(result, "ロールを保存しました。");
  }
  if (action === "save-vacation") {
    const result = upsertVacation(state, { ...data, is_active: form.elements.is_active.checked });
    if (result.ok) view.editingVacationId = "";
    applyResult(result, "長期休暇を保存しました。");
  }
  if (action === "save-event") {
    const result = upsertEvent(state, data);
    if (result.ok) {
      view.editingEventId = "";
      view.eventId = result.event.id;
    }
    applyResult(result, "イベント日を保存しました。");
  }
  if (action === "save-drink-plan") {
    const result = upsertDrinkPlan(state, data);
    applyResult(result, "事前予定を保存しました。");
  }
}

function saveBulkAttendance(form) {
  const formData = new FormData(form);
  const userId = String(formData.get("user_id") || "");
  const eventIds = formData.getAll("attendance_event_id").map(String);
  let nextState = state;
  let savedCount = 0;
  const errors = [];
  if (!userId) {
    showToast("ホスト名を選択してください。", "error");
    return;
  }
  view.attendanceUserId = userId;
  for (const eventId of eventIds) {
    const status = formData.get(`status_${eventId}`);
    if (!status) continue;
    const result = upsertAttendance(nextState, {
      event_date_id: eventId,
      user_id: userId,
      status,
      memo: formData.get(`memo_${eventId}`) || "",
    });
    if (!result.ok) {
      errors.push(...(result.errors || ["保存できませんでした。"]));
      continue;
    }
    nextState = result.state;
    savedCount += 1;
  }
  if (errors.length) {
    showToast(errors.join(" / "), "error");
    return;
  }
  if (!savedCount) {
    showToast("出欠を選択してください。", "error");
    return;
  }
  saveState(nextState, `${savedCount}日分の勤怠を保存しました。`);
}

function saveBulkStaffAttendance(form) {
  const formData = new FormData(form);
  const staffMemberId = String(formData.get("staff_member_id") || "");
  const eventIds = formData.getAll("attendance_event_id").map(String);
  let nextState = state;
  let savedCount = 0;
  const errors = [];
  if (!staffMemberId) {
    showToast("内勤名を選択してください。", "error");
    return;
  }
  view.staffAttendanceMemberId = staffMemberId;
  for (const eventId of eventIds) {
    const status = formData.get(`status_${eventId}`);
    if (!status) continue;
    const result = upsertStaffAttendance(nextState, {
      event_date_id: eventId,
      staff_member_id: staffMemberId,
      status,
      memo: formData.get(`memo_${eventId}`) || "",
    });
    if (!result.ok) {
      errors.push(...(result.errors || ["保存できませんでした。"]));
      continue;
    }
    nextState = result.state;
    savedCount += 1;
  }
  if (errors.length) {
    showToast(errors.join(" / "), "error");
    return;
  }
  if (!savedCount) {
    showToast("出欠を選択してください。", "error");
    return;
  }
  saveState(nextState, `${savedCount}日分の内勤出勤を保存しました。`);
}

function handleChange(event) {
  const eventSelect = event.target.closest("[data-role='event-select']");
  if (eventSelect) {
    view.eventId = eventSelect.value;
    render();
    return;
  }
  const archiveEventSelect = event.target.closest("[data-role='archive-event-select']");
  if (archiveEventSelect) {
    view.archiveEventId = archiveEventSelect.value;
    render();
    return;
  }
  const attendanceUser = event.target.closest("[data-role='attendance-user-select']");
  if (attendanceUser) {
    view.attendanceUserId = attendanceUser.value;
    render();
    return;
  }
  const staffAttendanceMember = event.target.closest("[data-role='staff-attendance-member-select']");
  if (staffAttendanceMember) {
    view.staffAttendanceMemberId = staffAttendanceMember.value;
    render();
    return;
  }
  const eventDateInput = event.target.closest("[data-role='event-date-input']");
  if (eventDateInput) {
    const form = eventDateInput.closest("form");
    const openInput = form?.querySelector("[data-role='reservation-open-input']");
    if (openInput && eventDateInput.value) openInput.value = getReservationOpenAt(eventDateInput.value);
  }
}

function saveReservationFromRow(button) {
  const row = button.closest(".slot-row");
  const payload = reservationPayloadFromRow(row);
  const adminMode = view.page === "admin";
  const result = upsertReservation(state, payload, { admin: adminMode });
  applyResult(result, result.warnings?.length ? `予約を保存しました。確認: ${result.warnings.join(" / ")}` : "予約を保存しました。");
}

function deleteReservationFromRow(button) {
  const row = button.closest(".slot-row");
  const reservationId = row.dataset.reservationId;
  if (!reservationId) {
    showToast("削除する予約がありません。", "error");
    return;
  }
  const result = deleteReservation(state, reservationId);
  applyResult(result, "予約を削除しました。");
}

function deleteDrinkPlanFromButton(button) {
  const planId = button.dataset.planId;
  if (!planId) {
    showToast("削除する事前予定がありません。", "error");
    return;
  }
  const ok = window.confirm("この事前予定を削除します。続行しますか？");
  if (!ok) return;
  const result = deleteDrinkPlan(state, planId);
  applyResult(result, "事前予定を削除しました。");
}

function reservationPayloadFromRow(row) {
  const payload = {
    id: row.dataset.reservationId || "",
    event_date_id: row.dataset.eventId,
    time_slot: row.dataset.timeSlot,
    seat_type: row.dataset.seatType,
    group_no: row.dataset.groupNo,
  };
  row.querySelectorAll("[data-field]").forEach((field) => {
    payload[field.dataset.field] = field.value;
  });
  return normalizeReservation(payload);
}

function saveAdminAttendance(button) {
  const tr = button.closest("tr");
  const payload = {
    event_date_id: view.eventId,
    user_id: button.dataset.userId,
    status: tr.querySelector("[data-field='status']").value,
    memo: tr.querySelector("[data-field='memo']").value,
  };
  const result = upsertAttendance(state, payload);
  applyResult(result, "勤怠を保存しました。");
}

function saveAdminStaffAttendance(button) {
  const tr = button.closest("tr");
  const payload = {
    event_date_id: view.eventId,
    staff_member_id: button.dataset.staffMemberId,
    status: tr.querySelector("[data-field='status']").value,
    memo: tr.querySelector("[data-field='memo']").value,
  };
  const result = upsertStaffAttendance(state, payload);
  applyResult(result, "内勤出勤を保存しました。");
}

function applyResult(result, successMessage) {
  if (!result.ok) {
    showToast((result.errors || ["保存できませんでした。"]).join(" / "), "error");
    return;
  }
  saveState(result.state, successMessage);
}

async function copyText(source) {
  const textarea = root.querySelector(`[data-copy-source="${source}"]`);
  if (!textarea) return;
  textarea.select();
  try {
    await navigator.clipboard.writeText(textarea.value);
    showToast("コピーしました。");
  } catch {
    document.execCommand("copy");
    showToast("コピーしました。");
  }
}

function exportJson() {
  const textarea = root.querySelector("[data-copy-source='export']");
  textarea.value = JSON.stringify(state, null, 2);
  textarea.select();
  showToast("JSONを書き出しました。");
}

function resetData() {
  const ok = window.confirm("このブラウザ内のデータを初期化します。続行しますか？");
  if (!ok) return;
  state = buildDefaultState();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  view.eventId = getDefaultEventId();
  showToast("初期データに戻しました。");
  render();
}

function summarizePayload(payload) {
  if (!payload) return "-";
  const copy = clone(payload);
  const keys = [
    "display_name",
    "staff_type",
    "event_date",
    "status",
    "memo",
    "time_slot",
    "seat_type",
    "group_no",
    "host_user_id",
    "item_type",
    "count",
    "princess_name",
    "purple_count",
    "red_count",
    "blue_count",
    "green_count",
    "tower_count",
    "is_deleted",
  ];
  const picked = {};
  for (const key of keys) {
    if (copy[key] !== undefined && copy[key] !== "") picked[key] = copy[key];
  }
  return JSON.stringify(picked);
}

function showToast(message, type = "success") {
  toastRoot.textContent = message;
  toastRoot.className = `toast is-visible ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toastRoot.className = "toast";
  }, 3000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
