import jwt from 'jsonwebtoken';

export const MENTOR_BRIEFING_TTL_HOURS = 48;
export const MENTOR_BRIEFING_DEFAULT_EXPIRES_IN = `${MENTOR_BRIEFING_TTL_HOURS}h`;

function getMentorBriefingSecret() {
  return String(
    process.env.MENTOR_BRIEFING_SECRET ||
    process.env.PROBLEM_UPLOAD_SECRET ||
    process.env.JWT_SECRET ||
    'mentoring-briefing-token-secret'
  );
}

export function signMentorBriefingToken(
  { token_id, week_id, mentor_name, mentor_role, issued_by },
  expiresIn = MENTOR_BRIEFING_DEFAULT_EXPIRES_IN
) {
  const payload = {
    type: 'mentor_briefing',
    token_id: String(token_id || '').trim(),
    week_id: Number(week_id || 0),
    mentor_name: String(mentor_name || '').trim(),
    mentor_role: String(mentor_role || '').trim(),
    issued_by: Number(issued_by || 0)
  };

  return jwt.sign(payload, getMentorBriefingSecret(), { expiresIn });
}

export function verifyMentorBriefingToken(token) {
  const decoded = jwt.verify(String(token || ''), getMentorBriefingSecret());
  if (!decoded || decoded.type !== 'mentor_briefing') {
    throw new Error('Invalid briefing token');
  }
  return decoded;
}
