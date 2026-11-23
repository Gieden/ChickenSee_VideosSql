'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  FlaskConical,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Clock,
  BarChart3,
  Users,
} from 'lucide-react';
import type { BirdAuditRow, HourBlockAudit } from '@/app/api/testing-audit/route';

type TestingSubTab = 'summary' | 'schedule' | 'per_chicken';

interface TestingAuditPayload {
  success: boolean;
  generatedAt: string;
  videoCount: number;
  date: string;
  summary: {
    gtFrames: number;
    tp: number;
    fp: number;
    fn: number;
    idsw: number;
    idtp: number;
    idfpIdfn: number;
    precision: number;
    recall: number;
    f1: number;
    mota: number;
    idf1: number;
  };
  blocks: HourBlockAudit[];
  combinedBirds: BirdAuditRow[];
}

function fmtPct(val: number): string {
  return `${(val * 100).toFixed(2)}%`;
}

function fmtInt(val: number): string {
  return Math.round(val).toLocaleString();
}

export default function TestingAuditTab() {
  const [subTab, setSubTab] = useState<TestingSubTab>('summary');
  const [data, setData] = useState<TestingAuditPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHourBlock, setSelectedHourBlock] = useState<string>('all');

  const fetchAudit = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/testing-audit?_t=${Date.now()}`, { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || 'Failed to compute testing audit');
      setData(payload);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading testing audit');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const activeBirdRows: BirdAuditRow[] = useMemo(() => {
    if (!data) return [];
    if (selectedHourBlock === 'all') return data.combinedBirds;
    const found = data.blocks.find((b) => String(b.blockNumber) === selectedHourBlock);
    return found ? found.birds : data.combinedBirds;
  }, [data, selectedHourBlock]);

  const activeBirdTotals = useMemo(() => {
    const agg = activeBirdRows.reduce(
      (acc, b) => ({
        gtFrames: acc.gtFrames + b.gtFrames,
        tp: acc.tp + b.tp,
        fp: acc.fp + b.fp,
        fn: acc.fn + b.fn,
        idsw: acc.idsw + b.idsw,
        idtp: acc.idtp + b.idtp,
        idfpIdfn: acc.idfpIdfn + b.idfpIdfn,
      }),
      { gtFrames: 0, tp: 0, fp: 0, fn: 0, idsw: 0, idtp: 0, idfpIdfn: 0 },
    );
    const precision = agg.tp + agg.fp > 0 ? agg.tp / (agg.tp + agg.fp) : 0;
    const recall = agg.tp + agg.fn > 0 ? agg.tp / (agg.tp + agg.fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const mota = agg.gtFrames > 0 ? 1 - (agg.fn + agg.fp + agg.idsw) / agg.gtFrames : 0;
    const idf1 = 2 * agg.idtp + agg.idfpIdfn > 0 ? (2 * agg.idtp) / (2 * agg.idtp + agg.idfpIdfn) : 0;
    return { ...agg, precision, recall, f1, mota, idf1 };
  }, [activeBirdRows]);

  const exportCsv = useCallback(() => {
    if (!data) return;
    let headers: string[] = [];
    let rows: (string | number)[][] = [];
    let filename = `chickensee_testing_${subTab}_${data.date}.csv`;

    if (subTab === 'summary') {
      headers = ['Evaluation Stage', 'Primary Metric', 'Formula / Basis', '11-Video Audit Result', 'Target Threshold', 'Status', 'Notes'];
      const s = data.summary;
      rows = [
        ['Stage 1: Saddle Detection', 'Precision', 'TP / (TP + FP)', fmtPct(s.precision), '>= 95.00%', s.precision >= 0.95 ? 'PASS' : 'REVIEW', 'Measures false boxes on unsaddled rooster or background'],
        ['Stage 1: Saddle Detection', 'Recall', 'TP / (TP + FN)', fmtPct(s.recall), '>= 90.00%', s.recall >= 0.90 ? 'PASS' : 'REVIEW', 'Measures missed saddles (glare, wing cover, occlusion)'],
        ['Stage 1: Saddle Detection', 'F1-Score', '2 * (P * R) / (P + R)', fmtPct(s.f1), '>= 92.00%', s.f1 >= 0.92 ? 'PASS' : 'REVIEW', 'Balanced snapshot detection accuracy'],
        ['Stage 2: Identification', 'MOTA', '1 - (FN + FP + IDSW) / GT', fmtPct(s.mota), '>= 85.00%', s.mota >= 0.85 ? 'PASS' : 'REVIEW', 'Multi-object tracking accuracy across frames'],
        ['Stage 2: Identification', 'IDF1', '2*IDTP / (2*IDTP + IDFP + IDFN)', fmtPct(s.idf1), '>= 88.00%', s.idf1 >= 0.88 ? 'PASS' : 'REVIEW', "Identity loyalty to each hen's true saddle color"],
      ];
    } else if (subTab === 'schedule') {
      headers = [
        'Block', 'Video', 'Time Window', 'Pen / Lighting Condition',
        'GT Frames', 'TP', 'FP', 'FN', 'IDSW',
        'Precision', 'Recall', 'F1-Score', 'MOTA', 'IDF1',
        'IDTP (Exact ID)', 'IDFP + IDFN', 'Observations',
      ];
      rows = [
        ...data.blocks.map((b) => [
          `Block ${b.blockNumber}`, b.video, b.timeWindow, b.lightingCondition,
          b.gtFrames, b.tp, b.fp, b.fn, b.idsw,
          fmtPct(b.precision), fmtPct(b.recall), fmtPct(b.f1), fmtPct(b.mota), fmtPct(b.idf1),
          b.idtp, b.idfpIdfn, b.observations,
        ]),
        [
          `${data.blocks.length}-HR TOTAL`, 'All Uploaded Videos', '07:00 – 18:00', 'Full Daylight Aggregate',
          data.summary.gtFrames, data.summary.tp, data.summary.fp, data.summary.fn, data.summary.idsw,
          fmtPct(data.summary.precision), fmtPct(data.summary.recall), fmtPct(data.summary.f1), fmtPct(data.summary.mota), fmtPct(data.summary.idf1),
          data.summary.idtp, data.summary.idfpIdfn, `Computed from ${data.videoCount} videos`,
        ],
      ];
    } else {
      headers = [
        'Bird ID', 'Saddle Color', 'Role in Pen',
        'GT Frames', 'TP', 'FP', 'FN', 'IDSW',
        'Precision', 'Recall', 'F1-Score', 'MOTA', 'IDF1',
        'IDTP', 'IDFP + IDFN',
      ];
      rows = [
        ...activeBirdRows.map((b) => [
          b.birdId, b.saddleColor, b.role,
          b.gtFrames, b.tp, b.fp, b.fn, b.idsw,
          fmtPct(b.precision), fmtPct(b.recall), fmtPct(b.f1), fmtPct(b.mota), fmtPct(b.idf1),
          b.idtp, b.idfpIdfn,
        ]),
        [
          'ALL CHICKEN', 'All 6 Colors', 'Combined 6-CHICKEN Total',
          activeBirdTotals.gtFrames, activeBirdTotals.tp, activeBirdTotals.fp, activeBirdTotals.fn, activeBirdTotals.idsw,
          fmtPct(activeBirdTotals.precision), fmtPct(activeBirdTotals.recall), fmtPct(activeBirdTotals.f1), fmtPct(activeBirdTotals.mota), fmtPct(activeBirdTotals.idf1),
          activeBirdTotals.idtp, activeBirdTotals.idfpIdfn,
        ],
      ];
    }

    const csv =
      '\uFEFF' +
      [
        headers.join(','),
        ...rows.map((r) =>
          r
            .map((v) => {
              const s = String(v ?? '');
              return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
            })
            .join(','),
        ),
      ].join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [data, subTab, activeBirdRows, activeBirdTotals]);

  const summaryRows = useMemo(() => {
    if (!data) return [];
    const s = data.summary;
    return [
      {
        stage: 'Stage 1: Saddle Detection',
        metric: 'Precision',
        formula: 'TP / (TP + FP)',
        value: s.precision,
        target: 0.95,
        targetLabel: '≥ 95.0%',
        notes: 'Measures false boxes on unsaddled rooster or background',
      },
      {
        stage: 'Stage 1: Saddle Detection',
        metric: 'Recall',
        formula: 'TP / (TP + FN)',
        value: s.recall,
        target: 0.90,
        targetLabel: '≥ 90.0%',
        notes: 'Measures missed saddles (glare, wing cover, occlusion)',
      },
      {
        stage: 'Stage 1: Saddle Detection',
        metric: 'F1-Score',
        formula: '2 * (P * R) / (P + R)',
        value: s.f1,
        target: 0.92,
        targetLabel: '≥ 92.0%',
        notes: 'Balanced snapshot detection accuracy',
      },
      {
        stage: 'Stage 2: Identification',
        metric: 'MOTA',
        formula: '1 - (FN + FP + IDSW) / GT',
        value: s.mota,
        target: 0.85,
        targetLabel: '≥ 85.0%',
        notes: 'Multi-object tracking accuracy across frames',
      },
      {
        stage: 'Stage 2: Identification',
        metric: 'IDF1',
        formula: '2*IDTP / (2*IDTP + IDFP + IDFN)',
        value: s.idf1,
        target: 0.88,
        targetLabel: '≥ 88.0%',
        notes: "Identity loyalty to each hen's true saddle color",
      },
    ];
  }, [data]);

  return (
    <div className="space-y-6">
      {/* Header & 3-Section Sub-Nav */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-bold text-purple-800">
              <FlaskConical className="h-3.5 w-3.5 text-purple-600" />
              <span>Temporary Testing Evaluation · {data?.videoCount || 11} Uploaded Videos ({data?.date || '2026-11-17'})</span>
            </div>
            <h1 className="mt-2 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Chicken Saddle Detection &amp; Identification — System Test Evaluation
            </h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">
              Pen Setup: 5 Saddled Hens (Yellow, Blue, Red, White, Yellow-Green) + 1 Unsaddled Rooster · Auto-computed from the {data?.videoCount || 11} processed hourly videos.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={fetchAudit}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Recalculate</span>
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={!data}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-orange-700 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* 3 Sub-Tabs ONLY: Summary Dashboard, 10-Hr Schedule Audit, Per-Chicken Breakdown */}
        <div className="mt-5 border-b border-slate-200">
          <nav className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSubTab('summary')}
              className={`flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-xs font-semibold transition sm:text-sm ${
                subTab === 'summary'
                  ? 'border-b-2 border-orange-600 bg-orange-50/60 font-bold text-orange-950'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              <span>Summary Dashboard</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('schedule')}
              className={`flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-xs font-semibold transition sm:text-sm ${
                subTab === 'schedule'
                  ? 'border-b-2 border-orange-600 bg-orange-50/60 font-bold text-orange-950'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Clock className="h-4 w-4" />
              <span>10-Hr Schedule Audit</span>
              {data && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  {data.blocks.length} Blocks
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setSubTab('per_chicken')}
              className={`flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-xs font-semibold transition sm:text-sm ${
                subTab === 'per_chicken'
                  ? 'border-b-2 border-orange-600 bg-orange-50/60 font-bold text-orange-950'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Users className="h-4 w-4" />
              <span>Per-Chicken Breakdown</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                6 Birds
              </span>
            </button>
          </nav>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          Computing Detection &amp; Identification metrics across all 11 uploaded videos...
        </div>
      ) : null}

      {/* ── 1. SUMMARY DASHBOARD ─────────────────────────────────────────── */}
      {data && subTab === 'summary' && (
        <div className="space-y-5">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {summaryRows.map((m) => {
              const pass = m.value >= m.target;
              return (
                <div key={m.metric} className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {m.metric}
                  </div>
                  <div className="mt-1 font-mono text-2xl font-bold text-slate-900">
                    {fmtPct(m.value)}
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Target {m.targetLabel}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        pass
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {pass ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                      {pass ? 'PASS' : 'REVIEW'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Overall System Performance Summary Table */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5">
              <h2 className="text-sm font-bold text-slate-900">
                1. Overall System Performance Summary (Auto-Calculated from {data.videoCount} Uploaded Videos)
              </h2>
              <p className="text-xs text-slate-500">
                Aggregate Totals — GT: {fmtInt(data.summary.gtFrames)} · TP: {fmtInt(data.summary.tp)} · FP: {fmtInt(data.summary.fp)} · FN: {fmtInt(data.summary.fn)} · IDSW: {fmtInt(data.summary.idsw)} · IDTP: {fmtInt(data.summary.idtp)}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-orange-700 bg-[#b45309] text-[11px] font-bold text-white">
                    <th className="px-4 py-2.5">Evaluation Stage</th>
                    <th className="px-4 py-2.5">Primary Metric</th>
                    <th className="px-4 py-2.5">Formula / Basis</th>
                    <th className="px-4 py-2.5 text-right">10-Hr / 11-Video Test</th>
                    <th className="px-4 py-2.5 text-right">Target Threshold</th>
                    <th className="px-4 py-2.5 text-center">Status</th>
                    <th className="px-4 py-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summaryRows.map((row) => {
                    const pass = row.value >= row.target;
                    return (
                      <tr key={row.metric} className="hover:bg-orange-50/30">
                        <td className="px-4 py-3 font-semibold text-slate-800">{row.stage}</td>
                        <td className="px-4 py-3 font-bold text-slate-900">{row.metric}</td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-600">{row.formula}</td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-bold text-orange-700">
                          {fmtPct(row.value)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-600">{row.targetLabel}</td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                              pass
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {pass ? 'PASS' : 'REVIEW'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{row.notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── 2. 10-HR SCHEDULE AUDIT ──────────────────────────────────────── */}
      {data && subTab === 'schedule' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="border-b border-slate-200 bg-slate-50 px-5 py-3.5">
            <h2 className="text-sm font-bold text-slate-900">
              DAY 1 — 10-HR CONTINUOUS RUN AUDIT ({data.date} · {data.blocks.length} Uploaded Hourly Blocks)
            </h2>
            <p className="text-xs text-slate-500">
              Auto-calculated from all {data.blocks.length} processed <code className="font-mono">rec_2026-11-17_*</code> videos (07:00 – 18:00).
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1320px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-orange-700 bg-[#b45309] text-[11px] font-bold text-white">
                  <th className="px-3 py-2.5">Block</th>
                  <th className="px-3 py-2.5">Time Window</th>
                  <th className="px-3 py-2.5">Pen / Lighting Condition</th>
                  <th className="px-3 py-2.5 text-right">GT Frames</th>
                  <th className="px-3 py-2.5 text-right">TP</th>
                  <th className="px-3 py-2.5 text-right">FP</th>
                  <th className="px-3 py-2.5 text-right">FN</th>
                  <th className="px-3 py-2.5 text-right">IDSW</th>
                  <th className="px-3 py-2.5 text-right">Precision</th>
                  <th className="px-3 py-2.5 text-right">Recall</th>
                  <th className="px-3 py-2.5 text-right">F1-Score</th>
                  <th className="px-3 py-2.5 text-right">MOTA</th>
                  <th className="px-3 py-2.5 text-right">IDF1</th>
                  <th className="px-3 py-2.5 text-right">IDTP</th>
                  <th className="px-3 py-2.5 text-right">IDFP + IDFN</th>
                  <th className="px-3 py-2.5">Observations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.blocks.map((b) => (
                  <tr key={b.video} className="hover:bg-orange-50/30">
                    <td className="px-3 py-2.5 font-bold text-slate-900">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedHourBlock(String(b.blockNumber));
                          setSubTab('per_chicken');
                        }}
                        title={`Inspect per-chicken breakdown for ${b.video}`}
                        className="text-orange-700 underline-offset-2 hover:underline"
                      >
                        Block {b.blockNumber}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-700">{b.timeWindow}</td>
                    <td className="px-3 py-2.5 text-slate-600">{b.lightingCondition}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmtInt(b.gtFrames)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-emerald-700">{fmtInt(b.tp)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-rose-600">{fmtInt(b.fp)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-amber-700">{fmtInt(b.fn)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmtInt(b.idsw)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtPct(b.precision)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtPct(b.recall)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtPct(b.f1)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtPct(b.mota)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtPct(b.idf1)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmtInt(b.idtp)}</td>
                    <td className="px-3 py-2.5 text-right font-mono">{fmtInt(b.idfpIdfn)}</td>
                    <td className="px-3 py-2.5 text-[11px] text-slate-500">{b.observations}</td>
                  </tr>
                ))}
                {/* Aggregate Total Row */}
                <tr className="border-t-2 border-slate-300 bg-orange-50/70 font-bold text-slate-900">
                  <td className="px-3 py-3">{data.blocks.length}-HR TOTAL</td>
                  <td className="px-3 py-3 font-mono">07:00 – 18:00</td>
                  <td className="px-3 py-3">Full Daylight Aggregate (Computed from Summed Counts)</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtInt(data.summary.gtFrames)}</td>
                  <td className="px-3 py-3 text-right font-mono text-emerald-800">{fmtInt(data.summary.tp)}</td>
                  <td className="px-3 py-3 text-right font-mono text-rose-700">{fmtInt(data.summary.fp)}</td>
                  <td className="px-3 py-3 text-right font-mono text-amber-800">{fmtInt(data.summary.fn)}</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtInt(data.summary.idsw)}</td>
                  <td className="px-3 py-3 text-right font-mono text-orange-800">{fmtPct(data.summary.precision)}</td>
                  <td className="px-3 py-3 text-right font-mono text-orange-800">{fmtPct(data.summary.recall)}</td>
                  <td className="px-3 py-3 text-right font-mono text-orange-800">{fmtPct(data.summary.f1)}</td>
                  <td className="px-3 py-3 text-right font-mono text-orange-800">{fmtPct(data.summary.mota)}</td>
                  <td className="px-3 py-3 text-right font-mono text-orange-800">{fmtPct(data.summary.idf1)}</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtInt(data.summary.idtp)}</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtInt(data.summary.idfpIdfn)}</td>
                  <td className="px-3 py-3 text-[11px] text-slate-600">{data.videoCount} videos aggregated</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 3. PER-CHICKEN BREAKDOWN ─────────────────────────────────────── */}
      {data && subTab === 'per_chicken' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
            <div className="text-xs text-slate-600">
              <strong className="text-slate-900">Per-Chicken Diagnostic Breakdown</strong> — Isolates which saddle color struggles under glare/shadow and tracks the unsaddled rooster.
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-slate-600">Hour Block:</span>
              <select
                value={selectedHourBlock}
                onChange={(e) => setSelectedHourBlock(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-xs focus:border-orange-500 focus:outline-hidden"
              >
                <option value="all">All {data.blocks.length} Uploaded Videos Combined (07:00 – 18:00)</option>
                {data.blocks.map((b) => (
                  <option key={b.video} value={String(b.blockNumber)}>
                    Block {b.blockNumber} ({b.timeWindow}) — {b.video}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1160px] border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-orange-700 bg-[#b45309] text-[11px] font-bold text-white">
                    <th className="px-3 py-2.5">Bird ID</th>
                    <th className="px-3 py-2.5">Saddle Color</th>
                    <th className="px-3 py-2.5">Role in Pen</th>
                    <th className="px-3 py-2.5 text-right">GT Frames</th>
                    <th className="px-3 py-2.5 text-right">TP</th>
                    <th className="px-3 py-2.5 text-right">FP</th>
                    <th className="px-3 py-2.5 text-right">FN</th>
                    <th className="px-3 py-2.5 text-right">IDSW</th>
                    <th className="px-3 py-2.5 text-right">Precision</th>
                    <th className="px-3 py-2.5 text-right">Recall</th>
                    <th className="px-3 py-2.5 text-right">F1-Score</th>
                    <th className="px-3 py-2.5 text-right">MOTA</th>
                    <th className="px-3 py-2.5 text-right">IDF1</th>
                    <th className="px-3 py-2.5 text-right">IDTP</th>
                    <th className="px-3 py-2.5 text-right">IDFP + IDFN</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeBirdRows.map((b) => (
                    <tr key={b.shortId} className="hover:bg-orange-50/30">
                      <td className="px-3 py-2.5 font-bold text-slate-900">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full border border-slate-300"
                            style={{ backgroundColor: b.dotColor }}
                          />
                          {b.birdId}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-medium text-slate-700">{b.saddleColor}</td>
                      <td className="px-3 py-2.5 text-slate-600">{b.role}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{fmtInt(b.gtFrames)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-emerald-700">{fmtInt(b.tp)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-rose-600">{fmtInt(b.fp)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-amber-700">{fmtInt(b.fn)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{fmtInt(b.idsw)}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtPct(b.precision)}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtPct(b.recall)}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtPct(b.f1)}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtPct(b.mota)}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtPct(b.idf1)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{fmtInt(b.idtp)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{fmtInt(b.idfpIdfn)}</td>
                    </tr>
                  ))}
                  {/* ALL CHICKEN Total Row */}
                  <tr className="border-t-2 border-slate-300 bg-orange-50/70 font-bold text-slate-900">
                    <td className="px-3 py-3">ALL CHICKEN</td>
                    <td className="px-3 py-3">All 6 Colors</td>
                    <td className="px-3 py-3">Combined 6-CHICKEN Total</td>
                    <td className="px-3 py-3 text-right font-mono">{fmtInt(activeBirdTotals.gtFrames)}</td>
                    <td className="px-3 py-3 text-right font-mono text-emerald-800">{fmtInt(activeBirdTotals.tp)}</td>
                    <td className="px-3 py-3 text-right font-mono text-rose-700">{fmtInt(activeBirdTotals.fp)}</td>
                    <td className="px-3 py-3 text-right font-mono text-amber-800">{fmtInt(activeBirdTotals.fn)}</td>
                    <td className="px-3 py-3 text-right font-mono">{fmtInt(activeBirdTotals.idsw)}</td>
                    <td className="px-3 py-3 text-right font-mono text-orange-800">{fmtPct(activeBirdTotals.precision)}</td>
                    <td className="px-3 py-3 text-right font-mono text-orange-800">{fmtPct(activeBirdTotals.recall)}</td>
                    <td className="px-3 py-3 text-right font-mono text-orange-800">{fmtPct(activeBirdTotals.f1)}</td>
                    <td className="px-3 py-3 text-right font-mono text-orange-800">{fmtPct(activeBirdTotals.mota)}</td>
                    <td className="px-3 py-3 text-right font-mono text-orange-800">{fmtPct(activeBirdTotals.idf1)}</td>
                    <td className="px-3 py-3 text-right font-mono">{fmtInt(activeBirdTotals.idtp)}</td>
                    <td className="px-3 py-3 text-right font-mono">{fmtInt(activeBirdTotals.idfpIdfn)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
