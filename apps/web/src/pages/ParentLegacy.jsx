import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function ParentLegacy() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [images, setImages] = useState([]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await api('/api/parent/legacy-images');
      setImages(Array.isArray(r?.images) ? r.images : []);
    } catch (e) {
      setError(e.message);
      setImages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-4 pb-10">
      <div className="card p-5 border-gold-300/60 bg-gold-50/50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-brand-900">리뉴얼 이전 기록</div>
            <div className="text-sm text-slate-600">이전 멘토링 기록 이미지를 확인할 수 있습니다.</div>
          </div>
          <Link className="btn-ghost" to="/parent">선택 화면</Link>
        </div>
      </div>

      <div className="card p-5 border-emerald-200/60 bg-emerald-50/40">
        {loading ? (
          <div className="text-sm text-slate-500">불러오는 중...</div>
        ) : error ? (
          <div className="text-sm text-red-600">{error}</div>
        ) : images.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {images.map((img) => (
              <div key={img.id} className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                <img
                  src={`data:${img.mime_type};base64,${img.data_base64}`}
                  alt="legacy record"
                  className="w-full rounded-xl border border-slate-200 object-contain"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">등록된 이미지가 없습니다.</div>
        )}
      </div>
    </div>
  );
}
