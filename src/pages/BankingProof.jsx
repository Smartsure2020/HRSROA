import { useEffect, useMemo, useState } from 'react';

function encode(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(text);
}

export default function BankingProof() {
  const credentials = useMemo(() => {
    const match = window.location.hash.slice(1).match(/^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i);
    return match ? { id: match[1], token: match[2] } : null;
  }, []);
  const [file, setFile] = useState(null);
  const [received, setReceived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!credentials) return;
    fetch(`/api/send-email?operation=followup-proof&id=${encodeURIComponent(credentials.id)}`, {
      headers: { Authorization: `Bearer ${credentials.token}` }, cache: 'no-store',
    }).then(async response => {
      if (!response.ok) throw new Error('This proof link is unavailable.');
      setReceived(Boolean((await response.json()).proofReceived));
    }).catch(e => setError(e.message));
  }, [credentials]);

  async function upload(event) {
    event.preventDefault();
    if (!file || !credentials || busy) return;
    setBusy(true); setError('');
    try {
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
        throw new Error('Select a PDF, JPG or PNG smaller than 5 MB.');
      }
      const fileBase64 = encode(new Uint8Array(await file.arrayBuffer()));
      const response = await fetch('/api/send-email?operation=followup-proof', {
        method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.token}` },
        body: JSON.stringify({ id: credentials.id, fileBase64 }),
      });
      if (!response.ok) throw new Error('Upload failed. Please retry, or finish without proof.');
      setReceived(Boolean((await response.json()).proofReceived));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-background flex items-center justify-center p-5">
    <div className="max-w-lg w-full bg-white border rounded-xl p-6 space-y-4">
      <h1 className="font-heading text-xl text-hrs-blue">Banking proof</h1>
      <p className="text-sm">Thank you for signing your Banking Details Confirmation. You may attach a bank confirmation letter or other proof. This step is optional.</p>
      {!credentials ? <p role="alert" className="text-red-700 text-sm">This upload link is invalid. Contact your broker for help.</p> : received ?
        <p className="text-green-700 text-sm font-semibold">Proof received. You can close this page.</p> :
        <form onSubmit={upload} className="space-y-3">
          <label className="block text-sm">Proof PDF, JPG or PNG
            <input className="block mt-1 w-full" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={event => setFile(event.target.files?.[0] || null)} />
          </label>
          <button type="submit" disabled={!file || busy} className="px-4 py-2 rounded bg-hrs-blue text-white text-sm disabled:opacity-50">{busy ? 'Uploading…' : 'Upload proof'}</button>
          <p className="text-sm text-hrs-muted">You can close this page without attaching proof.</p>
        </form>}
      {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
    </div>
  </main>;
}
