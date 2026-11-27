import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  createFollowupRequest, downloadFollowupEvidence, listFollowupRequests,
  refreshFollowupRequest, remindFollowupRequest, sendFollowupRequest,
  syncFollowupRequest,
} from '../../lib/roaSubmissionClient';

GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();

function formatDate(value) { return value ? new Date(value).toLocaleString() : '—'; }
function toBase64(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 0x8000) value += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(value);
}

export default function FollowupSigning({ submissionId, enabled, initialAction }) {
  const [requests, setRequests] = useState([]);
  const [mode, setMode] = useState(initialAction === 'schedule' || initialAction === 'banking' ? initialAction : '');
  const [file, setFile] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(1);
  const [position, setPosition] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canvas = useRef(null);
  const preview = useRef(null);

  useEffect(() => {
    setRequests([]); setDraft(null); setFile(null); setBytes(null); setPdf(null);
    setPage(1); setPosition(null); setError('');
    setMode(initialAction === 'schedule' || initialAction === 'banking' ? initialAction : '');
    if (submissionId && enabled) listFollowupRequests(submissionId).then(setRequests).catch(e => setError(e.message));
  }, [submissionId, enabled, initialAction]);

  useEffect(() => {
    if (!pdf || !canvas.current) return undefined;
    let cancelled = false;
    let task;
    (async () => {
      const pdfPage = await pdf.getPage(page);
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(680 / base.width, 1.5);
      const viewport = pdfPage.getViewport({ scale });
      if (cancelled || !canvas.current) return;
      canvas.current.width = Math.ceil(viewport.width);
      canvas.current.height = Math.ceil(viewport.height);
      task = pdfPage.render({ canvasContext: canvas.current.getContext('2d'), viewport });
      await task.promise;
    })().catch(e => { if (!cancelled && e?.name !== 'RenderingCancelledException') setError('PDF preview failed'); });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, page]);

  async function chooseFile(next) {
    setFile(null); setBytes(null); setPdf(null); setPosition(null); setDraft(null); setError('');
    if (!next) return;
    if (next.type !== 'application/pdf' || next.size > 12 * 1024 * 1024) {
      setError('Select a PDF smaller than 12 MB.'); return;
    }
    try {
      const data = new Uint8Array(await next.arrayBuffer());
      const doc = await getDocument({ data: data.slice() }).promise;
      setBytes(data); setPdf(doc); setFile(next); setPage(1);
    } catch { setError('This PDF could not be opened.'); }
  }

  function placeSignature(event) {
    const bounds = preview.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(58, (event.clientX - bounds.left) / bounds.width * 100));
    const y = Math.max(0, Math.min(92, (event.clientY - bounds.top) / bounds.height * 100));
    setPosition({ page, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
    setDraft(null);
  }

  async function prepare() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (mode === 'schedule' && (!bytes || !position)) throw new Error('Choose a PDF and place the signature box.');
      const id = crypto.randomUUID();
      const { request } = await createFollowupRequest({
        id, submissionId, kind: mode,
        ...(mode === 'schedule' ? { pdfBase64: toBase64(bytes), ...position } : {}),
      });
      setDraft(request);
      setRequests(current => [request, ...current.filter(item => item.id !== request.id)]);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function act(id, action) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { request } = await action(id);
      setRequests(current => current.map(item => item.id === id ? request : item));
      if (draft?.id === id && request.status !== 'draft') setDraft(null);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (!enabled) return null;
  return <section className="bg-white rounded-xl border border-hrs-orange/30 p-4 space-y-4">
    <div>
      <h3 className="text-sm font-bold text-hrs-blue">Follow-up signing</h3>
      <p className="text-xs text-hrs-muted">Each document stays linked to this signed ROA revision. Choose the intended request below.</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => { setMode('schedule'); setDraft(null); setError(''); }} className="px-3 py-2 rounded border border-hrs-orange text-xs">Send policy schedule for signature</button>
      <button type="button" onClick={() => { setMode('banking'); setDraft(null); setError(''); }} className="px-3 py-2 rounded border border-hrs-orange text-xs">Request signed banking details</button>
    </div>
    {mode === 'schedule' && !draft && <div className="space-y-3">
      <label className="block text-xs font-semibold">Insurer schedule PDF <input type="file" accept="application/pdf,.pdf" onChange={e => chooseFile(e.target.files?.[0])} className="block mt-1" /></label>
      {pdf && <>
        <div className="flex gap-2 items-center text-xs"><button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pdf.numPages}</span><button type="button" disabled={page >= pdf.numPages} onClick={() => setPage(page + 1)}>Next</button></div>
        <p className="text-xs">Click or tap the exact place for the signature. Click again to reposition it.</p>
        <div ref={preview} onClick={placeSignature} className="relative inline-block max-w-full cursor-crosshair border border-gray-300 touch-manipulation">
          <canvas ref={canvas} className="block max-w-full" />
          {position?.page === page && <span className="absolute border-2 border-hrs-orange bg-orange-100/40 text-xs text-hrs-blue pointer-events-none" style={{ left: `${position.x}%`, top: `${position.y}%`, width: '42%', height: '7.5%' }}>Client signature</span>}
        </div>
        {position && <p className="text-xs">Signature on page {position.page}. The box can be moved before sending.</p>}
      </>}
      {file && <p className="text-xs">Source: {file.name}</p>}
      <button type="button" disabled={busy || !position} onClick={prepare} className="px-3 py-2 bg-hrs-blue text-white rounded text-xs disabled:opacity-50">Review recipient and document</button>
    </div>}
    {mode === 'banking' && !draft && <div className="space-y-2 text-xs">
      <p>HRS generates a standalone confirmation. The client enters their bank details, selects a monthly collection date, and signs. Proof is optional.</p>
      <button type="button" disabled={busy} onClick={prepare} className="px-3 py-2 bg-hrs-blue text-white rounded disabled:opacity-50">Review recipient and document</button>
    </div>}
    {draft && <div className="border border-hrs-orange rounded p-3 space-y-2 text-xs">
      <p className="font-semibold">Review before sending</p>
      <p>Document: {draft.kind === 'schedule' ? `Policy schedule, signature page ${draft.signaturePage}` : 'Banking Details Confirmation'}</p>
      <p>Recipient from signed ROA: {draft.signerName} · {draft.signerEmail}</p>
      <button type="button" disabled={busy} onClick={() => act(draft.id, sendFollowupRequest)} className="px-3 py-2 bg-hrs-blue text-white rounded disabled:opacity-50">Send signing invitation</button>
    </div>}
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    <div className="space-y-2">
      <div className="flex items-center gap-3"><h4 className="text-xs font-semibold">Requests for this ROA</h4>
        <button type="button" disabled={busy} onClick={() => listFollowupRequests(submissionId).then(setRequests).catch(e => setError(e.message))} className="text-xs underline">Reload requests</button>
      </div>
      {requests.length === 0 && <p className="text-xs text-hrs-muted">No follow-up requests yet.</p>}
      {requests.map(item => <div key={item.id} className="border rounded p-3 text-xs space-y-1">
        <p className="font-semibold">{item.kind === 'schedule' ? 'Policy schedule' : 'Banking details'} · {item.status} · {formatDate(item.createdAt)}</p>
        <p>{item.signerName} · {item.signerEmail}</p>
        <p>CRM: {item.crmSyncStatus || 'Not synced'}{item.crmSyncError ? ` · ${item.crmSyncError}` : ''}</p>
        {item.kind === 'banking' && <p>{item.hasSigned ? 'Banking details signed' : 'Banking details outstanding'} · {item.proofReceived ? 'Proof received' : 'Proof outstanding'}</p>}
        <div className="flex flex-wrap gap-2">
          {item.status === 'draft' || item.status === 'failed' ? <button type="button" disabled={busy} onClick={() => act(item.id, sendFollowupRequest)}>Send</button> : null}
          {item.status === 'pending' && <><button type="button" disabled={busy} onClick={() => act(item.id, refreshFollowupRequest)}>Check status</button><button type="button" disabled={busy} onClick={() => act(item.id, remindFollowupRequest)}>Remind</button></>}
          {item.status !== 'draft' && item.crmSyncStatus !== 'linked' && <button type="button" disabled={busy} onClick={() => act(item.id, syncFollowupRequest)}>Retry CRM sync</button>}
          {['source', 'signed', 'certificate', 'audit', 'proof'].filter(kind => kind === 'source' ? item.hasSource : kind === 'signed' ? item.hasSigned : kind === 'certificate' ? item.hasCertificate : kind === 'audit' ? item.hasAudit : item.proofReceived).map(kind => <button key={kind} type="button" onClick={() => downloadFollowupEvidence(item.id, kind).catch(e => setError(e.message))} className="underline">Download {kind}</button>)}
        </div>
      </div>)}
    </div>
  </section>;
}
