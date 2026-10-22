import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../web/src/pages/LeadAssignmentBoard.jsx', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const DAY_COLUMNS'), source.indexOf('export default function'));
const boardStart = source.indexOf('const boardRows = useMemo(() => {') + 'const boardRows = useMemo(() => {'.length;
const boardBody = source.slice(boardStart, source.indexOf('}, [leadMentorRoster,', boardStart));

function boardFixture({ assignments = [], reassignments = [], forcedAssignments = [], attendance = '18:00~19:00' } = {}) {
  const context = vm.createContext({
    assignments, reassignments, forcedAssignments,
    leadMentorRoster: ['기존M', '변경M'], leadMentorSet: new Set(['기존M', '변경M']),
    leadMentorOrder: new Map(), studentMap: new Map([[1, { name: '학생' }]])
  });
  vm.runInContext(`${helpers}\nglobalThis.rows = (() => {${boardBody}})();`, context);
  context.mentorDetails = ['기존M', '변경M'].map((name) => ({ name, schedule: { Thu: [{ time: '18:00~19:00' }] } }));
  context.studentSchedules = { 1: { Thu: [{ time: attendance, type: '센터' }] } };
  context.missingMap = new Map();
  return {
    rows: context.rows,
    timeline: () => vm.runInContext('buildMentoringTimeline(rows, mentorDetails, studentSchedules, missingMap)', context)
  };
}

test('reassigned mentee actually reaches the rendered board rows and time slots', () => {
  const fixture = boardFixture({ reassignments: [{ student_id: 1, student_name: '학생', target_mentor_name: '변경M', target_day_label: '목' }] });
  const target = fixture.rows.find((row) => row.mentor_name === '변경M').by_day['목'];
  assert.equal(target.length, 1);
  assert.equal(target[0].reassigned, true);
  const timeline = fixture.timeline()['목'].find((row) => row.mentor_name === '변경M');
  assert.equal(timeline.assigned_count, 1);
  assert.equal(timeline.slots.find((slot) => slot.student).student.student_id, 1);
});

test('same student, day and mentor is counted once across base, forced and reassigned entries', () => {
  const fixture = boardFixture({
    assignments: [{ student_id: 1, name: '학생', lead_mentor: '변경M', scheduledDays: ['목'] }],
    forcedAssignments: [{ student_id: 1, target_mentor_name: '변경M', target_day_label: '목' }],
    reassignments: [{ student_id: 1, target_mentor_name: '변경M', target_day_label: '목' }]
  });
  const timeline = fixture.timeline()['목'].find((row) => row.mentor_name === '변경M');
  assert.equal(timeline.request_count, 1);
  assert.equal(timeline.assigned_count, 1);
  assert.equal(timeline.slots.find((slot) => slot.student).student.reassigned, true);
});

test('reassignment outside center attendance remains visible as unassigned', () => {
  const fixture = boardFixture({ attendance: '20:00~21:00', reassignments: [{ student_id: 1, student_name: '학생', target_mentor_name: '변경M', target_day_label: '목' }] });
  const timeline = fixture.timeline()['목'].find((row) => row.mentor_name === '변경M');
  assert.equal(timeline.request_count, 1);
  assert.equal(timeline.assigned_count, 0);
  assert.equal(timeline.unassigned[0], '학생');
});

test('changing base mentor removes base entry from previous mentor board', () => {
  const fixture = boardFixture({ assignments: [{ student_id: 1, name: '학생', lead_mentor: '변경M', scheduledDays: ['목'] }] });
  assert.equal(fixture.rows.find((row) => row.mentor_name === '기존M').by_day['목'].length, 0);
  assert.equal(fixture.rows.find((row) => row.mentor_name === '변경M').by_day['목'].length, 1);
});
