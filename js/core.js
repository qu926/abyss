export const ROLES = ["幹部", "ホスト", "体入"];
export const ATTENDANCE_STATUSES = ["出勤", "欠席", "未定", "体入"];
export const STAFF_ATTENDANCE_STATUSES = ["出勤", "欠席", "未定"];
export const EVENT_STATUSES = ["受付中", "終了", "休み"];
export const ATTRIBUTES = ["初回", "リピ", "初回指名", "要確認"];
export const TIME_SLOTS = ["前半", "後半"];
export const REQUEST_TIME_SLOTS = ["前半", "後半", "どちらでも可"];
export const REQUEST_TIME_SLOT_LABELS = {
  [TIME_SLOTS[0]]: "前半希望",
  [TIME_SLOTS[1]]: "後半希望",
  "どちらでも可": "どちらでも可",
};
export const SEAT_TYPES = ["通常席", "アイバン席"];
export const RESERVATION_SEAT_ORDER = [SEAT_TYPES[1], SEAT_TYPES[0]];
export const TIME_SLOT_LABELS = {
  [TIME_SLOTS[0]]: "ワンタイム（前半） 21:50~",
  [TIME_SLOTS[1]]: "ツータイム（後半） 22:40~",
};

export const SLOT_LIMITS = {
  "前半:通常席": 8,
  "後半:通常席": 8,
  "前半:アイバン席": 2,
  "後半:アイバン席": 2,
};

export const DRINK_LIMITS = {
  tower: { label: "タワー", limit: 2 },
  purple: { label: "パープル", limit: 6 },
  red: { label: "レッド", limit: 10 },
  blue: { label: "ブルー", limit: 10 },
  green: { label: "グリーン", limit: 20 },
};
export const DRINK_PLAN_TYPES = Object.entries(DRINK_LIMITS).map(([key, value]) => ({ key, label: value.label }));
export const RESERVATION_REQUEST_HOLD_LIMIT_PER_TIME_SLOT = 3;
export const RESERVATION_REQUEST_NORMAL_CAPACITY_PER_INSTANCE = 8;
export const RESERVATION_REQUEST_IVAN_CAPACITY_PER_INSTANCE = 2;

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const STORAGE_VERSION = 1;

export function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function updatedTime(item) {
  return Date.parse(item?.updated_at || item?.changed_at || item?.created_at || "") || 0;
}

function newerItem(current, candidate) {
  if (!current) return clone(candidate);
  return updatedTime(candidate) >= updatedTime(current) ? clone(candidate) : current;
}

function mergeByKey(remoteItems = [], localItems = [], keyFn) {
  const merged = new Map();
  for (const item of [...(remoteItems || []), ...(localItems || [])]) {
    const key = keyFn(item);
    if (!key) continue;
    merged.set(key, newerItem(merged.get(key), item));
  }
  return [...merged.values()];
}

function mergeHistory(remoteItems = [], localItems = []) {
  return mergeByKey(remoteItems, localItems, (item) => item.id || `${item.target_type}:${item.target_id}:${item.changed_at}:${item.change_note}`)
    .sort((a, b) => String(b.changed_at || "").localeCompare(String(a.changed_at || "")))
    .slice(0, 300);
}

export function mergeSharedState(remoteState, localState) {
  const remote = clone(remoteState || {});
  const local = clone(localState || {});
  const merged = {
    ...remote,
    ...local,
    settings: { ...(remote.settings || {}), ...(local.settings || {}) },
    meta: {
      ...(remote.meta || {}),
      ...(local.meta || {}),
      updated_at: updatedTime(local.meta) >= updatedTime(remote.meta) ? local.meta?.updated_at : remote.meta?.updated_at,
    },
  };

  merged.users = mergeByKey(remote.users, local.users, (item) => item.id);
  merged.roles = mergeByKey(remote.roles, local.roles, (item) => item.id || item.name);
  merged.staff_members = mergeByKey(remote.staff_members, local.staff_members, (item) => item.id);
  merged.long_vacations = mergeByKey(remote.long_vacations, local.long_vacations, (item) => item.id);
  merged.event_dates = mergeByKey(remote.event_dates, local.event_dates, (item) => item.id || item.event_date);
  merged.attendance_entries = mergeByKey(remote.attendance_entries, local.attendance_entries, (item) => {
    return item.event_date_id && item.user_id ? `${item.event_date_id}:${item.user_id}` : item.id;
  });
  merged.staff_attendance_entries = mergeByKey(remote.staff_attendance_entries, local.staff_attendance_entries, (item) => {
    return item.event_date_id && item.staff_member_id ? `${item.event_date_id}:${item.staff_member_id}` : item.id;
  });
  merged.reservations = mergeByKey(remote.reservations, local.reservations, (item) => {
    return item.event_date_id && item.time_slot && item.seat_type && item.group_no
      ? `${item.event_date_id}:${item.time_slot}:${item.seat_type}:${item.group_no}`
      : item.id;
  });
  merged.reservation_settings = mergeByKey(remote.reservation_settings, local.reservation_settings, (item) => item.event_date_id || item.id);
  merged.reservation_requests = mergeByKey(remote.reservation_requests, local.reservation_requests, (item) => item.id);
  merged.drink_plans = mergeByKey(remote.drink_plans, local.drink_plans, (item) => item.id);
  merged.histories = mergeHistory(remote.histories, local.histories);
  return merged;
}

export function todayString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function formatDateLabel(dateString) {
  const date = toDate(dateString);
  return `${date.getMonth() + 1}/${date.getDate()}（${WEEKDAYS[date.getDay()]}）`;
}

