import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';

export default function ParentLegacy() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [images, setImages] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);

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

  useEffect(() => {
    if (selectedIndex < 0) return undefined;

    function onKeyDown(e) {
      if (e.key === 'Escape') setSelectedIndex(-1);
    }

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedIndex]);

  const selectedImage = selectedIndex >= 0 ? images[selectedIndex] : null;

  return (
    <div className="space-y-4 pb-10">
      <div className="card p-5 border-gold-300/60 bg-gold-50/50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-brand-900">리뉴얼 이전 기록</div>
            <div className="text-sm text-slate-600">이전 멘토링 기록 이미지를 확인할 수 있습니다.</div>
          </div>
          <Link className="btn-ghost" to="/parent">
            선택 화면
          </Link>
        </div>
      </div>

      <div className="card p-5 border-emerald-200/60 bg-emerald-50/40">
        {loading ? (
          <div className="text-sm text-slate-500">불러오는 중...</div>
        ) : error ? (
          <div className="text-sm text-red-600">{error}</div>
        ) : images.length ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {images.map((img, idx) => (
              <div key={img.id} className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => setSelectedIndex(idx)}
                  aria-label="이미지 전체화면 보기"
                >
                  <img
                    src={`data:${img.mime_type};base64,${img.data_base64}`}
                    alt="legacy record"
                    className="w-full rounded-xl border border-slate-200 object-contain cursor-zoom-in"
                  />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">등록된 이미지가 없습니다.</div>
        )}
      </div>

      {selectedImage ? (
        <div
          className="fixed inset-0 z-50 bg-black/80 p-4 sm:p-6"
          onClick={() => setSelectedIndex(-1)}
        >
          <div className="mx-auto flex h-full w-full max-w-7xl flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-end">
              <button className="btn-primary" type="button" onClick={() => setSelectedIndex(-1)}>
                닫기
              </button>
            </div>
            <div className="mt-3 flex-1 overflow-auto">
              <img
                src={`data:${selectedImage.mime_type};base64,${selectedImage.data_base64}`}
                alt="legacy record full view"
                className="mx-auto max-h-full w-auto max-w-full rounded-xl border border-white/30 bg-white/10 object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
