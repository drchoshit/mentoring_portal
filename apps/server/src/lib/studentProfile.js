const SCORE_KEYS = new Set([
  'mock_scores',
  'school_grades',
  'scores',
  'grades',
  'score_rows',
  'school_scores'
]);
const SCORE_VIEW_ROLES = new Set(['director', 'lead', 'admin']);
const SCORE_EDIT_ROLES = new Set(['director', 'lead', 'admin']);

export function canViewScoreProfile(role) {
  return SCORE_VIEW_ROLES.has(String(role || '').trim());
}

export function canEditScoreProfile(role) {
  return SCORE_EDIT_ROLES.has(String(role || '').trim());
}

export function parseProfileJson(profileJson, fallback = {}) {
  try {
    const parsed = JSON.parse(profileJson || JSON.stringify(fallback));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function cleanProfileForNonDirector(profile) {
  const next = { ...(profile || {}) };
  for (const key of SCORE_KEYS) delete next[key];
  next.score_hidden = true;
  return next;
}

export function sanitizeProfileJsonForRole(profileJson, role) {
  if (!profileJson) return profileJson;
  if (canViewScoreProfile(role)) return profileJson;
  const parsed = parseProfileJson(profileJson, {});
  return JSON.stringify(cleanProfileForNonDirector(parsed));
}

export function sanitizeStudentForRole(student, role) {
  if (!student) return student;
  if (String(role || '') === 'director') return student;
  return {
    ...student,
    profile_json: sanitizeProfileJsonForRole(student.profile_json, role)
  };
}

export function mergeProfileForRole(existingProfileJson, incomingProfileJson, role) {
  const incoming = parseProfileJson(incomingProfileJson, {});
  if (canEditScoreProfile(role)) return JSON.stringify(incoming);

  const existing = parseProfileJson(existingProfileJson, {});
  const incomingInfo = incoming?.student_info && typeof incoming.student_info === 'object' && !Array.isArray(incoming.student_info)
    ? incoming.student_info
    : null;

  if (!incomingInfo) return JSON.stringify(existing);

  return JSON.stringify({
    ...existing,
    student_info: {
      ...(existing.student_info || {}),
      ...incomingInfo
    }
  });
}
