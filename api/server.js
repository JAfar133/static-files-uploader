import express from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.env.STATIC_DIR || '/sites/static';
const STAGING = process.env.STAGING_DIR || '/sites/.staging';
const INCOMING = path.join(STAGING, 'incoming');
const MAX_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 500) * 1024 * 1024;
const MAX_UNZIPPED = MAX_BYTES * 2;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const JUNK = new Set(['__MACOSX', '.DS_Store', 'Thumbs.db']);
// Читаемые названия проектов лежат отдельно от статики (не раздаются наружу)
const META = process.env.META_DIR || path.join(path.dirname(ROOT), 'meta');

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

// «Урок истории №43» -> «urok-istorii-43»
function slugify(title) {
  const lat = [...String(title).normalize('NFC').toLowerCase()]
    .map((c) => TRANSLIT[c] ?? c).join('')
    .normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const slug = lat.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
  return slug || 'site';
}

function cleanTitle(raw) {
  const t = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) throw new HttpError(400, 'Введите название проекта');
  if ([...t].length > 100) throw new HttpError(400, 'Название слишком длинное (до 100 символов)');
  return t;
}

const metaFile = (slug) => path.join(META, `${slug}.json`);
async function readMeta(slug) {
  try { return JSON.parse(await fs.readFile(metaFile(slug), 'utf8')); } catch { return {}; }
}
const writeMeta = (slug, data) => fs.writeFile(metaFile(slug), JSON.stringify(data));

await fs.mkdir(ROOT, { recursive: true });
await fs.mkdir(INCOMING, { recursive: true });
await fs.mkdir(META, { recursive: true });

const upload = multer({
  dest: INCOMING,
  limits: { fileSize: MAX_BYTES, files: 5000, fields: 20 },
});

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Безопасный относительный путь: без "..", абсолютных путей и мусора
function safeRel(p) {
  const parts = String(p).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  if (parts.some((s) => s === '..')) throw new HttpError(400, `Недопустимый путь: ${p}`);
  if (parts.some((s) => JUNK.has(s))) return null;
  return parts.length ? parts.join('/') : null;
}

const exists = (p) => fs.access(p).then(() => true, () => false);

async function writeInto(stage, rel, data) {
  const dest = path.join(stage, rel);
  if (!dest.startsWith(stage + path.sep)) throw new HttpError(400, 'Недопустимый путь');
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (Buffer.isBuffer(data)) await fs.writeFile(dest, data);
  else await fs.copyFile(data, dest);
}

async function extractZip(stage, zipPath) {
  let zip;
  try { zip = new AdmZip(zipPath); } catch { throw new HttpError(400, 'Не удалось прочитать ZIP-архив'); }
  let total = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const rel = safeRel(e.entryName);
    if (!rel) continue;
    const data = e.getData();
    total += data.length;
    if (total > MAX_UNZIPPED) throw new HttpError(413, 'Архив слишком большой после распаковки');
    await writeInto(stage, rel, data);
  }
}

// Если всё лежит в одной вложенной папке без index.html в корне — берём её как корень
async function resolveRoot(stage) {
  let cur = stage;
  for (;;) {
    if (await exists(path.join(cur, 'index.html'))) return cur;
    const items = await fs.readdir(cur, { withFileTypes: true });
    if (items.length === 1 && items[0].isDirectory()) cur = path.join(cur, items[0].name);
    else return cur;
  }
}

async function inspect(dir) {
  let size = 0, files = 0, mtime = 0, firstHtml = null;
  async function walk(d, depth) {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile()) {
        const st = await fs.stat(full);
        size += st.size; files++; mtime = Math.max(mtime, st.mtimeMs);
        if (depth === 0 && !firstHtml && /\.html?$/i.test(e.name)) firstHtml = e.name;
      }
    }
  }
  await walk(dir, 0);
  const entry = (await exists(path.join(dir, 'index.html'))) ? 'index.html' : firstHtml;
  return { size, files, mtime, entry };
}

const app = express();

