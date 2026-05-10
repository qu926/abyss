import assert from 'node:assert/strict';

import {
  ATTENDANCE_STATUSES,
  ATTRIBUTES,
  DRINK_LIMITS,
  EVENT_STATUSES,
  RESERVATION_SEAT_ORDER,
  SEAT_TYPES,
  STAFF_ATTENDANCE_STATUSES,
  TIME_SLOTS,
  TIME_SLOT_LABELS,
  archiveFinishedEvents,
  buildDefaultState,
  buildEventDates,
  deleteDrinkPlan,
  deleteReservation,
  findReservationBySlot,
  getActiveStaffMembers,
  getActiveUsers,
  getAttendanceEntriesForEvent,
  getAttendanceEntry,
  getAttendanceSummary,
  getDashboardIssues,
  getDrinkLimitStatuses,
  getDrinkPlanTotals,
  getDrinkPlansForEvent,
  getDrinkTotals,
  getGroupLabels,
  getLimitStatus,
  getMissingStaffMembers,
  getMissingUsers,
  getReservationOpenAt,
  getReservationRequestOpenAt,
  getReservationRequestAcceptanceStatus,
  getReservationRequestBuckets,
  getReservationRequestCapacity,
  getReservationRequestIvanCapacity,
  getReservationRequestNormalCapacity,
  getReservationRequestsForEvent,
  getReservationSetting,
  getReservationSaveConflict,
  getReservationWarnings,
  getReservationsForEvent,
  getRoles,
  getArchivedEvents,
  getActiveEvents,
  getSeatCounts,
  getSlotKey,
  getStaffAttendanceEntry,
  getStaffAttendanceSummary,
  getVacationExemptUsers,
  isEventArchived,
  isAfterEventCutoff,
  isOnVacation,
  isReservationFilled,
  isReservationOpen,
  isReservationRequestOpen,
  isValidSlot,
  mergeSharedState,
  normalizeAttendance,
  normalizeDrinkPlan,
  normalizeReservation,
  todayString,
  setRoleActive,
  setReservationRequestPlacement,
  setStaffMemberActive,
  setUserActive,
  toLocalDateTimeString,
  upsertAttendance,
  upsertDrinkPlan,
  upsertReservation,
  upsertReservationRequest,
  upsertReservationSetting,
  upsertRole,
  upsertStaffAttendance,
  upsertStaffMember,
  upsertUser,
  upsertVacation,
  validateReservationPayload,
  wasReservationChangedAfterEventCutoff,
} from '../js/core.js';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function activeEvent(state) {
  return state.event_dates.find((event) => event.status !== EVENT_STATUSES[2]);
}

function restEvent(state) {
  return state.event_dates.find((event) => event.status === EVENT_STATUSES[2]);
}

function reservationDraft(eventId, overrides = {}) {
  return {
    event_date_id: eventId,
    time_slot: TIME_SLOTS[0],
    seat_type: SEAT_TYPES[0],
    group_no: '1',
    host_user_id: 'u_kai',
    princess_name: 'Alice',
    ivan_name: '',
    attribute: ATTRIBUTES[0],
    ivan_attribute: ATTRIBUTES[1],
    purple_count: 0,
    red_count: 0,
    blue_count: 0,
    green_count: 0,
    tower_count: 0,
    memo: '',
    ...overrides,
  };
}

function reservationRequestDraft(eventId, overrides = {}) {
  return {
    event_date_id: eventId,
    host_user_id: 'u_kai',
    desired_time_slot: TIME_SLOTS[0],
    no_same_time_double_booking: false,
    princess_name: 'Alice',
    attribute: ATTRIBUTES[0],
    ivan_name: '',
    ivan_attribute: ATTRIBUTES[1],
    purple_count: 0,
    red_count: 0,
    blue_count: 0,
    green_count: 0,
    tower_count: 0,
    memo: '',
    ...overrides,
  };
}

function ensureActiveHosts(state, count) {
  const stamp = '2026-05-01T00:00:00.000Z';
  while (getActiveUsers(state).length < count) {
    const index = state.users.length + 1;
    state.users.push({
      id: `u_test_${index}`,
      display_name: `Test Host ${index}`,
      kana: `test-${String(index).padStart(2, '0')}`,
      role: 'ホスト',
      is_active: true,
      note: '',
      created_at: stamp,
      updated_at: stamp,
    });
  }
  return getActiveUsers(state);
}

