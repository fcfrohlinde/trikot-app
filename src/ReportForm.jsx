import { useState, useEffect, useRef } from 'react';

const REASONS = [
  { id: 'verloren', label: 'Verloren', photoRequired: false },
  { id: 'verschlissen', label: 'Verschlissen', photoRequired: true },
  { id: 'flock_kaputt', label: 'Flock kaputt', photoRequired: true },
  { id: 'beschaedigt', label: 'Beschädigt', photoRequired: true },
];

const PHOTO_REQUIRED_REASONS = REASONS.filter(r => r.photoRequired).map(r => r.id);

// Komprimiert ein Foto im Browser auf max. 1280px, JPEG-Qualität 0.7
async function compressImage(file, maxDim = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) {
            height = Math.round(height * (maxDim / width));
            width = maxDim;
          } else {
            width = Math.round(width * (maxDim / height));
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ReportForm({ onBack }) {
  const [info, setInfo] = useState(null);
  const [team, setTeam] = useState('');
  const [number, setNumber] = useState('');
  const [item, setItem] = useState('');
  const [reasons, setReasons] = useState([]);
  const [comment, setComment] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoSize, setPhotoSize] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const fileInputRef = useRef(null);

  // Person-Lookup: wird befüllt sobald team + number gesetzt sind
  // null = noch nicht gesucht, undefined = nicht gefunden, { name, role } = identifiziert
  const [lookupPerson, setLookupPerson] = useState(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  useEffect(() => {
    fetch('/api/public/info')
      .then(r => r.json())
      .then(d => {
        setInfo(d);
        if (d.teams?.length) setTeam(d.teams[0]);
        if (d.items?.length) setItem(d.items[0].id);
      })
      .catch(() => setError('Stammdaten konnten nicht geladen werden.'));
  }, []);

  // Bei jedem Team-/Nummer-Wechsel: Person nachschlagen (debounced)
  useEffect(() => {
    if (!team || !number || String(number).trim() === '') {
      setLookupPerson(null);
      return;
    }
    let cancelled = false;
    setLookupBusy(true);
    const timer = setTimeout(() => {
      fetch(`/api/public/info?team=${encodeURIComponent(team)}&number=${encodeURIComponent(number)}`)
        .then(r => r.json())
        .then(d => {
          if (cancelled) return;
          // d.person ist null, wenn nichts gefunden — dann setzen wir undefined als
          // Marker für "gesucht aber nicht gefunden", damit die UI das unterscheidet
          // vom initialen "noch nichts eingegeben" (null).
          setLookupPerson(d.person || undefined);
          setLookupBusy(false);
        })
        .catch(() => {
          if (cancelled) return;
          setLookupPerson(null);
          setLookupBusy(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [team, number]);

  function toggleReason(id) {
    setReasons(reasons.includes(id) ? reasons.filter(r => r !== id) : [...reasons, id]);
  }

  async function handlePhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/')) {
      setError('Bitte ein Bild auswählen.');
      return;
    }
    setPhotoBusy(true);
    try {
      // Mehrstufige Komprimierung — Ziel max ~500 KB Base64, damit es sicher in Vercel KV passt
      let compressed = await compressImage(file, 1280, 0.7);
      let sizeKb = Math.round((compressed.length * 0.75) / 1024);

      if (sizeKb > 500) {
        compressed = await compressImage(file, 1024, 0.6);
        sizeKb = Math.round((compressed.length * 0.75) / 1024);
      }
      if (sizeKb > 500) {
        compressed = await compressImage(file, 800, 0.5);
        sizeKb = Math.round((compressed.length * 0.75) / 1024);
      }
      if (sizeKb > 500) {
        compressed = await compressImage(file, 640, 0.45);
        sizeKb = Math.round((compressed.length * 0.75) / 1024);
      }

      setPhoto(compressed);
      setPhotoSize(sizeKb);
    } catch (e) {
      setError('Bild konnte nicht verarbeitet werden.');
    }
    setPhotoBusy(false);
  }

  function removePhoto() {
    setPhoto(null);
    setPhotoSize(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // Foto ist bei diesen Gründen Pflicht — wir prüfen das clientseitig vorab,
  // damit der Nutzer nicht erst submitten muss, um die Fehlermeldung zu sehen.
  const photoRequired = reasons.some(r => PHOTO_REQUIRED_REASONS.includes(r));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (!team || !number) {
      setError('Bitte Mannschaft und Nummer/Initialen ausfüllen.');
      return;
    }
    if (lookupPerson === undefined) {
      setError('Es konnte keine Person zur Mannschaft mit dieser Nummer/Initialen gefunden werden. Bitte prüfe deine Eingabe.');
      return;
    }
    if (!lookupPerson) {
      // Lookup hat noch nicht gelaufen oder wartet — kurz Geduld
      setError('Person wird noch identifiziert, bitte einen Moment warten.');
      return;
    }
    if (reasons.length === 0) {
      setError('Bitte mindestens einen Grund auswählen.');
      return;
    }
    if (photoRequired && !photo) {
      setError('Bei „verschlissen", „Flock kaputt" oder „beschädigt" ist ein Foto Pflicht. Bitte ein Bild des Teils hochladen.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/public/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Der Name kommt jetzt automatisch vom Backend-Lookup —
        // wir senden ihn trotzdem mit, damit bei späteren Kader-Änderungen
        // der ursprüngliche Name in der Meldung erhalten bleibt.
        body: JSON.stringify({ team, number, item, reasons, comment, name: lookupPerson.name, photo }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Meldung fehlgeschlagen');
      setDone(true);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  function newReport() {
    setNumber('');
    setReasons([]);
    setComment('');
    setPhoto(null);
    setPhotoSize(0);
    setLookupPerson(null);
    setDone(false);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="min-h-screen p-4 flex items-center justify-center" style={{ background: '#F8F5F0' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700;800&family=Bebas+Neue&family=Source+Sans+3:wght@300;400;500;600;700&display=swap');
      `}</style>
      <div className="w-full max-w-lg" style={{ fontFamily: "'Source Sans 3', sans-serif" }}>
        <div className="text-center mb-6">
          <img
            src="/fcf-logo.png?v=2"
            alt="FC Frohlinde 1949 e.V."
            width="80"
            height="80"
            className="mx-auto mb-4"
            style={{ width: 80, height: 80, objectFit: 'contain' }}
          />
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 12, letterSpacing: '0.18em', color: '#0B2D5C' }}>
            {info?.clubName || 'F. C. FROHLINDE 1949 e. V.'}
          </div>
          <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 40, color: '#1A1A1A', lineHeight: 1.1, marginTop: 8 }}>
            Bedarfsmeldung
          </h1>
          <div className="flex items-center justify-center gap-3 mt-3">
            <div className="h-px w-12" style={{ background: '#DCD6C8' }} />
            <p style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: '0.18em', color: '#807D78' }}>
              FÜR SPIELER · OHNE LOGIN
            </p>
            <div className="h-px w-12" style={{ background: '#DCD6C8' }} />
          </div>
        </div>

        {done ? (
          <div className="bg-white p-7 text-center" style={{ border: '2px solid #4A6B3A' }}>
            <div style={{ fontSize: 48, color: '#4A6B3A' }}>✓</div>
            <h2 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 24, color: '#1A1A1A', marginTop: 8 }}>
              Vielen Dank!
            </h2>
            <p style={{ color: '#4A4845', fontSize: 14, marginTop: 8 }}>
              Deine Meldung wurde übermittelt. Der Zeugwart kümmert sich darum.
            </p>
            <div className="flex gap-2 justify-center mt-5">
              <button onClick={newReport} className="px-5 py-2 text-xs uppercase text-white" style={{ background: '#0B2D5C', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                Weitere Meldung
              </button>
              <button onClick={onBack} className="px-5 py-2 text-xs uppercase" style={{ border: '1px solid #DCD6C8', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                Zurück
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white p-7 space-y-4" style={{ border: '1px solid #DCD6C8' }}>
            <div className="p-3 text-xs" style={{ background: '#F1ECDF', color: '#4A4845', borderLeft: '3px solid #0B2D5C' }}>
              Pro Artikel eine Meldung. Mehrere defekte Teile? Einfach mehrere Meldungen abgeben.
            </div>

            <Field label="Mannschaft">
              <select required className="w-full px-3 py-2 text-sm" style={{ border: '1px solid #DCD6C8', background: '#FCFAF6' }} value={team} onChange={e => setTeam(e.target.value)}>
                <option value="">– wählen –</option>
                {info?.teams?.map(t => <option key={t}>{t}</option>)}
              </select>
            </Field>

            <Field label="Rückennummer (Spieler) oder Initialen (Trainer)">
              <input
                required
                type="text"
                inputMode="text"
                maxLength={3}
                placeholder="z.B. 7 oder DW"
                className="w-full px-3 py-2 text-sm"
                style={{ border: '1px solid #DCD6C8', background: '#FCFAF6' }}
                value={number}
                onChange={e => setNumber(e.target.value)}
              />
            </Field>

            <Field label="Artikel">
              <select required className="w-full px-3 py-2 text-sm" style={{ border: '1px solid #DCD6C8', background: '#FCFAF6' }} value={item} onChange={e => setItem(e.target.value)}>
                <option value="">– wählen –</option>
                {info?.items?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Field>

            <Field label="Grund (mind. einer)">
              <div className="grid grid-cols-2 gap-2">
                {REASONS.map(r => {
                  const active = reasons.includes(r.id);
                  return (
                    <label key={r.id}
                      className="flex items-center gap-2 p-3 cursor-pointer text-sm"
                      style={{
                        border: active ? '2px solid #0B2D5C' : '1px solid #DCD6C8',
                        background: active ? '#F1ECDF' : '#FCFAF6',
                      }}>
                      <input type="checkbox" checked={active} onChange={() => toggleReason(r.id)} />
                      <span style={{ color: '#1A1A1A' }}>
                        {r.label}
                        {r.photoRequired && <span title="Foto-Beleg Pflicht" style={{ marginLeft: 4, color: '#9A2828' }}>📷*</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs mt-1" style={{ color: '#807D78' }}>* bei diesen Gründen ist ein Foto Pflicht.</p>
            </Field>

            <Field label="Anmerkung (optional)">
              <textarea className="w-full px-3 py-2 text-sm" rows="2" style={{ border: '1px solid #DCD6C8', background: '#FCFAF6' }} value={comment} onChange={e => setComment(e.target.value)} placeholder="z. B. wo der Schaden ist" />
            </Field>

            <Field label={photoRequired ? 'Foto (Pflicht!)' : 'Foto (optional)'}>
              {photo ? (
                <div className="space-y-2">
                  <div className="relative" style={{ border: '1px solid #DCD6C8', background: '#FCFAF6', padding: 8 }}>
                    <img src={photo} alt="Vorschau" style={{ width: '100%', maxHeight: 240, objectFit: 'contain' }} />
                    <div className="text-xs mt-2 flex justify-between" style={{ color: '#807D78' }}>
                      <span>Bild bereit · {photoSize} KB</span>
                      <button type="button" onClick={removePhoto} className="hover:underline" style={{ color: '#9A2828' }}>Entfernen</button>
                    </div>
                  </div>
                </div>
              ) : (
                <label className="block cursor-pointer text-center py-6"
                  style={{
                    border: photoRequired ? '2px dashed #9A2828' : '1px dashed #DCD6C8',
                    background: photoRequired ? '#FFF3F3' : '#FCFAF6',
                    color: '#807D78',
                  }}>
                  <div style={{ fontSize: 24, marginBottom: 4 }}>📷</div>
                  <div className="text-sm" style={{ color: photoRequired ? '#9A2828' : '#807D78', fontWeight: photoRequired ? 600 : 400 }}>
                    {photoBusy ? 'Bild wird komprimiert...' : (photoRequired ? 'Foto-Beleg erforderlich – jetzt fotografieren' : 'Foto auswählen oder fotografieren')}
                  </div>
                  <div className="text-xs mt-1" style={{ color: '#9C9892' }}>Wird automatisch verkleinert</div>
                  <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
                </label>
              )}
            </Field>

            <Field label="Dein Name">
              {!team || !number ? (
                <div className="px-3 py-2 text-sm" style={{ background: '#FCFAF6', border: '1px dashed #DCD6C8', color: '#9C9892' }}>
                  Wähle Mannschaft und gib deine Nummer/Initialen ein — der Name wird automatisch eingetragen.
                </div>
              ) : lookupBusy ? (
                <div className="px-3 py-2 text-sm" style={{ background: '#FCFAF6', border: '1px solid #DCD6C8', color: '#807D78' }}>
                  Suche Person…
                </div>
              ) : lookupPerson ? (
                <div className="px-3 py-2 text-sm" style={{ background: '#F1ECDF', border: '2px solid #0B2D5C', color: '#0B2D5C', fontWeight: 600 }}>
                  ✓ {lookupPerson.name}
                  {lookupPerson.role === 'coach' && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5"
                      style={{ background: '#0B2D5C', color: '#C9A227', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.12em', verticalAlign: 'middle' }}>
                      TRAINER
                    </span>
                  )}
                </div>
              ) : (
                <div className="px-3 py-2 text-sm" style={{ background: '#FFF3F3', border: '2px solid #9A2828', color: '#9A2828' }}>
                  ⚠ Keine Person mit dieser Nummer in „{team}" gefunden. Prüfe Mannschaft und Nummer/Initialen.
                </div>
              )}
            </Field>

            {error && (
              <div className="text-sm p-3" style={{ background: '#F5E6E6', color: '#9A2828', borderLeft: '3px solid #9A2828' }}>{error}</div>
            )}

            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={busy || !lookupPerson} className="flex-1 py-3 text-xs uppercase text-white disabled:opacity-50" style={{ background: '#0B2D5C', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                {busy ? '...' : 'Meldung absenden'}
              </button>
              <button type="button" onClick={onBack} className="px-5 py-3 text-xs uppercase" style={{ border: '1px solid #DCD6C8', fontFamily: "'Bebas Neue', sans-serif", letterSpacing: '0.15em' }}>
                Zurück
              </button>
            </div>
          </form>
        )}

        <div className="text-center mt-6 text-xs" style={{ color: '#807D78' }}>
          Bleibt sportlich.
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 11, letterSpacing: '0.18em', color: '#0B2D5C', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </label>
  );
}