app.get('/api/projects', async (_req, res, next) => {
  try {
    const dirs = (await fs.readdir(ROOT, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'));
    const list = await Promise.all(dirs.map(async (d) => ({
      name: d.name, title: (await readMeta(d.name)).title || d.name, ...(await inspect(path.join(ROOT, d.name))),
    })));
    list.sort((a, b) => b.mtime - a.mtime);
    res.json(list);
  } catch (e) { next(e); }
});

app.post('/api/projects', upload.array('files'), async (req, res, next) => {
  const files = req.files || [];
  const stage = path.join(STAGING, crypto.randomBytes(8).toString('hex'));
  try {
    const title = cleanTitle(req.body.title ?? req.body.name);
    // slug (ссылка): явно заданный существующий проект либо транслит названия
    const name = NAME_RE.test(String(req.body.slug || '')) ? String(req.body.slug) : slugify(title);
    if (!files.length) throw new HttpError(400, 'Нет файлов для загрузки');

    const target = path.join(ROOT, name);
    const overwrite = req.body.overwrite === 'true';
    if ((await exists(target)) && !overwrite) throw new HttpError(409, `Проект со ссылкой «${name}» уже существует`);

    let paths = [];
    try { paths = JSON.parse(req.body.paths || '[]'); } catch { /* ignore */ }
    await fs.mkdir(stage, { recursive: true });

    const isSingleZip = files.length === 1 && /\.zip$/i.test(paths[0] || files[0].originalname);
    if (isSingleZip) {
      await extractZip(stage, files[0].path);
    } else {
      for (let i = 0; i < files.length; i++) {
        let rel = safeRel(paths[i] || files[i].originalname);
        if (!rel) continue;
        // одиночный html-файл становится index.html
        if (files.length === 1 && /\.html?$/i.test(rel)) rel = 'index.html';
        await writeInto(stage, rel, files[i].path);
      }
    }

    const src = await resolveRoot(stage);
    const info = await inspect(src);
    if (!info.files) throw new HttpError(400, 'Архив/папка пусты');

    if (await exists(target)) {
      const old = path.join(STAGING, 'old-' + crypto.randomBytes(6).toString('hex'));
      await fs.rename(target, old);
      await fs.rename(src, target);
      await fs.rm(old, { recursive: true, force: true });
    } else {
      await fs.rename(src, target);
    }
    await fs.chmod(target, 0o755);
    await writeMeta(name, { title });
    res.status(201).json({ name, title, ...(await inspect(target)), warning: info.entry ? null : 'В проекте нет index.html' });
  } catch (e) { next(e); }
  finally {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
    await Promise.all(files.map((f) => fs.rm(f.path, { force: true }).catch(() => {})));
  }
});

// Переименование: меняется название; ссылка пересчитывается из названия (если транслит изменился)
app.patch('/api/projects/:name', express.json(), async (req, res, next) => {
  try {
    const from = req.params.name;
    if (!NAME_RE.test(from)) throw new HttpError(400, 'Неверное имя');
    const title = cleanTitle(req.body?.title ?? req.body?.name);
    const src = path.join(ROOT, from);
    if (!(await exists(src))) throw new HttpError(404, 'Проект не найден');
    const oldTitle = (await readMeta(from)).title || from;
    let to = slugify(title);
    if (to === slugify(oldTitle)) to = from; // правка регистра/пробелов не ломает ссылку
    if (to !== from) {
      const dst = path.join(ROOT, to);
      if (await exists(dst)) throw new HttpError(409, `Проект со ссылкой «${to}» уже существует`);
      await fs.rename(src, dst);
      await fs.rm(metaFile(from), { force: true });
    }
    await writeMeta(to, { title });
    res.json({ name: to, title, ...(await inspect(path.join(ROOT, to))) });
  } catch (e) { next(e); }
});

app.delete('/api/projects/:name', async (req, res, next) => {
  try {
    if (!NAME_RE.test(req.params.name)) throw new HttpError(400, 'Неверное имя');
    const target = path.join(ROOT, req.params.name);
    if (!(await exists(target))) throw new HttpError(404, 'Проект не найден');
    await fs.rm(target, { recursive: true, force: true });
    await fs.rm(metaFile(req.params.name), { force: true });
    res.status(204).end();
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  let status = err.status || 500;
  let message = err.message;
  if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? `Файл больше ${MAX_BYTES / 1024 / 1024} МБ` : err.message;
  }
  if (status === 500) { console.error(err); message = 'Внутренняя ошибка сервера'; }
  res.status(status).json({ error: message });
});

app.listen(3000, () => console.log('API listening on :3000'));