test('date helpers and default events use local dates and Friday/Saturday event days', () => {
  const date = new Date(2026, 4, 2, 9, 8);
  assert.equal(todayString(date), '2026-05-02');
  assert.equal(toLocalDateTimeString(date), '2026-05-02T09:08');
  assert.equal(getReservationOpenAt('2026-05-03'), '2026-04-29T22:00');
  assert.equal(getReservationOpenAt('2026-05-08'), '2026-05-06T22:00');
  assert.equal(getReservationOpenAt('2026-05-09'), '2026-05-06T22:00');
  assert.equal(getReservationOpenAt('2026-05-10'), '2026-05-06T22:00');
  assert.equal(getReservationOpenAt('2026-05-16'), '2026-05-13T22:00');
  assert.equal(getReservationRequestOpenAt('2026-05-08'), '2026-05-06T22:00');
  assert.equal(getReservationRequestOpenAt('2026-05-09'), '2026-05-06T22:00');
  assert.equal(getReservationRequestOpenAt('2026-05-10'), '2026-05-06T22:00');

  const events = buildEventDates(new Date(2026, 4, 15, 12), 'stamp');
  assert.ok(events.length > 0);
  for (const event of events) {
    const day = new Date(`${event.event_date}T00:00:00`).getDay();
    assert.ok(day === 5 || day === 6, `${event.event_date} should be Friday or Saturday`);
    assert.equal(event.id, `ev_${event.event_date.replaceAll('-', '')}`);
    assert.match(event.reservation_open_at, /T22:00$/);
  }

  assert.equal(
    events.find((event) => event.event_date === '2026-05-01').status,
    EVENT_STATUSES[2],
  );
  assert.equal(
    events.find((event) => event.event_date === '2026-05-08').status,
    EVENT_STATUSES[0],
  );
});

test('finished events are automatically archived and reservation sections prefer ivan seats first', () => {
  const state = buildDefaultState(new Date(2026, 4, 15, 12));
  const pastEvent = state.event_dates.find((event) => event.event_date === '2026-05-08');
  const futureEvent = state.event_dates.find((event) => event.event_date === '2026-05-22');

  assert.equal(isEventArchived(pastEvent, new Date('2026-05-09T00:00:00+09:00')), true);
  assert.equal(isEventArchived(futureEvent, new Date('2026-05-09T00:00:00+09:00')), false);

  const archived = archiveFinishedEvents(state, new Date('2026-05-09T00:00:00+09:00'));
  assert.equal(archived.changed, true);
  assert.equal(state.event_dates.find((event) => event.id === pastEvent.id).status, EVENT_STATUSES[0]);
  assert.equal(archived.state.event_dates.find((event) => event.id === pastEvent.id).status, EVENT_STATUSES[1]);
  assert.ok(getArchivedEvents(archived.state, new Date('2026-05-09T00:00:00+09:00')).some((event) => event.id === pastEvent.id));
  assert.ok(getActiveEvents(archived.state, new Date('2026-05-09T00:00:00+09:00')).some((event) => event.id === futureEvent.id));

  assert.deepEqual(RESERVATION_SEAT_ORDER, [SEAT_TYPES[1], SEAT_TYPES[0]]);
  assert.equal(TIME_SLOT_LABELS[TIME_SLOTS[0]], 'ワンタイム（前半） 21:50~');
  assert.equal(TIME_SLOT_LABELS[TIME_SLOTS[1]], 'ツータイム（後半） 22:40~');
});

test('attendance upsert is immutable and summary tracks missing, present, absent, undecided, and vacation users', () => {
  const state = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = activeEvent(state);
  const activeUsers = getActiveUsers(state);
  const absentUser = activeUsers[0];
  const presentUser = activeUsers[1];
  const vacationUser = activeUsers[2];
  const undecidedUser = activeUsers[3];
  const original = deepClone(state);

  const vacationResult = upsertVacation(
    state,
    {
      user_id: vacationUser.id,
      start_date: event.event_date,
      end_date: event.event_date,
      reason: 'private',
      is_active: true,
    },
    new Date('2026-05-02T09:00:00+09:00'),
  );
  assert.equal(vacationResult.ok, true);
  assert.deepEqual(state, original);
  assert.equal(isOnVacation(vacationResult.state, vacationUser.id, event.event_date), true);
  assert.deepEqual(
    getVacationExemptUsers(vacationResult.state, event.id).map((user) => user.id),
    [vacationUser.id],
  );

  const presentResult = upsertAttendance(
    vacationResult.state,
    {
      event_date_id: event.id,
      user_id: presentUser.id,
      status: ATTENDANCE_STATUSES[0],
      memo: 'on time',
    },
    new Date('2026-05-02T10:00:00+09:00'),
  );
  assert.equal(presentResult.ok, true);
  assert.equal(getAttendanceEntry(presentResult.state, event.id, presentUser.id).memo, 'on time');

  const absentResult = upsertAttendance(
    presentResult.state,
    {
      event_date_id: event.id,
      user_id: absentUser.id,
      status: ATTENDANCE_STATUSES[1],
      memo: '',
    },
    new Date('2026-05-02T10:05:00+09:00'),
  );
  assert.equal(absentResult.ok, true);

  const undecidedResult = upsertAttendance(
    absentResult.state,
    {
      event_date_id: event.id,
      user_id: undecidedUser.id,
      status: 'invalid-status',
      memo: '',
    },
    new Date('2026-05-02T10:10:00+09:00'),
  );
  assert.equal(undecidedResult.ok, true);
  assert.equal(getAttendanceEntriesForEvent(undecidedResult.state, event.id).length, 3);
  assert.equal(
    getAttendanceEntry(undecidedResult.state, event.id, undecidedUser.id).status,
    ATTENDANCE_STATUSES[2],
  );

  const summary = getAttendanceSummary(undecidedResult.state, event.id);
  assert.equal(summary[ATTENDANCE_STATUSES[0]], 1);
  assert.equal(summary[ATTENDANCE_STATUSES[1]], 1);
  assert.equal(summary[ATTENDANCE_STATUSES[2]], 1);
  assert.equal(summary[ATTENDANCE_STATUSES[3]], 0);
  assert.equal(getMissingUsers(undecidedResult.state, event.id).length, activeUsers.length - 4);

  const restResult = upsertAttendance(
    undecidedResult.state,
    {
      event_date_id: restEvent(undecidedResult.state).id,
      user_id: presentUser.id,
      status: ATTENDANCE_STATUSES[0],
      memo: '',
    },
    new Date('2026-05-02T11:00:00+09:00'),
  );
  assert.equal(restResult.ok, false);
  assert.equal(restResult.state, undecidedResult.state);
});

