import jwt from 'jsonwebtoken';

function getProblemUploadSecret() {
  return String(process.env.PROBLEM_UPLOAD_SECRET || process.env.JWT_SECRET || 'mentoring-problem-upload-secret');
}

export function signWrongAnswerUploadToken({ student_id, week_id, problem_index, issued_by }, expiresIn = '12h') {
  const payload = {
    type: 'wrong_answer_upload',
    student_id: Number(student_id || 0),
    week_id: Number(week_id || 0),
    problem_index: Number(problem_index || 0),
    issued_by: Number(issued_by || 0)
  };
  return jwt.sign(payload, getProblemUploadSecret(), { expiresIn });
}

export function verifyWrongAnswerUploadToken(token) {
  const decoded = jwt.verify(String(token || ''), getProblemUploadSecret());
  if (!decoded || decoded.type !== 'wrong_answer_upload') {
    throw new Error('Invalid upload token');
  }
  return decoded;
}
