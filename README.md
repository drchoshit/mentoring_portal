# Mentoring Portal (MVP)

로컬에서 실행 가능한 멘토링 기록/피드/학부모 조회 포털입니다.

## 요구사항
- Node.js 18+ 권장
- VSCode

## 설치
```bash
cd mentoring-app
npm run install:all
```

## 실행
개발 모드(서버+웹 동시 실행):
```bash
npm run dev
```

- 서버: http://localhost:3001
- 웹: http://localhost:5173

## 데모 계정
- 원장(director): `admin / admin1234`
- 총괄멘토(lead): `lead1 / pass1234`
- 학습멘토(mentor): `mentor1 / pass1234`
- 관리자(admin): `staff1 / pass1234`
- 학부모(parent): `parent1 / pass1234`

## 데이터
- SQLite DB 파일: `apps/server/data/db.sqlite`
- 자동 백업: `apps/server/backups/` (30분마다 + 종료 시)

## 메디위클리·메디스케줄 실시간 연동

멘토링 서버는 시작 직후와 이후 60초마다 메디위클리의 최신 멘토 배정 및 메디스케줄의 이번 주 학생 일정을 가져옵니다. 총괄멘토의 오늘 화면을 새로고침할 때도 최신 상태를 확인합니다.

```env
MEDI_WEEKLY_BASE_URL=https://your-medi-weekly-api-domain
MEDI_WEEKLY_USERNAME=your-medi-weekly-user
# 비밀번호 또는 서비스 간 JWT 서명 키 중 하나를 설정합니다.
MEDI_WEEKLY_PASSWORD=your-medi-weekly-password
MEDI_WEEKLY_JWT_SECRET=your-medi-weekly-jwt-secret

MEDI_SCHEDULE_BASE_URL=https://your-medi-schedule-domain
MEDI_SCHEDULE_USERNAME=your-medi-schedule-admin
MEDI_SCHEDULE_PASSWORD=your-medi-schedule-password
# 아래 두 옵션은 기존 학생 정보 보호를 위해 기본값이 false입니다.
MEDI_SCHEDULE_ALLOW_CREATE=false
MEDI_SCHEDULE_SYNC_PROFILES=false

LIVE_SYNC_INTERVAL_MS=60000
LIVE_SYNC_TIMEOUT_MS=20000
```

메디스케줄 학생은 외부 ID를 우선 사용하고, 없으면 포털의 유일한 동명이 아닌 이름으로 연결합니다. 기본 설정에서는 기존 학생의 `schedule_json`만 갱신하며 학생 생성 및 이름·학년·전화번호 변경은 하지 않습니다. 가져온 일정은 오늘 화면과 학생 멘토링 화면이 같은 데이터를 사용합니다. 기존 `STUDENT_SYNC_API_KEY` 기반의 메디스케줄 → 멘토링 학생 동기화도 계속 지원합니다.

## JSON 업로드 예시
- 학생 일정/리스트 예시: `docs/student_schedule_example.json`
- 벌점 예시: `docs/penalties_example.json`

웹에서 원장/관리자 계정으로 로그인 후,
- 학생 업로드: 학생 페이지 상단
- 벌점 업로드: 학부모 페이지(원장/관리자 전용 버튼)

## 인쇄
멘토링 기록 페이지에서 "인쇄" 버튼을 누르면 A4 가로 인쇄용 HTML이 새 탭으로 열립니다.
인쇄에 포함할 필드는 원장 설정 페이지에서 토글할 수 있습니다.