test('shared state merge keeps attendance entered from another stale browser session', () => {
  const base = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = activeEvent(base);
  const [hostA, hostB] = getActiveUsers(base);

  const remoteAfterA = upsertAttendance(
    base,
    {
      event_date_id: event.id,
      user_id: hostA.id,
      status: ATTENDANCE_STATUSES[0],
      memo: 'A session',
    },
    new Date('2026-05-02T10:00:00+09:00'),
  );
  const staleLocalAfterB = upsertAttendance(
    base,
    {
      event_date_id: event.id,
      user_id: hostB.id,
      status: ATTENDANCE_STATUSES[0],
      memo: 'B session',
    },
    new Date('2026-05-02T10:05:00+09:00'),
  );

  const merged = mergeSharedState(remoteAfterA.state, staleLocalAfterB.state);
  assert.equal(getAttendanceEntry(merged, event.id, hostA.id).memo, 'A session');
  assert.equal(getAttendanceEntry(merged, event.id, hostB.id).memo, 'B session');
  assert.equal(getAttendanceEntriesForEvent(merged, event.id).length, 2);
});

test('hosts can be disabled without removing historical identity', () => {
  const state = buildDefaultState(new Date(2026, 4, 15, 12));
  const user = getActiveUsers(state)[0];
  const result = setUserActive(state, user.id, false, new Date('2026-05-02T10:00:00+09:00'));

  assert.equal(result.ok, true);
  assert.equal(state.users.find((item) => item.id === user.id).is_active, true);
  assert.equal(result.state.users.find((item) => item.id === user.id).is_active, false);
  assert.equal(result.state.users.find((item) => item.id === user.id).display_name, user.display_name);
  assert.ok(!getActiveUsers(result.state).some((item) => item.id === user.id));

  const enabled = setUserActive(result.state, user.id, true, new Date('2026-05-02T10:05:00+09:00'));
  assert.equal(enabled.ok, true);
  assert.ok(getActiveUsers(enabled.state).some((item) => item.id === user.id));
});

test('custom roles can be created, assigned, disabled, and restored', () => {
  const state = buildDefaultState(new Date(2026, 4, 15, 12));
  const createdRole = upsertRole(state, { name: '幹部候補', is_active: true }, new Date('2026-05-02T10:00:00+09:00'));
  assert.equal(createdRole.ok, true);
  assert.ok(getRoles(createdRole.state).some((role) => role.name === '幹部候補'));

  const user = getActiveUsers(createdRole.state)[0];
  const secondRole = upsertRole(createdRole.state, { name: '相談役', is_active: true });
  assert.equal(secondRole.ok, true);

  const assigned = upsertUser(
    secondRole.state,
    { ...user, role: '幹部候補', is_active: true },
    new Date('2026-05-02T10:05:00+09:00'),
  );
  assert.equal(assigned.ok, true);
  assert.equal(assigned.user.role, '幹部候補');

  const disabled = setRoleActive(assigned.state, '幹部候補', false, new Date('2026-05-02T10:10:00+09:00'));
  assert.equal(disabled.ok, true);
  assert.ok(!getRoles(disabled.state).some((role) => role.name === '幹部候補'));
  assert.ok(getRoles(disabled.state, true).some((role) => role.name === '幹部候補' && role.is_active === false));

  const restored = setRoleActive(disabled.state, '幹部候補', true, new Date('2026-05-02T10:15:00+09:00'));
  assert.equal(restored.ok, true);
  assert.ok(getRoles(restored.state).some((role) => role.name === '幹部候補'));
});

