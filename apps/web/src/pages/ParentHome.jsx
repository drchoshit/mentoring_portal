import React from 'react';
import { useNavigate } from 'react-router-dom';

export default function ParentHome() {
  const nav = useNavigate();

  return (
    <div className="space-y-4">
      <div className="card p-6 border-gold-300/60 bg-gold-50/50">
        <div className="text-lg font-semibold text-brand-900">학부모 페이지</div>
        <div className="mt-2 text-sm text-slate-600">확인할 기록을 선택해 주세요.</div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <button className="btn-primary" onClick={() => nav('/parent/legacy')}>
            리뉴얼 이전 기록 확인하기
          </button>
          <button className="btn-ghost" onClick={() => nav('/parent/renewal')}>
            리뉴얼 기록 확인하기
          </button>
        </div>
      </div>
    </div>
  );
}
