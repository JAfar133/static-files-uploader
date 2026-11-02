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

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

// «Урок истории №43» -> «urok-istorii-no43» (то же правило, что на сервере)
function slugify(title) {
  const lat = [...title.normalize('NFC').toLowerCase()].map((c) => TRANSLIT[c] ?? c).join('')
    .normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return lat.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '') || 'site';
}

// Название по умолчанию: имя файла без расширения или имя папки (как есть, с кириллицей и пробелами)
function suggestName(items) {
  if (!items.length) return '';
  if (items.length === 1) return items[0].path.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  const first = items[0].path.split('/');
  return first.length > 1 ? first[0].replace(/[_]+/g, ' ') : '';
}

// ---------- иконки ----------
const paths = {
  open: <><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></>,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></>,
  download: <><path d="M12 4v11" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></>,
  upload: <><path d="M12 16V5" /><path d="M7 9l5-5 5 5" /><path d="M5 19h14" /></>,
  trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" /><path d="M9 7V4h6v3" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  list: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
};
const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths[name]}
  </svg>
);

function IconBtn({ icon, label, onClick, href, download, danger, active, disabled }) {
  const cls = `ibtn${danger ? ' danger' : ''}${active ? ' active' : ''}${disabled ? ' disabled' : ''}`;
  if (icon === 'open' || download) {
    return (
      <a className={cls} href={disabled ? undefined : href} {...(download ? { download: '' } : { target: '_blank', rel: 'noreferrer' })} title={label} aria-label={label}>
        <Icon name={icon} />
      </a>
    );
  }
  return (
    <button className={cls} onClick={onClick} title={label} aria-label={label} disabled={disabled}>
      <Icon name={icon} />
    </button>
  );
}

// ---------- чтение перетащенных папок/файлов ----------
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

function sendUpload({ title, slug, overwrite, items, onProgress }) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('title', title);
    if (slug) fd.append('slug', slug);
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

const isTouch = typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;