test('internal staff attendance is managed separately from host attendance', () => {
  const state = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = activeEvent(state);
  const hostMissingCount = getMissingUsers(state, event.id).length;

  const createdStaff = upsertStaffMember(
    state,
    {
      display_name: '内勤太郎',
      kana: 'ないきんたろう',
      staff_type: '内勤',
      is_active: true,
      note: 'front',
    },
    new Date('2026-05-02T10:00:00+09:00'),
  );
  assert.equal(createdStaff.ok, true);
  assert.equal(getActiveStaffMembers(state).length, 0);
  assert.equal(getActiveStaffMembers(createdStaff.state).length, 1);
  assert.equal(getMissingUsers(createdStaff.state, event.id).length, hostMissingCount);
  assert.deepEqual(getStaffAttendanceSummary(createdStaff.state, event.id), {
    出勤: 0,
    欠席: 0,
    未定: 0,
    未入力: 1,
  });
  assert.equal(getMissingStaffMembers(createdStaff.state, event.id).length, 1);

  const attended = upsertStaffAttendance(
    createdStaff.state,
    {
      event_date_id: event.id,
      staff_member_id: createdStaff.staffMember.id,
      status: STAFF_ATTENDANCE_STATUSES[0],
      memo: '受付',
    },
    new Date('2026-05-02T10:05:00+09:00'),
  );
  assert.equal(attended.ok, true);
  assert.equal(getStaffAttendanceEntry(attended.state, event.id, createdStaff.staffMember.id).memo, '受付');
  assert.deepEqual(getStaffAttendanceSummary(attended.state, event.id), {
    出勤: 1,
    欠席: 0,
    未定: 0,
    未入力: 0,
  });
  assert.equal(getMissingStaffMembers(attended.state, event.id).length, 0);
  assert.ok(getDashboardIssues(createdStaff.state, event.id).some((issue) => issue.text === '内勤未入力 1人'));

  const disabled = setStaffMemberActive(attended.state, createdStaff.staffMember.id, false, new Date('2026-05-02T10:10:00+09:00'));
  assert.equal(disabled.ok, true);
  assert.equal(getActiveStaffMembers(disabled.state).length, 0);
  assert.equal(getMissingStaffMembers(disabled.state, event.id).length, 0);

  const restResult = upsertStaffAttendance(
    disabled.state,
    {
      event_date_id: restEvent(disabled.state).id,
      staff_member_id: createdStaff.staffMember.id,
      status: STAFF_ATTENDANCE_STATUSES[0],
      memo: '',
    },
    new Date('2026-05-02T11:00:00+09:00'),
  );
  assert.equal(restResult.ok, false);
});

