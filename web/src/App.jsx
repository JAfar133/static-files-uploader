import { useCallback, useEffect, useRef, useState } from 'react';

const publicUrl = (p) =>
  `${location.origin}/public/static/${encodeURIComponent(p.name)}/${p.entry && p.entry !== 'index.html' ? encodeURIComponent(p.entry) : ''}`;

const fmtSize = (b) => {
  if (b < 1024) return `${b} Б`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} КБ`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} МБ`;
  return `${(b / 1024 ** 3).toFixed(2)} ГБ`;
};
const fmtDate = (ms) =>
  new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '').slice(0, 64);

function suggestName(items) {
  if (!items.length) return '';
  if (items.length === 1) return slugify(items[0].path.replace(/\.[^.]+$/, ''));
  const first = items[0].path.split('/');
  return first.length > 1 ? slugify(first[0]) : '';
}

// --- чтение перетащенных папок/файлов ---
async function readEntry(entry, prefix = '') {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    return [{ file, path: prefix + entry.name }];
  }
  const reader = entry.createReader();
  const all = [];
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    all.push(...batch);
  }
  const nested = await Promise.all(all.map((e) => readEntry(e, `${prefix}${entry.name}/`)));
  return nested.flat();
}

async function fromDrop(dt) {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files].map((file) => ({ file, path: file.name }));
  return (await Promise.all(entries.map((e) => readEntry(e)))).flat();
}

const fromInput = (fileList) =>
  [...fileList].map((file) => ({ file, path: file.webkitRelativePath || file.name }));

function sendUpload({ name, overwrite, items, onProgress }) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('overwrite', overwrite ? 'true' : 'false');
    fd.append('paths', JSON.stringify(items.map((i) => i.path)));
    items.forEach((i) => fd.append('files', i.file, i.file.name));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/projects');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(Object.assign(new Error(body.error || `Ошибка ${xhr.status}`), { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error('Сетевая ошибка'));
    xhr.send(fd);
  });
}

export default function App() {
  const [projects, setProjects] = useState(null);
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [progress, setProgress] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState(null);
  const [query, setQuery] = useState('');
  const filesInput = useRef(null);
  const dirInput = useRef(null);

  const notify = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(notify.t);
    notify.t = setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/projects');
      if (!r.ok) throw new Error();
      setProjects(await r.json());
    } catch {
      setProjects([]);
      notify('Не удалось загрузить список проектов', 'err');
    }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const pick = (list) => {
    if (!list.length) return;
    setItems(list);
    setName(suggestName(list));
    setOverwrite(false);
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    pick(await fromDrop(e.dataTransfer));
  };

  const submit = async () => {
    setProgress(0);
    try {
      const r = await sendUpload({ name: name.trim(), overwrite, items, onProgress: setProgress });
      notify(r.warning ? `Загружено, но: ${r.warning}` : `Проект «${r.name}» опубликован`, r.warning ? 'err' : 'ok');
      setItems([]); setName('');
      load();
    } catch (e) {
      if (e.status === 409) setOverwrite(true);
      notify(e.status === 409 ? `${e.message}. Отметьте «Перезаписать» и повторите` : e.message, 'err');
    } finally {
      setProgress(null);
    }
  };

  const remove = async (p) => {
    if (!confirm(`Удалить проект «${p.name}» без возможности восстановления?`)) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(p.name)}`, { method: 'DELETE' });
    if (r.ok) { notify(`Проект «${p.name}» удалён`); load(); } else notify('Не удалось удалить', 'err');
  };

  const copy = async (p) => {
    try { await navigator.clipboard.writeText(publicUrl(p)); notify('Ссылка скопирована'); }
    catch { notify('Не удалось скопировать', 'err'); }
  };

  const totalSize = items.reduce((s, i) => s + i.file.size, 0);
  const valid = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name.trim());
  const shown = (projects || []).filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="app">
      <header className="top">
        <div className="logo">📦</div>
        <div>
          <h1>Static Hub</h1>
          <p>Загрузите сайт — получите ссылку</p>
        </div>
      </header>

      <section
        className={`drop ${dragging ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {!items.length ? (
          <>
            <div className="drop-icon">⬆️</div>
            <h2>Перетащите сюда файлы, ZIP или папку</h2>
            <p className="muted">HTML-файл, архив .zip или целую папку со статикой</p>
            <div className="row">
              <button className="btn" onClick={() => filesInput.current.click()}>Файлы / ZIP</button>
              <button className="btn ghost" onClick={() => dirInput.current.click()}>Папка</button>
            </div>
          </>
        ) : (
          <div className="staged">
            <div className="staged-info">
              <strong>{items.length} {items.length === 1 ? 'файл' : 'файлов'}</strong>
              <span className="muted"> · {fmtSize(totalSize)}</span>
              <ul>
                {items.slice(0, 4).map((i) => <li key={i.path}>{i.path}</li>)}
                {items.length > 4 && <li className="muted">…и ещё {items.length - 4}</li>}
              </ul>
            </div>
            <label className="field">
              <span>Имя проекта (часть ссылки)</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-site" />
              {name && !valid && <small className="err">Только латиница, цифры, . - _</small>}
            </label>
            <label className="check">
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
              Перезаписать, если проект уже есть
            </label>
            {progress !== null && <div className="bar"><div style={{ width: `${progress}%` }} /></div>}
            <div className="row">
              <button className="btn" disabled={!valid || progress !== null} onClick={submit}>
                {progress !== null ? `Загрузка ${progress}%` : 'Опубликовать'}
              </button>
              <button className="btn ghost" disabled={progress !== null} onClick={() => setItems([])}>Отмена</button>
            </div>
          </div>
        )}
        <input ref={filesInput} type="file" multiple hidden onChange={(e) => { pick(fromInput(e.target.files)); e.target.value = ''; }} />
        <input ref={dirInput} type="file" multiple hidden webkitdirectory="" onChange={(e) => { pick(fromInput(e.target.files)); e.target.value = ''; }} />
      </section>

      <section>
        <div className="list-head">
          <h2>Проекты {projects && <span className="count">{projects.length}</span>}</h2>
          <input className="search" placeholder="Поиск…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {projects === null && <p className="muted">Загрузка…</p>}
        {projects && !projects.length && <div className="empty">Пока нет проектов. Загрузите первый ☝️</div>}
        {projects && projects.length > 0 && !shown.length && <div className="empty">Ничего не найдено</div>}

        <div className="grid">
          {shown.map((p) => (
            <article className="card" key={p.name}>
              <div className="card-head">
                <h3 title={p.name}>{p.name}</h3>
                {!p.entry && <span className="badge">нет index.html</span>}
              </div>
              <div className="meta">
                <span>{p.files} файл.</span><span>{fmtSize(p.size)}</span>
                <span>{fmtDate(p.mtime)}</span>
              </div>
              <code className="link">/public/static/{p.name}/</code>
              <div className="row">
                <a className={`btn small ${p.entry ? '' : 'disabled'}`} href={p.entry ? publicUrl(p) : undefined} target="_blank" rel="noreferrer">Открыть ↗</a>
                <button className="btn small ghost" onClick={() => copy(p)}>Копировать</button>
                <button className="btn small danger" onClick={() => remove(p)}>Удалить</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