const loadView = () => {
  const q = new URLSearchParams(location.search).get('view');
  if (q === 'list' || q === 'grid') return q;
  try { return localStorage.getItem('hub:view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
};

export default function App() {
  const [projects, setProjects] = useState(null);
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [updating, setUpdating] = useState(null); // ссылка (slug) проекта, содержимое которого заменяем
  const [overwrite, setOverwrite] = useState(false);
  const [progress, setProgress] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState(loadView);
  const [renaming, setRenaming] = useState(null); // { name, value }
  const filesInput = useRef(null);
  const dirInput = useRef(null);
  const dropRef = useRef(null);
  const toastTimer = useRef(null);

  const notify = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
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

  const changeView = (v) => {
    setView(v);
    try { localStorage.setItem('hub:view', v); } catch { /* ignore */ }
  };

  const pick = (list) => {
    if (!list.length) return;
    setItems(list);
    if (updating) { setName(titleOf(updating)); setOverwrite(true); }
    else { setName(suggestName(list)); setOverwrite(false); }
  };

  const titleOf = (slug) => (projects || []).find((p) => p.name === slug)?.title || slug;

  const reset = () => { setItems([]); setName(''); setUpdating(null); setOverwrite(false); };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    pick(await fromDrop(e.dataTransfer));
  };

  const submit = async () => {
    setProgress(0);
    try {
      const r = await sendUpload({ title: name.trim(), slug: updating, overwrite, items, onProgress: setProgress });
      notify(
        r.warning ? `Загружено, но: ${r.warning}` : updating ? `Содержимое «${r.title}» обновлено` : `Проект «${r.title}» опубликован`,
        r.warning ? 'err' : 'ok',
      );
      reset();
      load();
    } catch (e) {
      if (e.status === 409) setOverwrite(true);
      notify(e.status === 409 ? `${e.message}. Отметьте «Перезаписать» и повторите` : e.message, 'err');
    } finally {
      setProgress(null);
    }
  };

  const startUpdate = (p) => {
    setItems([]); setName(p.title); setOverwrite(true); setUpdating(p.name);
    dropRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const remove = async (p) => {
    if (!confirm(`Удалить проект «${p.title}» без возможности восстановления?`)) return;
    const r = await fetch(`/api/projects/${encodeURIComponent(p.name)}`, { method: 'DELETE' });
    if (r.ok) { notify(`Проект «${p.title}» удалён`); if (updating === p.name) reset(); load(); }
    else notify('Не удалось удалить', 'err');
  };

  const copy = async (p) => {
    try { await navigator.clipboard.writeText(publicUrl(p)); notify('Ссылка скопирована'); }
    catch { notify('Не удалось скопировать', 'err'); }
  };

  const commitRename = async () => {
    const { name: from, value, title: oldTitle } = renaming;
    const title = value.trim();
    if (!title) { notify('Введите название проекта', 'err'); return; }
    if (title === oldTitle) { setRenaming(null); return; }
    const r = await fetch(`/api/projects/${encodeURIComponent(from)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    });
    const b = await r.json().catch(() => ({}));
    if (r.ok) {
      notify(b.name !== from ? `Переименовано. Новая ссылка: /public/static/${b.name}/` : 'Название изменено');
      if (updating === from) reset();
      setRenaming(null); load();
    } else {
      notify(b.error || 'Не удалось переименовать', 'err');
    }
  };

  const totalSize = items.reduce((s, i) => s + i.file.size, 0);
  const slugPreview = updating || slugify(name.trim());
  const valid = name.trim().length > 0 && [...name.trim()].length <= 100;
  const shown = (projects || []).filter((p) => (p.title + ' ' + p.name).toLowerCase().includes(query.toLowerCase()));

  const nameCell = (p) =>
    renaming?.name === p.name ? (
      <span className="rename">
        <input
          autoFocus value={renaming.value} spellCheck={false}
          onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
        />
        <IconBtn icon="check" label="Сохранить имя" onClick={commitRename} />
        <IconBtn icon="x" label="Отмена" onClick={() => setRenaming(null)} />
      </span>
    ) : (
      <span className="pname" title={p.title}>{p.title}{!p.entry && <span className="badge">нет index.html</span>}</span>
    );

  const actions = (p) => (
    <div className="actions">
      <IconBtn icon="open" label="Открыть в браузере" href={p.entry ? publicUrl(p) : undefined} disabled={!p.entry} />
      <IconBtn icon="copy" label="Копировать ссылку" onClick={() => copy(p)} />
      <IconBtn icon="download" label="Скачать (файл или ZIP-архив)" href={`/api/projects/${encodeURIComponent(p.name)}/download`} download />
      <IconBtn icon="edit" label="Переименовать" onClick={() => setRenaming({ name: p.name, title: p.title, value: p.title })} />
      <IconBtn icon="upload" label="Заменить содержимое" onClick={() => startUpdate(p)} active={updating === p.name} />
      <IconBtn icon="trash" label="Удалить" onClick={() => remove(p)} danger />
    </div>
  );

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
        ref={dropRef}
        className={`drop ${dragging ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {!items.length ? (
          <>
            <div className="drop-icon">{updating ? '🔄' : '⬆️'}</div>
            <h2>{updating ? `Новое содержимое для «${updating}»` : (isTouch ? 'Загрузите сайт' : 'Перетащите сюда файлы, ZIP или папку')}</h2>
            <p className="muted">
              {updating ? 'Текущие файлы проекта будут полностью заменены. Ссылка останется прежней.' : 'HTML-файл, архив .zip или целую папку со статикой'}
            </p>
            <div className="row">
              <button className="btn" onClick={() => filesInput.current.click()}>Файлы / ZIP</button>
              <button className="btn ghost" onClick={() => dirInput.current.click()}>Папка</button>
              {updating && <button className="btn ghost" onClick={reset}>Отмена</button>}
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
              <span>{updating ? 'Проект (содержимое будет заменено)' : 'Название проекта'}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Урок истории" readOnly={!!updating} maxLength={100} />
              {name.trim() && <small className="slugline">Ссылка: <code>/public/static/{slugPreview}/</code></small>}
            </label>
            {!updating && (
              <label className="check">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                Перезаписать, если проект уже есть
              </label>
            )}
            {progress !== null && <div className="bar"><div style={{ width: `${progress}%` }} /></div>}
            <div className="row">
              <button className="btn" disabled={!valid || progress !== null} onClick={submit}>
                {progress !== null ? `Загрузка ${progress}%` : updating ? 'Заменить содержимое' : 'Опубликовать'}
              </button>
              <button className="btn ghost" disabled={progress !== null} onClick={reset}>Отмена</button>
            </div>
          </div>
        )}
        <input ref={filesInput} type="file" multiple hidden onChange={(e) => { pick(fromInput(e.target.files)); e.target.value = ''; }} />
        <input ref={dirInput} type="file" multiple hidden webkitdirectory="" onChange={(e) => { pick(fromInput(e.target.files)); e.target.value = ''; }} />
      </section>

      <section>
        <div className="list-head">
          <h2>Проекты {projects && <span className="count">{projects.length}</span>}</h2>
          <div className="tools">
            <input className="search" placeholder="Поиск…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="seg" role="group" aria-label="Вид списка">
              <IconBtn icon="grid" label="Карточки" onClick={() => changeView('grid')} active={view === 'grid'} />
              <IconBtn icon="list" label="Таблица" onClick={() => changeView('list')} active={view === 'list'} />
            </div>
          </div>
        </div>

        {projects === null && <p className="muted">Загрузка…</p>}
        {projects && !projects.length && <div className="empty">Пока нет проектов. Загрузите первый ☝️</div>}
        {projects && projects.length > 0 && !shown.length && <div className="empty">Ничего не найдено</div>}

        {view === 'grid' ? (
          <div className="grid">
            {shown.map((p) => (
              <article className="card" key={p.name}>
                <div className="card-head">{nameCell(p)}</div>
                <div className="meta">
                  <span>{p.files} файл.</span><span>{fmtSize(p.size)}</span><span>{fmtDate(p.mtime)}</span>
                </div>
                <code className="link">/public/static/{p.name}/</code>
                {actions(p)}
              </article>
            ))}
          </div>
        ) : (
          shown.length > 0 && (
            <div className="table">
              <div className="trow thead">
                <span>Название</span><span className="c-files">Файлов</span><span className="c-size">Размер</span><span className="c-date">Изменён</span><span />
              </div>
              {shown.map((p) => (
                <div className="trow" key={p.name}>
                  <span className="c-name">{nameCell(p)}</span>
                  <span className="c-meta muted">{p.files} файл. · {fmtSize(p.size)} · {fmtDate(p.mtime)}</span>
                  <span className="c-files muted">{p.files}</span>
                  <span className="c-size muted">{fmtSize(p.size)}</span>
                  <span className="c-date muted">{fmtDate(p.mtime)}</span>
                  {actions(p)}
                </div>
              ))}
            </div>
          )
        )}
      </section>

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}