test('reservation normalization validates slots, trims guest names, clamps counts, and detects empty drafts', () => {
  assert.deepEqual(getGroupLabels(SEAT_TYPES[0]), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(getGroupLabels(SEAT_TYPES[1]), ['A1', 'A2']);
  assert.equal(getSlotKey(TIME_SLOTS[0], SEAT_TYPES[1]), `${TIME_SLOTS[0]}:${SEAT_TYPES[1]}`);
  assert.equal(isValidSlot(TIME_SLOTS[0], SEAT_TYPES[0], '8'), true);
  assert.equal(isValidSlot(TIME_SLOTS[0], SEAT_TYPES[1], '8'), false);

  const normalized = normalizeReservation({
    event_date_id: 'ev_20260508',
    time_slot: TIME_SLOTS[0],
    seat_type: SEAT_TYPES[0],
    group_no: 1,
    host_user_id: '',
    princess_name: '  Alice  ',
    ivan_name: '  Bob  ',
    attribute: 'invalid-attribute',
    ivan_attribute: ATTRIBUTES[3],
    purple_count: -1,
    red_count: '3',
    blue_count: 'not-a-number',
    green_count: 2,
    tower_count: 4,
    memo: '',
  });

  assert.equal(normalized.group_no, '1');
  assert.equal(normalized.princess_name, 'Alice');
  assert.equal(normalized.ivan_name, 'Bob');
  assert.equal(normalized.attribute, ATTRIBUTES[ATTRIBUTES.length - 1]);
  assert.equal(normalized.ivan_attribute, ATTRIBUTES[3]);
  assert.equal(normalized.purple_count, 0);
  assert.equal(normalized.red_count, 3);
  assert.equal(normalized.blue_count, 0);
  assert.equal(normalized.green_count, 2);
  assert.equal(normalized.tower_count, 1);
  assert.equal(isReservationFilled(normalized), true);

  const legacy = normalizeReservation({
    event_date_id: 'ev_20260508',
    time_slot: TIME_SLOTS[0],
    seat_type: SEAT_TYPES[1],
    group_no: 'A1',
    attribute: ATTRIBUTES[2],
  });
  assert.equal(legacy.attribute, ATTRIBUTES[2]);
  assert.equal(legacy.ivan_attribute, ATTRIBUTES[2]);

  assert.equal(
    isReservationFilled(
      normalizeReservation({
        event_date_id: 'ev_20260508',
        time_slot: TIME_SLOTS[0],
        seat_type: SEAT_TYPES[0],
        group_no: 1,
      }),
    ),
    false,
  );
  assert.equal(normalizeAttendance({ event_date_id: 'ev', user_id: 'u', status: 'bad' }).status, ATTENDANCE_STATUSES[2]);
});

test('reservation save conflicts protect occupied slots and stale edits', () => {
  let state = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = activeEvent(state);
  const created = upsertReservation(
    state,
    reservationDraft(event.id, {
      group_no: '5',
      host_user_id: 'u_seto',
      princess_name: 'Seto first',
    }),
    { admin: true, now: '2026-05-03T13:22:14.748Z', strictDuplicate: true },
  );
  assert.equal(created.ok, true);
  state = created.state;

  const occupiedConflict = getReservationSaveConflict(
    state,
    reservationDraft(event.id, {
      group_no: '5',
      host_user_id: 'u_usui',
      princess_name: 'Usui stale screen',
    }),
  );
  assert.equal(occupiedConflict.type, 'occupied');
  assert.equal(occupiedConflict.reservation.host_user_id, 'u_seto');

  const currentEdit = reservationDraft(event.id, {
    id: created.reservation.id,
    group_no: '5',
    host_user_id: 'u_seto',
    princess_name: 'Seto edited',
    base_updated_at: created.reservation.updated_at,
  });
  assert.equal(getReservationSaveConflict(state, currentEdit), null);

  state.reservations[0].memo = 'changed elsewhere';
  state.reservations[0].updated_at = '2026-05-03T13:23:15.271Z';
  const staleEditConflict = getReservationSaveConflict(state, currentEdit);
  assert.equal(staleEditConflict.type, 'stale');

  const deleted = deleteReservation(state, created.reservation.id, '2026-05-03T13:24:00.000Z');
  assert.equal(deleted.ok, true);
  assert.equal(getReservationSaveConflict(deleted.state, occupiedConflict.reservation), null);
});

test('reservation request prototype supports seat capacities, host limits, and manual holds', () => {
  let state = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = activeEvent(state);
  let hosts = ensureActiveHosts(state, 30);

  assert.equal(getReservationSetting(state, event.id).instance_count, 1);
  assert.equal(getReservationRequestNormalCapacity(state, event.id, TIME_SLOTS[0]), 8);
  assert.equal(getReservationRequestIvanCapacity(state, event.id, TIME_SLOTS[0]), 2);
  assert.equal(getReservationRequestCapacity(state, event.id, TIME_SLOTS[0]), 10);

  const backRequest = upsertReservationRequest(
    state,
    reservationRequestDraft(event.id, {
      host_user_id: hosts[0].id,
      desired_time_slot: TIME_SLOTS[1],
      princess_name: 'Back Guest',
    }),
    { admin: true, now: '2026-05-03T13:00:00.000Z' },
  );
  assert.equal(backRequest.ok, true);
  state = backRequest.state;

  const duplicateSameHostSlot = upsertReservationRequest(
    state,
    reservationRequestDraft(event.id, {
      host_user_id: hosts[0].id,
      desired_time_slot: TIME_SLOTS[1],
      princess_name: 'Duplicate Back Guest',
    }),
    { admin: true, now: '2026-05-03T13:01:00.000Z' },
  );
  assert.equal(duplicateSameHostSlot.ok, false);
  assert.equal(duplicateSameHostSlot.errors.includes('同じホストは前半1枠、後半1枠までです。'), true);

  state = buildDefaultState(new Date(2026, 4, 15, 12));
  hosts = ensureActiveHosts(state, 30);
  for (let i = 0; i < 9; i += 1) {
    const created = upsertReservationRequest(
      state,
      reservationRequestDraft(event.id, {
        host_user_id: hosts[i].id,
        princess_name: `Guest ${i + 1}`,
      }),
      { admin: true, now: `2026-05-03T13:${String(i).padStart(2, '0')}:00.000Z` },
    );
    assert.equal(created.ok, true);
    state = created.state;
  }

  let buckets = getReservationRequestBuckets(state, event.id);
  assert.equal(buckets[TIME_SLOTS[0]].normal.reserved.length, 8);
  assert.equal(buckets[TIME_SLOTS[0]].normal.hold.length, 1);

  const first = buckets[TIME_SLOTS[0]].normal.reserved[0];
  const held = setReservationRequestPlacement(state, first.id, 'hold', '2026-05-03T13:20:00.000Z');
  assert.equal(held.ok, true);
  state = held.state;
  buckets = getReservationRequestBuckets(state, event.id);
  assert.equal(buckets[TIME_SLOTS[0]].normal.reserved.some((request) => request.princess_name === 'Guest 9'), true);
  assert.equal(buckets[TIME_SLOTS[0]].normal.hold.some((request) => request.id === first.id), true);

  const setting = upsertReservationSetting(
    state,
    { event_date_id: event.id, instance_count: 2, normal_capacity_front: 18, normal_capacity_back: 19 },
    '2026-05-03T13:30:00.000Z',
  );
  assert.equal(setting.ok, true);
  state = setting.state;
  assert.equal(getReservationSetting(state, event.id).instance_count, 2);
  assert.equal(getReservationRequestNormalCapacity(state, event.id, TIME_SLOTS[0]), 18);
  assert.equal(getReservationRequestNormalCapacity(state, event.id, TIME_SLOTS[1]), 19);
  assert.equal(getReservationRequestIvanCapacity(state, event.id, TIME_SLOTS[1]), 4);
  assert.equal(getReservationRequestCapacity(state, event.id, TIME_SLOTS[1]), 23);

  const thirdIvan = upsertReservationRequest(
    state,
    reservationRequestDraft(event.id, {
      host_user_id: hosts[20].id,
      ivan_name: 'Ivan Guest',
      princess_name: 'Ivan Princess',
    }),
    { admin: true, now: '2026-05-03T13:31:00.000Z' },
  );
  assert.equal(thirdIvan.ok, true);
});

test('reservation request acceptance closes after five hold slots for hosts', () => {
  let state = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = activeEvent(state);
  const hosts = ensureActiveHosts(state, 30);
  const setting = upsertReservationSetting(state, { event_date_id: event.id, instance_count: 2 }, '2026-05-03T12:00:00.000Z');
  assert.equal(setting.ok, true);
  state = setting.state;

  const requests = [
    ...Array.from({ length: 21 }, (_, i) => ({
      host_user_id: hosts[i].id,
      desired_time_slot: TIME_SLOTS[0],
      princess_name: `Front Normal ${i + 1}`,
    })),
    ...Array.from({ length: 16 }, (_, i) => ({
      host_user_id: hosts[i].id,
      desired_time_slot: TIME_SLOTS[1],
      princess_name: `Back Normal ${i + 1}`,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      host_user_id: hosts[i + 21].id,
      desired_time_slot: TIME_SLOTS[0],
      princess_name: `Front Ivan ${i + 1}`,
      ivan_name: `Ivan ${i + 1}`,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      host_user_id: hosts[i + 16].id,
      desired_time_slot: TIME_SLOTS[1],
      princess_name: `Back Ivan ${i + 1}`,
      ivan_name: `Back Ivan ${i + 1}`,
    })),
  ];

  for (let i = 0; i < requests.length; i += 1) {
    const created = upsertReservationRequest(
      state,
      reservationRequestDraft(event.id, requests[i]),
      { admin: true, now: `2026-05-03T13:${String(i).padStart(2, '0')}:00.000Z` },
    );
    assert.equal(created.ok, true);
    state = created.state;
  }

  assert.deepEqual(getReservationRequestAcceptanceStatus(state, event.id), {
    total: 45,
    reservationCapacity: 40,
    holdCapacity: 5,
    holdUsed: 5,
    capacity: 45,
    remaining: 0,
    closed: true,
  });

  const hostAttempt = upsertReservationRequest(
    state,
    reservationRequestDraft(event.id, { princess_name: 'Too late' }),
    { admin: false, now: event.reservation_open_at },
  );
  assert.equal(hostAttempt.ok, false);
  assert.equal(hostAttempt.errors.includes('受付上限に達しているため、予約受付は締め切られています。'), true);

  const adminAttempt = upsertReservationRequest(
    state,
    reservationRequestDraft(event.id, { host_user_id: hosts[25].id, princess_name: 'Admin override' }),
    { admin: true, now: '2026-05-03T14:00:00.000Z' },
  );
  assert.equal(adminAttempt.ok, true);
});

test('reservation request prototype opens on Wednesday at 22:00 for hosts', () => {
  let state = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = state.event_dates.find((item) => item.event_date === '2026-05-08');
  assert.equal(event.reservation_open_at, '2026-05-06T22:00');
  assert.equal(getReservationRequestOpenAt(event.event_date), '2026-05-06T22:00');

  const beforeRequestOpen = upsertReservationRequest(
    state,
    reservationRequestDraft(event.id, { princess_name: 'Before request open' }),
    { admin: false, now: '2026-05-06T21:59:59.999' },
  );
  assert.equal(beforeRequestOpen.ok, false);

  const atRequestOpen = upsertReservationRequest(
    state,
    reservationRequestDraft(event.id, { princess_name: 'At request open' }),
    { admin: false, now: '2026-05-06T22:00:00.000' },
  );
  assert.equal(atRequestOpen.ok, true);
  state = atRequestOpen.state;
  assert.equal(getReservationRequestsForEvent(state, event.id).length, 1);
});

test('drink plans can be entered before reservation open and are tracked separately from actual drink totals', () => {
  const state = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = activeEvent(state);
  const beforeOpen = new Date(event.reservation_open_at);
  beforeOpen.setDate(beforeOpen.getDate() - 7);

  const normalized = normalizeDrinkPlan({
    event_date_id: event.id,
    time_slot: 'bad',
    host_user_id: 'u_kai',
    item_type: 'bad',
    count: -2,
    memo: 'tower lead',
  });
  assert.equal(normalized.time_slot, TIME_SLOTS[0]);
  assert.equal(normalized.item_type, 'tower');
  assert.equal(normalized.count, 1);

  const created = upsertDrinkPlan(
    state,
    {
      event_date_id: event.id,
      time_slot: TIME_SLOTS[1],
      host_user_id: 'u_kai',
      item_type: 'tower',
      count: 1,
      memo: '先に確認',
    },
    beforeOpen,
  );
  assert.equal(created.ok, true);
  assert.equal(getDrinkPlansForEvent(created.state, event.id).length, 1);
  assert.deepEqual(getDrinkPlanTotals(created.state, event.id), {
    tower: 1,
    purple: 0,
    red: 0,
    blue: 0,
    green: 0,
  });
  assert.deepEqual(getDrinkTotals(created.state, event.id), {
    tower: 0,
    purple: 0,
    red: 0,
    blue: 0,
    green: 0,
  });

  const deleted = deleteDrinkPlan(created.state, created.plan.id, beforeOpen);
  assert.equal(deleted.ok, true);
  assert.equal(getDrinkPlansForEvent(deleted.state, event.id).length, 0);
  assert.equal(getDrinkPlansForEvent(deleted.state, event.id, true).length, 1);

  const numericIdState = deepClone(created.state);
  numericIdState.drink_plans[0].id = 12345;
  numericIdState.drink_plans[0].is_deleted = false;
  const deletedNumeric = deleteDrinkPlan(numericIdState, '12345', beforeOpen);
  assert.equal(deletedNumeric.ok, true);
  assert.equal(getDrinkPlansForEvent(deletedNumeric.state, event.id).length, 0);
});

test('reservation upsert opens only after the event gate, supports admin override, updates by slot, and soft deletes', () => {
  const state = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = activeEvent(state);
  const original = deepClone(state);
  const beforeOpen = new Date(event.reservation_open_at);
  beforeOpen.setMinutes(beforeOpen.getMinutes() - 1);

  const blocked = upsertReservation(
    state,
    reservationDraft(event.id),
    { now: beforeOpen, admin: false },
  );
  assert.equal(blocked.ok, false);
  assert.equal(blocked.state, state);

  const created = upsertReservation(
    state,
    reservationDraft(event.id, {
      purple_count: 2,
      red_count: 1,
      tower_count: 1,
    }),
    { now: beforeOpen, admin: true },
  );
  assert.equal(created.ok, true);
  assert.deepEqual(state, original);
  assert.equal(state.reservations.length, 0);
  assert.equal(getReservationsForEvent(created.state, event.id).length, 1);
  assert.equal(
    findReservationBySlot(created.state, event.id, TIME_SLOTS[0], SEAT_TYPES[0], '1').id,
    created.reservation.id,
  );

  const updated = upsertReservation(
    created.state,
    reservationDraft(event.id, {
      group_no: '1',
      princess_name: 'Alice Updated',
      green_count: 3,
    }),
    { now: beforeOpen, admin: true },
  );
  assert.equal(updated.ok, true);
  assert.equal(getReservationsForEvent(updated.state, event.id).length, 1);
  assert.equal(getReservationsForEvent(updated.state, event.id)[0].princess_name, 'Alice Updated');

  const duplicateErrors = validateReservationPayload(
    updated.state,
    normalizeReservation(reservationDraft(event.id, { group_no: '1' })),
    { strictDuplicate: true },
  );
  assert.ok(duplicateErrors.length > 0);

  const deleted = deleteReservation(
    updated.state,
    updated.reservation.id,
    new Date('2026-05-02T12:00:00+09:00'),
  );
  assert.equal(deleted.ok, true);
  assert.equal(getReservationsForEvent(deleted.state, event.id).length, 0);
  assert.equal(getReservationsForEvent(deleted.state, event.id, true).length, 1);
  assert.equal(getReservationsForEvent(deleted.state, event.id, true)[0].is_deleted, true);

  const numericIdState = deepClone(updated.state);
  numericIdState.reservations[0].id = 98765;
  const deletedNumeric = deleteReservation(numericIdState, '98765', new Date('2026-05-02T12:00:00+09:00'));
  assert.equal(deletedNumeric.ok, true);
  assert.equal(getReservationsForEvent(deletedNumeric.state, event.id).length, 0);
});

test('reservation summaries enforce active seat and drink limits', () => {
  const state = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = activeEvent(state);
  const now = new Date(event.reservation_open_at);

  const first = upsertReservation(
    state,
    reservationDraft(event.id, {
      group_no: '1',
      purple_count: 2,
      red_count: 1,
      tower_count: 1,
    }),
    { now, admin: true },
  );
  const second = upsertReservation(
    first.state,
    reservationDraft(event.id, {
      group_no: '2',
      princess_name: 'Beth',
      purple_count: 2,
      green_count: 5,
    }),
    { now, admin: true },
  );
  const third = upsertReservation(
    second.state,
    reservationDraft(event.id, {
      time_slot: TIME_SLOTS[1],
      seat_type: SEAT_TYPES[1],
      group_no: 'A1',
      princess_name: 'Cara',
      red_count: 5,
      blue_count: 1,
    }),
    { now, admin: true },
  );

  const seatCounts = getSeatCounts(third.state, event.id);
  assert.equal(seatCounts[getSlotKey(TIME_SLOTS[0], SEAT_TYPES[0])], 2);
  assert.equal(seatCounts[getSlotKey(TIME_SLOTS[1], SEAT_TYPES[1])], 1);

  assert.deepEqual(getDrinkTotals(third.state, event.id), {
    tower: 1,
    purple: 4,
    red: 6,
    blue: 1,
    green: 5,
  });

  assert.equal(getLimitStatus(DRINK_LIMITS.purple.limit - 1, DRINK_LIMITS.purple.limit).level, 'ok');
  assert.equal(getLimitStatus(DRINK_LIMITS.purple.limit, DRINK_LIMITS.purple.limit).level, 'full');
  assert.equal(getLimitStatus(DRINK_LIMITS.purple.limit + 1, DRINK_LIMITS.purple.limit).level, 'over');

  const drinkStatuses = getDrinkLimitStatuses(third.state, event.id);
  assert.equal(drinkStatuses.purple.level, 'over');
  assert.equal(drinkStatuses.red.level, 'over');

  const warnings = getReservationWarnings(third.state, third.reservation);
  assert.ok(warnings.length > 0);
  assert.ok(getDashboardIssues(third.state, event.id).some((issue) => issue.level === 'danger'));
});

test('reservation open and same-day cutoff boundaries are deterministic', () => {
  const state = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = activeEvent(state);
  const beforeOpen = new Date(event.reservation_open_at);
  beforeOpen.setMilliseconds(beforeOpen.getMilliseconds() - 1);
  const atOpen = new Date(event.reservation_open_at);

  assert.equal(isReservationOpen(event, beforeOpen), false);
  assert.equal(isReservationOpen(event, atOpen), true);

  const requestOpenAt = new Date(getReservationRequestOpenAt(event.event_date));
  const beforeRequestOpen = new Date(requestOpenAt);
  beforeRequestOpen.setMilliseconds(beforeRequestOpen.getMilliseconds() - 1);
  assert.equal(isReservationRequestOpen(event, beforeRequestOpen), false);
  assert.equal(isReservationRequestOpen(event, requestOpenAt), true);

  assert.equal(isAfterEventCutoff(event, new Date(`${event.event_date}T16:59:00`)), false);
  assert.equal(isAfterEventCutoff(event, new Date(`${event.event_date}T17:01:00`)), true);
  assert.equal(isAfterEventCutoff(event, new Date('2026-05-01T18:00:00')), false);
});

test('late reservation warning is only kept for changes saved on event day after 17:00', () => {
  const state = buildDefaultState(new Date(2026, 4, 15, 12));
  const event = activeEvent(state);
  const eventEve = new Date(`${event.event_date}T20:00:00`);
  eventEve.setDate(eventEve.getDate() - 1);

  const beforeDay = upsertReservation(
    state,
    reservationDraft(event.id, {
      host_user_id: 'u_kai',
      princess_name: 'くゆ',
    }),
    { now: eventEve, admin: true },
  );
  assert.equal(beforeDay.ok, true);
  assert.equal(beforeDay.reservation.late_warning, false);
  assert.equal(getReservationWarnings(beforeDay.state, beforeDay.reservation).includes('17時以降の追加・交代です'), false);

  const staleWarning = deepClone(beforeDay.reservation);
  staleWarning.late_warning = true;
  staleWarning.updated_at = eventEve.toISOString();
  assert.equal(wasReservationChangedAfterEventCutoff(event, staleWarning), false);

  const afterCutoff = upsertReservation(
    beforeDay.state,
    reservationDraft(event.id, {
      id: beforeDay.reservation.id,
      host_user_id: 'u_kai',
      princess_name: 'くゆ変更',
    }),
    { now: new Date(`${event.event_date}T17:01:00`), admin: true },
  );
  assert.equal(afterCutoff.ok, true);
  assert.equal(afterCutoff.reservation.late_warning, true);
  assert.equal(getReservationWarnings(afterCutoff.state, afterCutoff.reservation).includes('17時以降の追加・交代です'), true);
});

let passed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

console.log(`${passed} tests passed`);