export function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} ${hh}:${mm}`;
}

export function getReservationOpenAt(eventDate) {
  return getWednesdayReservationOpenAt(eventDate);
}

export function getReservationRequestOpenAt(eventDate) {
  return getWednesdayReservationOpenAt(eventDate);
}

function getWednesdayReservationOpenAt(eventDate) {
  const date = toDate(eventDate);
  const daysSinceWednesday = (date.getDay() - 3 + 7) % 7;
  date.setDate(date.getDate() - daysSinceWednesday);
  date.setHours(22, 0, 0, 0);
  return toLocalDateTimeString(date);
}

export function toLocalDateTimeString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

export function getEventEndAt(eventDate) {
  const date = toDate(eventDate);
  date.setHours(23, 59, 59, 999);
  return date;
}

export function isEventArchived(event, now = new Date()) {
  if (!event) return false;
  if (event.status === "終了") return true;
  return getEventEndAt(event.event_date).getTime() < new Date(now).getTime();
}

export function getActiveEvents(state, now = new Date()) {
  return state.event_dates.filter((event) => !isEventArchived(event, now));
}

export function getArchivedEvents(state, now = new Date()) {
  return state.event_dates.filter((event) => isEventArchived(event, now));
}

export function archiveFinishedEvents(state, now = new Date()) {
  const draft = clone(state);
  const stamp = new Date(now).toISOString();
  let changed = false;
  for (const event of draft.event_dates) {
    if (event.status !== "受付中") continue;
    if (!isEventArchived(event, now)) continue;
    const before = clone(event);
    event.status = "終了";
    event.updated_at = stamp;
    pushHistory(draft, "event", event.id, before, clone(event), stamp, "イベント日を自動アーカイブ");
    changed = true;
  }
  if (changed) touch(draft, stamp);
  return { state: changed ? draft : state, changed };
}

export function buildDefaultState(baseDate = new Date()) {
  const now = new Date(baseDate);
  const stamp = now.toISOString();
  return {
    meta: { version: STORAGE_VERSION, created_at: stamp, updated_at: stamp },
    settings: { sitePassword: "abyss", adminPassword: "abyss2026" },
    users: [
      makeUser("u_kai", "魁白兎", "かいはくと", "幹部", stamp),
      makeUser("u_daito", "大都", "だいと", "ホスト", stamp),
      makeUser("u_suito", "夜空翠斗", "よぞらすいと", "ホスト", stamp),
      makeUser("u_sendo", "千堂", "せんどう", "ホスト", stamp),
      makeUser("u_mira", "美蘭", "みら", "ホスト", stamp),
      makeUser("u_trial", "体入ゲスト", "たいにゅうげすと", "体入", stamp),
    ],
    roles: ROLES.map((name) => makeRole(`role_${name}`, name, stamp)),
    staff_members: [],
    long_vacations: [],
    event_dates: buildEventDates(now, stamp),
    attendance_entries: [],
    staff_attendance_entries: [],
    reservations: [],
    reservation_settings: [],
    reservation_requests: [],
    drink_plans: [],
    histories: [],
  };
}

function makeRole(id, name, stamp) {
  return {
    id,
    name,
    is_active: true,
    created_at: stamp,
    updated_at: stamp,
  };
}

function makeUser(id, display_name, kana, role, stamp) {
  return {
    id,
    display_name,
    kana,
    role,
    is_active: true,
    note: "",
    created_at: stamp,
    updated_at: stamp,
  };
}

export function buildEventDates(baseDate, stamp = new Date().toISOString()) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month + 3, 0);
  const events = [];
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const day = cur.getDay();
    if (day !== 5 && day !== 6) continue;
    const event_date = todayString(cur);
    const isFirstFriday = day === 5 && cur.getDate() <= 7;
    const isFirstSaturday = day === 6 && cur.getDate() <= 7;
    const status = isFirstFriday || isFirstSaturday ? "休み" : "受付中";
    events.push({
      id: `ev_${event_date.replaceAll("-", "")}`,
      event_date,
      label: formatDateLabel(event_date),
      status,
      reservation_open_at: getReservationOpenAt(event_date),
      note: status === "休み" ? "月1回の休み候補。必要に応じて変更してください。" : "",
      created_at: stamp,
      updated_at: stamp,
    });
  }
  return events;
}

export function sortedUsers(users) {
  return [...users].sort((a, b) => {
    const kana = (a.kana || "").localeCompare(b.kana || "", "ja");
    return kana || (a.display_name || "").localeCompare(b.display_name || "", "ja");
  });
}

export function getActiveUsers(state) {
  return sortedUsers(state.users.filter((user) => user.is_active));
}

export function sortedStaffMembers(staffMembers) {
  return [...staffMembers].sort((a, b) => {
    const type = (a.staff_type || "").localeCompare(b.staff_type || "", "ja");
    if (type) return type;
    const kana = (a.kana || "").localeCompare(b.kana || "", "ja");
    return kana || (a.display_name || "").localeCompare(b.display_name || "", "ja");
  });
}

export function getActiveStaffMembers(state) {
  return sortedStaffMembers((state.staff_members || []).filter((member) => member.is_active));
}

export function getRoles(state, includeInactive = false) {
  const roleNames = [...ROLES, ...(state.roles || []).map((role) => role.name), ...(state.users || []).map((user) => user.role)]
    .map((name) => String(name || "").trim())
    .filter(Boolean);
  const unique = [...new Set(roleNames)];
  return unique
    .map((name) => {
      const existing = (state.roles || []).find((role) => role.name === name);
      return existing || { id: `role_${name}`, name, is_active: true };
    })
    .filter((role) => includeInactive || role.is_active !== false);
}

export function findEvent(state, eventId) {
  return state.event_dates.find((event) => event.id === eventId) || null;
}

export function findUser(state, userId) {
  return state.users.find((user) => user.id === userId) || null;
}

export function findStaffMember(state, staffMemberId) {
  return (state.staff_members || []).find((member) => member.id === staffMemberId) || null;
}

function isStaffReservationPerson(state, personId) {
  return Boolean(personId && findStaffMember(state, personId));
}

export function isOnVacation(state, userId, eventDate) {
  return state.long_vacations.some((vacation) => {
    return (
      vacation.user_id === userId &&
      vacation.is_active &&
      vacation.start_date <= eventDate &&
      vacation.end_date >= eventDate
    );
  });
}

export function getVacationExemptUsers(state, eventId) {
  const event = findEvent(state, eventId);
  if (!event || event.status === "休み") return [];
  return getActiveUsers(state).filter((user) => isOnVacation(state, user.id, event.event_date));
}

export function getAttendanceEntry(state, eventId, userId) {
  return state.attendance_entries.find((entry) => {
    return entry.event_date_id === eventId && entry.user_id === userId && !entry.is_deleted;
  }) || null;
}

export function getAttendanceEntriesForEvent(state, eventId) {
  return state.attendance_entries.filter((entry) => entry.event_date_id === eventId && !entry.is_deleted);
}

export function getMissingUsers(state, eventId) {
  const event = findEvent(state, eventId);
  if (!event || event.status === "休み") return [];
  return getActiveUsers(state).filter((user) => {
    if (isOnVacation(state, user.id, event.event_date)) return false;
    return !getAttendanceEntry(state, eventId, user.id);
  });
}

export function getAttendanceSummary(state, eventId) {
  const event = findEvent(state, eventId);
  const summary = { 出勤: 0, 欠席: 0, 未定: 0, 体入: 0, 未入力: 0, 長期休暇: 0 };
  if (!event || event.status === "休み") return summary;
  for (const user of getActiveUsers(state)) {
    if (isOnVacation(state, user.id, event.event_date)) {
      summary.長期休暇 += 1;
      continue;
    }
    const entry = getAttendanceEntry(state, eventId, user.id);
    if (!entry) {
      summary.未入力 += 1;
      continue;
    }
    summary[entry.status] = (summary[entry.status] || 0) + 1;
  }
  return summary;
}

export function getStaffAttendanceEntry(state, eventId, staffMemberId) {
  return (state.staff_attendance_entries || []).find((entry) => {
    return entry.event_date_id === eventId && entry.staff_member_id === staffMemberId && !entry.is_deleted;
  }) || null;
}

export function getStaffAttendanceEntriesForEvent(state, eventId) {
  return (state.staff_attendance_entries || []).filter((entry) => entry.event_date_id === eventId && !entry.is_deleted);
}

export function getMissingStaffMembers(state, eventId) {
  const event = findEvent(state, eventId);
  if (!event || event.status === "休み") return [];
  return getActiveStaffMembers(state).filter((member) => !getStaffAttendanceEntry(state, eventId, member.id));
}

export function getStaffAttendanceSummary(state, eventId) {
  const event = findEvent(state, eventId);
  const summary = { 出勤: 0, 欠席: 0, 未定: 0, 未入力: 0 };
  if (!event || event.status === "休み") return summary;
  for (const member of getActiveStaffMembers(state)) {
    const entry = getStaffAttendanceEntry(state, eventId, member.id);
    if (!entry) {
      summary.未入力 += 1;
      continue;
    }
    summary[entry.status] = (summary[entry.status] || 0) + 1;
  }
  return summary;
}

export function normalizeAttendance(input) {
  return {
    event_date_id: input.event_date_id,
    user_id: input.user_id,
    status: ATTENDANCE_STATUSES.includes(input.status) ? input.status : "未定",
    memo: input.memo || "",
  };
}

export function normalizeStaffAttendance(input) {
  return {
    event_date_id: input.event_date_id,
    staff_member_id: input.staff_member_id,
    status: STAFF_ATTENDANCE_STATUSES.includes(input.status) ? input.status : "未定",
    memo: input.memo || "",
  };
}

export function upsertAttendance(state, input, now = new Date()) {
  const draft = clone(state);
  const payload = normalizeAttendance(input);
  const event = findEvent(draft, payload.event_date_id);
  if (!event || event.status === "休み") {
    return { state, ok: false, errors: ["休み日は勤怠入力対象外です。"] };
  }
  const stamp = new Date(now).toISOString();
  const existing = getAttendanceEntry(draft, payload.event_date_id, payload.user_id);
  const before = existing ? clone(existing) : null;
  const after = {
    ...(existing || {
      id: createId("att"),
      event_date_id: payload.event_date_id,
      user_id: payload.user_id,
      created_at: stamp,
      deleted_at: null,
      is_deleted: false,
    }),
    status: payload.status,
    memo: payload.memo,
    updated_at: stamp,
  };
  if (existing) {
    Object.assign(existing, after);
  } else {
    draft.attendance_entries.push(after);
  }
  pushHistory(draft, "attendance", after.id, before, after, stamp, before ? "勤怠を更新" : "勤怠を登録");
  touch(draft, stamp);
  return { state: draft, ok: true, entry: after, errors: [] };
}

export function upsertStaffAttendance(state, input, now = new Date()) {
  const draft = clone(state);
  draft.staff_attendance_entries ||= [];
  const payload = normalizeStaffAttendance(input);
  const event = findEvent(draft, payload.event_date_id);
  if (!event || event.status === "休み") {
    return { state, ok: false, errors: ["休み日は内勤出勤入力対象外です。"] };
  }
  const staffMember = findStaffMember(draft, payload.staff_member_id);
  if (!staffMember) return { state, ok: false, errors: ["対象内勤が見つかりません。"] };
  const stamp = new Date(now).toISOString();
  const existing = getStaffAttendanceEntry(draft, payload.event_date_id, payload.staff_member_id);
  const before = existing ? clone(existing) : null;
  const after = {
    ...(existing || {
      id: createId("staff_att"),
      event_date_id: payload.event_date_id,
      staff_member_id: payload.staff_member_id,
      created_at: stamp,
      deleted_at: null,
      is_deleted: false,
    }),
    status: payload.status,
    memo: payload.memo,
    updated_at: stamp,
  };
  if (existing) Object.assign(existing, after);
  else draft.staff_attendance_entries.push(after);
  pushHistory(draft, "staff_attendance", after.id, before, after, stamp, before ? "内勤出勤を更新" : "内勤出勤を登録");
  touch(draft, stamp);
  return { state: draft, ok: true, entry: after, errors: [] };
}

export function getSlotKey(timeSlot, seatType) {
  return `${timeSlot}:${seatType}`;
}

export function getTimeSlotLabel(timeSlot) {
  return TIME_SLOT_LABELS[timeSlot] || timeSlot;
}

export function getGroupLabels(seatType) {
  if (seatType === "アイバン席") return ["A1", "A2"];
  return Array.from({ length: 8 }, (_, index) => String(index + 1));
}

export function isValidSlot(timeSlot, seatType, groupNo) {
  if (!TIME_SLOTS.includes(timeSlot) || !SEAT_TYPES.includes(seatType)) return false;
  return getGroupLabels(seatType).includes(String(groupNo));
}

export function getReservationsForEvent(state, eventId, includeDeleted = false) {
  return state.reservations.filter((reservation) => {
    return String(reservation.event_date_id) === String(eventId) && (includeDeleted || !reservation.is_deleted);
  });
}

export function findReservationBySlot(state, eventId, timeSlot, seatType, groupNo) {
  return state.reservations.find((reservation) => {
    return (
      String(reservation.event_date_id) === String(eventId) &&
      reservation.time_slot === timeSlot &&
      reservation.seat_type === seatType &&
      String(reservation.group_no) === String(groupNo) &&
      !reservation.is_deleted
    );
  }) || null;
}

export function normalizeReservation(input) {
  return {
    id: input.id || null,
    event_date_id: input.event_date_id,
    time_slot: input.time_slot,
    seat_type: input.seat_type,
    group_no: String(input.group_no),
    host_user_id: input.host_user_id || "",
    princess_name: (input.princess_name || "").trim(),
    ivan_name: (input.ivan_name || "").trim(),
    attribute: ATTRIBUTES.includes(input.attribute) ? input.attribute : "要確認",
    ivan_attribute: ATTRIBUTES.includes(input.ivan_attribute)
      ? input.ivan_attribute
      : ATTRIBUTES.includes(input.attribute)
        ? input.attribute
        : "要確認",
    purple_count: toCount(input.purple_count),
    red_count: toCount(input.red_count),
    blue_count: toCount(input.blue_count),
    green_count: toCount(input.green_count),
    tower_count: toCount(input.tower_count) > 0 ? 1 : 0,
    memo: input.memo || "",
  };
}

function toCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

export function isReservationFilled(reservation) {
  if (!reservation) return false;
  return Boolean(
    reservation.host_user_id ||
    reservation.princess_name ||
    reservation.ivan_name ||
    reservation.purple_count ||
    reservation.red_count ||
    reservation.blue_count ||
    reservation.green_count ||
    reservation.tower_count ||
    reservation.memo
  );
}

export function getReservationSaveConflict(state, input) {
  const payload = normalizeReservation(input);
  const existing = findReservationBySlot(
    state,
    payload.event_date_id,
    payload.time_slot,
    payload.seat_type,
    payload.group_no,
  );
  if (!existing || !isReservationFilled(existing)) return null;
  if (!payload.id || String(existing.id) !== String(payload.id)) {
    return { type: "occupied", reservation: existing };
  }
  const baseUpdatedAt = input.base_updated_at || "";
  if (baseUpdatedAt && existing.updated_at && String(existing.updated_at) !== String(baseUpdatedAt)) {
    return { type: "stale", reservation: existing };
  }
  return null;
}

export function isReservationOpen(event, now = new Date()) {
  if (!event || event.status === "休み") return false;
  return new Date(now).getTime() >= new Date(event.reservation_open_at).getTime();
}

export function isReservationRequestOpen(event, now = new Date()) {
  if (!event || event.status === EVENT_STATUSES[2]) return false;
  return new Date(now).getTime() >= new Date(getReservationRequestOpenAt(event.event_date)).getTime();
}

export function isAfterEventCutoff(event, now = new Date()) {
  if (!event) return false;
  const current = new Date(now);
  const cutoff = toDate(event.event_date);
  cutoff.setHours(17, 0, 0, 0);
  return todayString(current) === event.event_date && current.getTime() > cutoff.getTime();
}

export function wasReservationChangedAfterEventCutoff(event, reservation) {
  if (!event || !reservation?.late_warning) return false;
  const changedAt = reservation.updated_at || reservation.created_at;
  if (!changedAt) return false;
  return isAfterEventCutoff(event, new Date(changedAt));
}

export function upsertReservation(state, input, options = {}) {
  const draft = clone(state);
  const payload = normalizeReservation(input);
  if (isStaffReservationPerson(draft, payload.host_user_id)) {
    payload.attribute = "初回";
    payload.ivan_attribute = "初回";
  }
  const now = options.now ? new Date(options.now) : new Date();
  const stamp = now.toISOString();
  const event = findEvent(draft, payload.event_date_id);
  const errors = validateReservationPayload(draft, payload, options);
  if (!event) errors.push("イベント日が見つかりません。");
  if (event && event.status === "休み") errors.push("休み日は予約入力対象外です。");
  if (event && !options.admin && !isReservationOpen(event, now)) {
    errors.push("この日の予約入力は対象週の水曜22:00から開始されます。");
  }
  if (!isReservationFilled(payload)) errors.push("保存する予約内容がありません。");
  if (errors.length) return { state, ok: false, errors, warnings: [] };

  const existingById = payload.id
    ? draft.reservations.find((reservation) => String(reservation.id) === String(payload.id) && !reservation.is_deleted)
    : null;
  const existingBySlot = findReservationBySlot(
    draft,
    payload.event_date_id,
    payload.time_slot,
    payload.seat_type,
    payload.group_no,
  );
  const existing = existingById || existingBySlot;
  const before = existing ? clone(existing) : null;
  const reservationId = existing?.id || payload.id || createId("res");
  const lateWarning = isAfterEventCutoff(event, now) && isMeaningfulReservationChange(before, payload);
  const existingLateWarning = wasReservationChangedAfterEventCutoff(event, existing);
  const after = {
    ...(existing || {
      event_date_id: payload.event_date_id,
      created_at: stamp,
      deleted_at: null,
      is_deleted: false,
    }),
    ...payload,
    id: reservationId,
    late_warning: Boolean(lateWarning || existingLateWarning),
    updated_at: stamp,
  };
  if (existing) {
    Object.assign(existing, after);
  } else {
    draft.reservations.push(after);
  }
  pushHistory(draft, "reservation", after.id, before, after, stamp, before ? "予約を編集" : "予約を登録");
  touch(draft, stamp);
  return {
    state: draft,
    ok: true,
    reservation: after,
    warnings: getReservationWarnings(draft, after),
    errors: [],
  };
}

export function deleteReservation(state, reservationId, now = new Date()) {
  const draft = clone(state);
  const stamp = new Date(now).toISOString();
  const reservation = draft.reservations.find((item) => String(item.id) === String(reservationId) && !item.is_deleted);
  if (!reservation) return { state, ok: false, errors: ["削除対象の予約が見つかりません。"] };
  const before = clone(reservation);
  reservation.is_deleted = true;
  reservation.deleted_at = stamp;
  reservation.updated_at = stamp;
  pushHistory(draft, "reservation", reservation.id, before, clone(reservation), stamp, "予約を削除");
  touch(draft, stamp);
  return { state: draft, ok: true, errors: [] };
}

export function getReservationSetting(state, eventId) {
  const setting = (state.reservation_settings || []).find((item) => String(item.event_date_id) === String(eventId));
  const instanceCount = Number(setting?.instance_count) === 2 ? 2 : 1;
  const defaultNormalCapacity = instanceCount * RESERVATION_REQUEST_NORMAL_CAPACITY_PER_INSTANCE;
  return {
    id: setting?.id || `request_setting_${eventId}`,
    event_date_id: eventId,
    instance_count: instanceCount,
    normal_capacity_front: instanceCount === 2 ? toRequestCapacity(setting?.normal_capacity_front, defaultNormalCapacity) : defaultNormalCapacity,
    normal_capacity_back: instanceCount === 2 ? toRequestCapacity(setting?.normal_capacity_back, defaultNormalCapacity) : defaultNormalCapacity,
    created_at: setting?.created_at || null,
    updated_at: setting?.updated_at || null,
  };
}

function toRequestCapacity(value, fallback) {
  const count = Number(value);
  if (!Number.isFinite(count)) return fallback;
  return Math.max(0, Math.min(99, Math.floor(count)));
}

export function getReservationRequestNormalCapacity(state, eventId, timeSlot) {
  const setting = getReservationSetting(state, eventId);
  if (timeSlot === TIME_SLOTS[0]) return setting.normal_capacity_front;
  if (timeSlot === TIME_SLOTS[1]) return setting.normal_capacity_back;
  return 0;
}

export function getReservationRequestIvanCapacity(state, eventId, timeSlot) {
  if (!TIME_SLOTS.includes(timeSlot)) return 0;
  return getReservationSetting(state, eventId).instance_count * RESERVATION_REQUEST_IVAN_CAPACITY_PER_INSTANCE;
}

export function getReservationRequestCapacity(state, eventId, timeSlot) {
  if (!TIME_SLOTS.includes(timeSlot)) return 0;
  return getReservationRequestNormalCapacity(state, eventId, timeSlot) + getReservationRequestIvanCapacity(state, eventId, timeSlot);
}

export function getReservationRequestTotalCapacity(state, eventId) {
  return TIME_SLOTS.reduce((total, slot) => total + getReservationRequestCapacity(state, eventId, slot), 0);
}

export function getReservationRequestAcceptanceStatus(state, eventId) {
  const total = getReservationRequestsForEvent(state, eventId).length;
  const reservationCapacity = getReservationRequestTotalCapacity(state, eventId);
  const buckets = getReservationRequestBuckets(state, eventId);
  const holdCapacityByTimeSlot = Object.fromEntries(TIME_SLOTS.map((slot) => [slot, RESERVATION_REQUEST_HOLD_LIMIT_PER_TIME_SLOT]));
  const holdUsedByTimeSlot = Object.fromEntries(TIME_SLOTS.map((slot) => {
    const bucket = buckets[slot];
    return [slot, bucket.normal.hold.length + bucket.ivan.hold.length];
  }));
  const holdUsed = TIME_SLOTS.reduce((sum, slot) => {
    return sum + holdUsedByTimeSlot[slot];
  }, 0);
  const holdCapacity = TIME_SLOTS.length * RESERVATION_REQUEST_HOLD_LIMIT_PER_TIME_SLOT;
  const capacity = reservationCapacity + holdCapacity;
  return {
    total,
    reservationCapacity,
    holdCapacity,
    holdCapacityByTimeSlot,
    holdUsed,
    holdUsedByTimeSlot,
    capacity,
    remaining: TIME_SLOTS.reduce((sum, slot) => {
      return sum + Math.max(0, holdCapacityByTimeSlot[slot] - holdUsedByTimeSlot[slot]);
    }, 0),
    closed: TIME_SLOTS.every((slot) => holdCapacityByTimeSlot[slot] > 0 && holdUsedByTimeSlot[slot] >= holdCapacityByTimeSlot[slot]),
  };
}

export function getAllowedRequestTimeSlots(state, eventId) {
  return TIME_SLOTS;
}

export function upsertReservationSetting(state, input, now = new Date()) {
  const draft = clone(state);
  draft.reservation_settings ||= [];
  const stamp = new Date(now).toISOString();
  const eventId = input.event_date_id;
  const event = findEvent(draft, eventId);
  const errors = [];
  if (!event) errors.push("イベント日が見つかりません。");
  const instanceCount = Number(input.instance_count) === 2 ? 2 : 1;
  const defaultNormalCapacity = instanceCount * RESERVATION_REQUEST_NORMAL_CAPACITY_PER_INSTANCE;
  const normalCapacityFront = instanceCount === 2 ? toRequestCapacity(input.normal_capacity_front, defaultNormalCapacity) : defaultNormalCapacity;
  const normalCapacityBack = instanceCount === 2 ? toRequestCapacity(input.normal_capacity_back, defaultNormalCapacity) : defaultNormalCapacity;
  if (errors.length) return { state, ok: false, errors };
  const existing = draft.reservation_settings.find((item) => String(item.event_date_id) === String(eventId));
  const before = existing ? clone(existing) : null;
  const after = {
    ...(existing || {
      id: createId("request_setting"),
      event_date_id: eventId,
      created_at: stamp,
    }),
    instance_count: instanceCount,
    normal_capacity_front: normalCapacityFront,
    normal_capacity_back: normalCapacityBack,
    updated_at: stamp,
  };
  if (existing) Object.assign(existing, after);
  else draft.reservation_settings.push(after);
  pushHistory(draft, "reservation_setting", after.id, before, after, stamp, "予約受付設定を変更");
  touch(draft, stamp);
  return { state: draft, ok: true, setting: after, errors: [] };
}

export function getReservationRequestsForEvent(state, eventId, { includeDeleted = false } = {}) {
  return (state.reservation_requests || [])
    .filter((request) => String(request.event_date_id) === String(eventId) && (includeDeleted || !request.is_deleted))
    .sort(compareReservationRequests);
}

function compareReservationRequests(a, b) {
  const created = String(a.created_at || "").localeCompare(String(b.created_at || ""));
  if (created) return created;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

export function normalizeReservationRequest(state, input) {
  const eventId = input.event_date_id;
  const allowedTimeSlots = getAllowedRequestTimeSlots(state, eventId);
  const desiredTimeSlot = allowedTimeSlots.includes(input.desired_time_slot) ? input.desired_time_slot : allowedTimeSlots[0];
  const staffReservation = isStaffReservationPerson(state, input.host_user_id);
  return {
    id: input.id || null,
    event_date_id: eventId,
    host_user_id: input.host_user_id || "",
    desired_time_slot: desiredTimeSlot,
    no_same_time_double_booking: false,
    princess_name: (input.princess_name || "").trim(),
    attribute: staffReservation ? "初回" : ATTRIBUTES.includes(input.attribute) ? input.attribute : "要確認",
    ivan_name: (input.ivan_name || "").trim(),
    ivan_attribute: staffReservation ? "初回" : ATTRIBUTES.includes(input.ivan_attribute) ? input.ivan_attribute : "要確認",
    purple_count: toCount(input.purple_count),
    red_count: toCount(input.red_count),
    blue_count: toCount(input.blue_count),
    green_count: toCount(input.green_count),
    tower_count: toCount(input.tower_count) > 0 ? 1 : 0,
    memo: input.memo || "",
  };
}

export function isReservationRequestFilled(request) {
  if (!request) return false;
  return Boolean(
    request.host_user_id ||
    request.princess_name ||
    request.ivan_name ||
    request.purple_count ||
    request.red_count ||
    request.blue_count ||
    request.green_count ||
    request.tower_count ||
    request.memo
  );
}

export function upsertReservationRequest(state, input, options = {}) {
  const draft = clone(state);
  draft.reservation_requests ||= [];
  const stamp = new Date(options.now || new Date()).toISOString();
  const payload = normalizeReservationRequest(draft, input);
  const event = findEvent(draft, payload.event_date_id);
  const errors = [];
  if (!event) errors.push("イベント日が見つかりません。");
  if (event && event.status === "休み") errors.push("休み日は予約受付対象外です。");
  if (event && !options.admin && !isReservationRequestOpen(event, new Date(stamp))) {
    errors.push("この日の予約入力は解放前です。");
  }
  const existing = payload.id ? draft.reservation_requests.find((request) => String(request.id) === String(payload.id) && !request.is_deleted) : null;
  const acceptance = getReservationRequestAcceptanceStatus(draft, payload.event_date_id);
  if (!existing && !options.admin && acceptance.closed) {
    errors.push("受付上限に達しているため、予約受付は締め切られています。");
  }
  if (!existing && !options.admin && payload.desired_time_slot) {
    const buckets = getReservationRequestBuckets(draft, payload.event_date_id);
    const targetBucket = buckets[payload.desired_time_slot] || buckets[TIME_SLOTS[0]];
    const targetSeatBucket = isReservationRequestIvan(payload) ? targetBucket.ivan : targetBucket.normal;
    const slotHoldUsed = targetBucket.normal.hold.length + targetBucket.ivan.hold.length;
    const wouldUseHold = targetSeatBucket.reserved.length >= targetSeatBucket.capacity;
    if (wouldUseHold && slotHoldUsed >= RESERVATION_REQUEST_HOLD_LIMIT_PER_TIME_SLOT) {
      const label = REQUEST_TIME_SLOT_LABELS[payload.desired_time_slot] || payload.desired_time_slot;
      errors.push(`${label}の保留枠が上限に達しています。`);
    }
  }
  const sameHostSameTimeRequest = draft.reservation_requests.find((request) => {
    return !request.is_deleted
      && String(request.id) !== String(payload.id)
      && String(request.event_date_id) === String(payload.event_date_id)
      && String(request.host_user_id) === String(payload.host_user_id)
      && request.desired_time_slot === payload.desired_time_slot;
  });
  if (payload.host_user_id && sameHostSameTimeRequest) {
    errors.push("同じ担当は前半1枠、後半1枠までです。");
  }
  if (!payload.host_user_id) errors.push("担当を選択してください。");
  if (!isReservationRequestFilled(payload)) errors.push("予約内容を入力してください。");
  if (errors.length) return { state, ok: false, errors };

  const before = existing ? clone(existing) : null;
  const after = {
    ...(existing || {
      id: createId("request"),
      event_date_id: payload.event_date_id,
      created_at: stamp,
      placement_status: "auto",
      deleted_at: null,
      is_deleted: false,
    }),
    ...payload,
    id: existing?.id || payload.id || createId("request"),
    updated_at: stamp,
  };
  if (existing) Object.assign(existing, after);
  else draft.reservation_requests.push(after);
  pushHistory(draft, "reservation_request", after.id, before, after, stamp, before ? "予約受付を編集" : "予約受付を登録");
  touch(draft, stamp);
  return { state: draft, ok: true, request: after, errors: [] };
}

export function deleteReservationRequest(state, requestId, now = new Date()) {
  const draft = clone(state);
  draft.reservation_requests ||= [];
  const stamp = new Date(now).toISOString();
  const request = draft.reservation_requests.find((item) => String(item.id) === String(requestId) && !item.is_deleted);
  if (!request) return { state, ok: false, errors: ["削除対象の予約受付が見つかりません。"] };
  const before = clone(request);
  request.is_deleted = true;
  request.deleted_at = stamp;
  request.updated_at = stamp;
  pushHistory(draft, "reservation_request", request.id, before, clone(request), stamp, "予約受付を削除");
  touch(draft, stamp);
  return { state: draft, ok: true, errors: [] };
}

export function setReservationRequestPlacement(state, requestId, placementStatus, now = new Date()) {
  const draft = clone(state);
  draft.reservation_requests ||= [];
  const stamp = new Date(now).toISOString();
  const request = draft.reservation_requests.find((item) => String(item.id) === String(requestId) && !item.is_deleted);
  if (!request) return { state, ok: false, errors: ["予約受付が見つかりません。"] };
  const before = clone(request);
  request.placement_status = ["auto", "reserved", "hold"].includes(placementStatus) ? placementStatus : "auto";
  request.updated_at = stamp;
  pushHistory(draft, "reservation_request", request.id, before, clone(request), stamp, "予約受付の扱いを変更");
  touch(draft, stamp);
  return { state: draft, ok: true, request, errors: [] };
}

export function getReservationRequestBuckets(state, eventId) {
  const result = {
    [TIME_SLOTS[0]]: createReservationRequestBucket(state, eventId, TIME_SLOTS[0]),
    [TIME_SLOTS[1]]: createReservationRequestBucket(state, eventId, TIME_SLOTS[1]),
    flexible: [],
  };
  for (const request of getReservationRequestsForEvent(state, eventId)) {
    const bucket = result[request.desired_time_slot] || result[TIME_SLOTS[0]];
    const seatBucket = isReservationRequestIvan(request) ? bucket.ivan : bucket.normal;
    if (request.placement_status === "reserved") {
      bucket.reserved.push(request);
      seatBucket.reserved.push(request);
      continue;
    }
    if (request.placement_status === "hold") {
      bucket.hold.push(request);
      seatBucket.hold.push(request);
      continue;
    }
    if (seatBucket.reserved.length < seatBucket.capacity) {
      bucket.reserved.push(request);
      seatBucket.reserved.push(request);
    } else {
      bucket.hold.push(request);
      seatBucket.hold.push(request);
    }
  }
  return result;
}

function createReservationRequestBucket(state, eventId, timeSlot) {
  const normalCapacity = getReservationRequestNormalCapacity(state, eventId, timeSlot);
  const ivanCapacity = getReservationRequestIvanCapacity(state, eventId, timeSlot);
  return {
    reserved: [],
    hold: [],
    capacity: normalCapacity + ivanCapacity,
    normal: { reserved: [], hold: [], capacity: normalCapacity },
    ivan: { reserved: [], hold: [], capacity: ivanCapacity },
  };
}

export function isReservationRequestIvan(request) {
  return Boolean((request?.ivan_name || "").trim());
}

export function getDrinkPlansForEvent(state, eventId, includeDeleted = false) {
  return (state.drink_plans || []).filter((plan) => {
    return String(plan.event_date_id) === String(eventId) && (includeDeleted || !plan.is_deleted);
  });
}

export function normalizeDrinkPlan(input) {
  const validType = DRINK_PLAN_TYPES.some((item) => item.key === input.item_type);
  return {
    id: input.id || null,
    event_date_id: input.event_date_id,
    time_slot: TIME_SLOTS.includes(input.time_slot) ? input.time_slot : TIME_SLOTS[0],
    host_user_id: input.host_user_id || "",
    item_type: validType ? input.item_type : "tower",
    count: Math.max(1, toCount(input.count) || 1),
    memo: input.memo || "",
  };
}

export function isDrinkPlanFilled(plan) {
  return Boolean(plan?.event_date_id && plan?.host_user_id && plan?.item_type && toCount(plan?.count) > 0);
}

export function upsertDrinkPlan(state, input, now = new Date()) {
  const draft = clone(state);
  draft.drink_plans ||= [];
  const payload = normalizeDrinkPlan(input);
  const stamp = new Date(now).toISOString();
  const event = findEvent(draft, payload.event_date_id);
  const errors = [];
  if (!event) errors.push("イベント日が見つかりません。");
  if (event && event.status === "休み") errors.push("休み日は事前申請の対象外です。");
  if (!payload.host_user_id) errors.push("担当を選択してください。");
  if (!isDrinkPlanFilled(payload)) errors.push("予定内容を入力してください。");
  if (errors.length) return { state, ok: false, errors };

  const existing = payload.id ? draft.drink_plans.find((plan) => String(plan.id) === String(payload.id) && !plan.is_deleted) : null;
  const before = existing ? clone(existing) : null;
  const after = {
    ...(existing || {
      id: createId("plan"),
      event_date_id: payload.event_date_id,
      created_at: stamp,
      deleted_at: null,
      is_deleted: false,
    }),
    ...payload,
    updated_at: stamp,
  };
  if (existing) Object.assign(existing, after);
  else draft.drink_plans.push(after);
  pushHistory(draft, "drink_plan", after.id, before, after, stamp, before ? "事前申請を編集" : "事前申請を登録");
  touch(draft, stamp);
  return { state: draft, ok: true, plan: after, errors: [] };
}

export function deleteDrinkPlan(state, planId, now = new Date()) {
  const draft = clone(state);
  draft.drink_plans ||= [];
  const stamp = new Date(now).toISOString();
  const plan = draft.drink_plans.find((item) => String(item.id) === String(planId) && !item.is_deleted);
  if (!plan) return { state, ok: false, errors: ["削除対象の事前申請が見つかりません。"] };
  const before = clone(plan);
  plan.is_deleted = true;
  plan.deleted_at = stamp;
  plan.updated_at = stamp;
  pushHistory(draft, "drink_plan", plan.id, before, clone(plan), stamp, "事前申請を削除");
  touch(draft, stamp);
  return { state: draft, ok: true, errors: [] };
}

export function getDrinkPlanTotals(state, eventId) {
  const totals = { tower: 0, purple: 0, red: 0, blue: 0, green: 0 };
  for (const plan of getDrinkPlansForEvent(state, eventId)) {
    totals[plan.item_type] = (totals[plan.item_type] || 0) + toCount(plan.count);
  }
  return totals;
}

function isMeaningfulReservationChange(before, after) {
  if (!before) return true;
  const keys = ["time_slot", "seat_type", "group_no", "host_user_id", "princess_name", "attribute", "ivan_name", "ivan_attribute"];
  return keys.some((key) => String(before[key] || "") !== String(after[key] || ""));
}

export function validateReservationPayload(state, payload, options = {}) {
  const errors = [];
  if (!isValidSlot(payload.time_slot, payload.seat_type, payload.group_no)) {
    errors.push("存在しない予約枠です。");
  }
  const duplicate = findReservationBySlot(
    state,
    payload.event_date_id,
    payload.time_slot,
    payload.seat_type,
    payload.group_no,
  );
  if (duplicate && payload.id && duplicate.id !== payload.id) {
    errors.push("同じ枠に別の予約が登録されています。");
  }
  if (duplicate && !payload.id && options.strictDuplicate) {
    errors.push("同じ枠に予約が登録されています。");
  }
  return errors;
}

export function getSeatCounts(state, eventId) {
  const counts = {};
  for (const slot of TIME_SLOTS) {
    for (const type of SEAT_TYPES) {
      counts[getSlotKey(slot, type)] = 0;
    }
  }
  for (const reservation of getReservationsForEvent(state, eventId)) {
    if (isReservationFilled(reservation)) {
      counts[getSlotKey(reservation.time_slot, reservation.seat_type)] += 1;
    }
  }
  return counts;
}

export function getDrinkTotals(state, eventId) {
  const totals = { tower: 0, purple: 0, red: 0, blue: 0, green: 0 };
  for (const reservation of getReservationsForEvent(state, eventId)) {
    totals.tower += toCount(reservation.tower_count);
    totals.purple += toCount(reservation.purple_count);
    totals.red += toCount(reservation.red_count);
    totals.blue += toCount(reservation.blue_count);
    totals.green += toCount(reservation.green_count);
  }
  return totals;
}

export function getLimitStatus(total, limit) {
  if (total > limit) return { level: "over", text: `上限超過 +${total - limit}` };
  if (total === limit) return { level: "full", text: "上限到達" };
  return { level: "ok", text: `残り${limit - total}` };
}

export function getDrinkLimitStatuses(state, eventId) {
  const totals = getDrinkTotals(state, eventId);
  const statuses = {};
  for (const [key, item] of Object.entries(DRINK_LIMITS)) {
    statuses[key] = { ...item, total: totals[key], ...getLimitStatus(totals[key], item.limit) };
  }
  return statuses;
}

export function getSeatLimitStatuses(state, eventId) {
  const counts = getSeatCounts(state, eventId);
  const statuses = {};
  for (const [key, limit] of Object.entries(SLOT_LIMITS)) {
    statuses[key] = { total: counts[key] || 0, limit, ...getLimitStatus(counts[key] || 0, limit) };
  }
  return statuses;
}

export function getReservationWarnings(state, reservation) {
  const warnings = [];
  const event = findEvent(state, reservation.event_date_id);
  if (!event) return warnings;
  const user = reservation.host_user_id ? findUser(state, reservation.host_user_id) : null;
  const staffMember = reservation.host_user_id ? findStaffMember(state, reservation.host_user_id) : null;
  if (reservation.host_user_id) {
    if (!user && !staffMember) {
      warnings.push("担当が見つかりません");
    } else if (staffMember) {
      const attendance = getStaffAttendanceEntry(state, reservation.event_date_id, reservation.host_user_id);
      if (!attendance) warnings.push("担当内勤が勤怠未入力です");
      if (attendance?.status === "欠席") warnings.push("担当内勤が欠席です");
      if (attendance?.status === "未定") warnings.push("担当内勤が未定です");
    } else if (isOnVacation(state, reservation.host_user_id, event.event_date)) {
      warnings.push("担当ホストが長期休暇中です");
    } else {
      const attendance = getAttendanceEntry(state, reservation.event_date_id, reservation.host_user_id);
      if (!attendance) warnings.push("担当ホストが勤怠未入力です");
      if (attendance?.status === "欠席") warnings.push("担当ホストが欠席です");
      if (attendance?.status === "未定") warnings.push("担当ホストが未定です");
    }
  }
  if (wasReservationChangedAfterEventCutoff(event, reservation)) warnings.push("17時以降の追加・交代です");
  const drinks = getDrinkLimitStatuses(state, reservation.event_date_id);
  for (const item of Object.values(drinks)) {
    if (item.level === "over") warnings.push(`${item.label}上限超過`);
  }
  return warnings;
}

export function getDashboardIssues(state, eventId) {
  const issues = [];
  const missing = getMissingUsers(state, eventId);
  if (missing.length) issues.push({ level: "warn", text: `未入力者 ${missing.length}人` });
  const missingStaff = getMissingStaffMembers(state, eventId);
  if (missingStaff.length) issues.push({ level: "warn", text: `内勤未入力 ${missingStaff.length}人` });

  const seats = getSeatLimitStatuses(state, eventId);
  for (const [key, item] of Object.entries(seats)) {
    if (item.level === "full") issues.push({ level: "warn", text: `${key.replace(":", " ")} 上限到達` });
    if (item.level === "over") issues.push({ level: "danger", text: `${key.replace(":", " ")} 上限超過` });
  }

  const drinks = getDrinkLimitStatuses(state, eventId);
  for (const item of Object.values(drinks)) {
    if (item.level === "full") issues.push({ level: "warn", text: `${item.label} 上限到達` });
    if (item.level === "over") issues.push({ level: "danger", text: `${item.label} 上限超過` });
  }

  const warningCounts = new Map();
  for (const reservation of getReservationsForEvent(state, eventId)) {
    for (const warning of getReservationWarnings(state, reservation)) {
      warningCounts.set(warning, (warningCounts.get(warning) || 0) + 1);
    }
  }
  for (const [warning, count] of warningCounts) {
    issues.push({ level: warning.includes("超過") ? "danger" : "warn", text: `${warning} ${count}件` });
  }
  return issues;
}

export function upsertUser(state, input, now = new Date()) {
  const draft = clone(state);
  const stamp = new Date(now).toISOString();
  const existing = input.id ? draft.users.find((user) => user.id === input.id) : null;
  const before = existing ? clone(existing) : null;
  const after = {
    ...(existing || { id: createId("user"), created_at: stamp }),
    display_name: (input.display_name || "").trim(),
    kana: (input.kana || "").trim(),
    role: (input.role || "ホスト").trim() || "ホスト",
    is_active: Boolean(input.is_active),
    note: input.note || "",
    updated_at: stamp,
  };
  if (!after.display_name) return { state, ok: false, errors: ["ホスト名を入力してください。"] };
  if (existing) Object.assign(existing, after);
  else draft.users.push(after);
  pushHistory(draft, "user", after.id, before, after, stamp, before ? "ホストを編集" : "ホストを追加");
  touch(draft, stamp);
  return { state: draft, ok: true, user: after, errors: [] };
}

export function setUserActive(state, userId, isActive, now = new Date()) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return { state, ok: false, errors: ["対象ホストが見つかりません。"] };
  return upsertUser(state, { ...user, is_active: isActive }, now);
}

export function upsertStaffMember(state, input, now = new Date()) {
  const draft = clone(state);
  draft.staff_members ||= [];
  const stamp = new Date(now).toISOString();
  const existing = input.id ? draft.staff_members.find((member) => member.id === input.id) : null;
  const before = existing ? clone(existing) : null;
  const after = {
    ...(existing || { id: createId("staff"), created_at: stamp }),
    display_name: (input.display_name || "").trim(),
    kana: (input.kana || "").trim(),
    staff_type: (input.staff_type || "内勤").trim() || "内勤",
    is_active: Boolean(input.is_active),
    note: input.note || "",
    updated_at: stamp,
  };
  if (!after.display_name) return { state, ok: false, errors: ["内勤名を入力してください。"] };
  if (existing) Object.assign(existing, after);
  else draft.staff_members.push(after);
  pushHistory(draft, "staff_member", after.id, before, after, stamp, before ? "内勤を編集" : "内勤を追加");
  touch(draft, stamp);
  return { state: draft, ok: true, staffMember: after, errors: [] };
}

export function setStaffMemberActive(state, staffMemberId, isActive, now = new Date()) {
  const staffMember = findStaffMember(state, staffMemberId);
  if (!staffMember) return { state, ok: false, errors: ["対象内勤が見つかりません。"] };
  return upsertStaffMember(state, { ...staffMember, is_active: isActive }, now);
}

export function upsertRole(state, input, now = new Date()) {
  const draft = clone(state);
  draft.roles ||= [];
  const stamp = new Date(now).toISOString();
  const name = (input.name || "").trim();
  if (!name) return { state, ok: false, errors: ["ロール名を入力してください。"] };
  const existing = input.id
    ? draft.roles.find((role) => role.id === input.id)
    : draft.roles.find((role) => role.name === name);
  const before = existing ? clone(existing) : null;
  const after = {
    ...(existing || { id: createId("role"), created_at: stamp }),
    name,
    is_active: input.is_active !== false,
    updated_at: stamp,
  };
  if (existing) Object.assign(existing, after);
  else draft.roles.push(after);
  pushHistory(draft, "role", after.id, before, after, stamp, before ? "ロールを編集" : "ロールを追加");
  touch(draft, stamp);
  return { state: draft, ok: true, role: after, errors: [] };
}

export function setRoleActive(state, roleName, isActive, now = new Date()) {
  const existing = (state.roles || []).find((role) => role.name === roleName);
  return upsertRole(state, { ...(existing || {}), name: roleName, is_active: isActive }, now);
}

export function upsertVacation(state, input, now = new Date()) {
  const draft = clone(state);
  const stamp = new Date(now).toISOString();
  const existing = input.id ? draft.long_vacations.find((vacation) => vacation.id === input.id) : null;
  const before = existing ? clone(existing) : null;
  const after = {
    ...(existing || { id: createId("vac"), created_at: stamp }),
    user_id: input.user_id,
    start_date: input.start_date,
    end_date: input.end_date,
    reason: input.reason || "",
    is_active: Boolean(input.is_active),
    updated_at: stamp,
  };
  const errors = [];
  if (!after.user_id) errors.push("対象ホストを選択してください。");
  if (!after.start_date || !after.end_date) errors.push("休暇開始日と終了日を入力してください。");
  if (after.start_date && after.end_date && after.start_date > after.end_date) errors.push("休暇期間が不正です。");
  if (errors.length) return { state, ok: false, errors };
  if (existing) Object.assign(existing, after);
  else draft.long_vacations.push(after);
  pushHistory(draft, "long_vacation", after.id, before, after, stamp, before ? "長期休暇を編集" : "長期休暇を追加");
  touch(draft, stamp);
  return { state: draft, ok: true, vacation: after, errors: [] };
}

export function upsertEvent(state, input, now = new Date()) {
  const draft = clone(state);
  const stamp = new Date(now).toISOString();
  const existing = input.id ? draft.event_dates.find((event) => event.id === input.id) : null;
  const before = existing ? clone(existing) : null;
  const eventDate = input.event_date;
  const after = {
    ...(existing || { id: `ev_${eventDate.replaceAll("-", "")}`, created_at: stamp }),
    event_date: eventDate,
    label: input.label || formatDateLabel(eventDate),
    status: EVENT_STATUSES.includes(input.status) ? input.status : "受付中",
    reservation_open_at: input.reservation_open_at || getReservationOpenAt(eventDate),
    note: input.note || "",
    updated_at: stamp,
  };
  if (!after.event_date) return { state, ok: false, errors: ["イベント日を入力してください。"] };
  if (existing) Object.assign(existing, after);
  else draft.event_dates.push(after);
  draft.event_dates.sort((a, b) => a.event_date.localeCompare(b.event_date));
  pushHistory(draft, "event", after.id, before, after, stamp, before ? "イベント日を編集" : "イベント日を追加");
  touch(draft, stamp);
  return { state: draft, ok: true, event: after, errors: [] };
}

export function generateAttendanceDiscordText(state, eventId) {
  const event = findEvent(state, eventId);
  if (!event) return "";
  const missing = getMissingUsers(state, eventId);
  const names = missing.length ? missing.map((user) => `・${user.display_name}`).join("\n") : "・なし";
  return `【${formatDateLabel(event.event_date)} 勤怠入力のお願い】\n\n未入力の方\n${names}\n\n勤怠入力をお願いします。\n変更がある場合は、サイトから修正してください。`;
}

export function generateReservationDiscordText(state, eventId) {
  const event = findEvent(state, eventId);
  if (!event) return "";
  const issues = getDashboardIssues(state, eventId);
  const lines = issues.length ? issues.map((issue) => `・${issue.text}`).join("\n") : "・なし";
  return `【${formatDateLabel(event.event_date)} 予約確認】\n\n確認が必要な項目があります。\n\n${lines}\n\n運営画面をご確認ください。`;
}

function pushHistory(draft, target_type, target_id, before_payload, after_payload, changed_at, change_note) {
  draft.histories.unshift({
    id: createId("hist"),
    target_type,
    target_id,
    before_payload,
    after_payload,
    changed_at,
    change_note,
  });
  draft.histories = draft.histories.slice(0, 300);
}

function touch(draft, stamp) {
  draft.meta.updated_at = stamp;
}
