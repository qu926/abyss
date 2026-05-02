import assert from 'node:assert/strict';

import {
  ATTENDANCE_STATUSES,
  ATTRIBUTES,
  DRINK_LIMITS,
  EVENT_STATUSES,
  RESERVATION_SEAT_ORDER,
  SEAT_TYPES,
  TIME_SLOTS,
  TIME_SLOT_LABELS,
  archiveFinishedEvents,
  buildDefaultState,
  buildEventDates,
  deleteDrinkPlan,
  deleteReservation,
  findReservationBySlot,
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
  getMissingUsers,
  getReservationOpenAt,
  getReservationWarnings,
  getReservationsForEvent,
  getArchivedEvents,
  getActiveEvents,
  getSeatCounts,
  getSlotKey,
  getVacationExemptUsers,
  isEventArchived,
  isAfterEventCutoff,
  isOnVacation,
  isReservationFilled,
  isReservationOpen,
  isValidSlot,
  normalizeAttendance,
  normalizeDrinkPlan,
  normalizeReservation,
  todayString,
  toLocalDateTimeString,
  upsertAttendance,
  upsertDrinkPlan,
  upsertReservation,
  upsertVacation,
  validateReservationPayload,
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
    purple_count: 0,
    red_count: 0,
    blue_count: 0,
    green_count: 0,
    tower_count: 0,
    memo: '',
    ...overrides,
  };
}

test('date helpers and default events use local dates and Friday/Saturday event days', () => {
  const date = new Date(2026, 4, 2, 9, 8);
  assert.equal(todayString(date), '2026-05-02');
  assert.equal(toLocalDateTimeString(date), '2026-05-02T09:08');
  assert.equal(getReservationOpenAt('2026-05-09'), '2026-05-03T22:00');

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
  assert.equal(normalized.purple_count, 0);
  assert.equal(normalized.red_count, 3);
  assert.equal(normalized.blue_count, 0);
  assert.equal(normalized.green_count, 2);
  assert.equal(normalized.tower_count, 1);
  assert.equal(isReservationFilled(normalized), true);

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

  assert.equal(isAfterEventCutoff(event, new Date(`${event.event_date}T16:59:00`)), false);
  assert.equal(isAfterEventCutoff(event, new Date(`${event.event_date}T17:01:00`)), true);
  assert.equal(isAfterEventCutoff(event, new Date('2026-05-01T18:00:00')), false);
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
