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

## JSON 업로드 예시
- 학생 일정/리스트 예시: `docs/student_schedule_example.json`
- 벌점 예시: `docs/penalties_example.json`

웹에서 원장/관리자 계정으로 로그인 후,
- 학생 업로드: 학생 페이지 상단
- 벌점 업로드: 학부모 페이지(원장/관리자 전용 버튼)

## 인쇄
멘토링 기록 페이지에서 "인쇄" 버튼을 누르면 A4 가로 인쇄용 HTML이 새 탭으로 열립니다.
인쇄에 포함할 필드는 원장 설정 페이지에서 토글할 수 있습니다.
