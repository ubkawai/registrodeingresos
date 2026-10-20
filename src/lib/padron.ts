// ================== Lista de invitados (padrón) ==================
// Se sube un Excel, CSV o PDF y se extraen pares DNI + nombre. Al escanear,
// cada DNI se marca como "en lista" (check verde) o "fuera de lista" (X roja).

export type PersonaPadron = { dni: string; nombre: string };

export type Padron = { personas: PersonaPadron[]; archivo: string };

type Cell = string | number | boolean | Date | null | undefined;

// Excel guarda los DNI como número y pierde el 0 inicial: 01234567 -> 1234567
const normDni = (v: Cell): string | null => {
  if (typeof v === "number") {
    return Number.isInteger(v) && v >= 1_000_000 && v <= 99_999_999
      ? String(v).padStart(8, "0")
      : null;
  }
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/[\s.-]/g, "");
  return /^\d{7,8}$/.test(s) ? s.padStart(8, "0") : null;
};

const cleanName = (s: string) =>
  s
    .replace(/\d+/g, " ")
    .replace(/[|;,_*#°º"()[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-.\s]+|[-.\s]+$/g, "");

const textCell = (v: Cell) => (typeof v === "string" ? v.trim() : "");

const DNI_HEADER = /\b(dni|documento|doc|n[°º.]?\s*doc|nro\.?\s*doc)/i;
const NAME_HEADER = /nombre|apellido/i;

const dedupe = (personas: PersonaPadron[]) => {
  const seen = new Map<string, PersonaPadron>();
  for (const p of personas) {
    const prev = seen.get(p.dni);
    if (!prev || (!prev.nombre && p.nombre)) seen.set(p.dni, p);
  }
  return [...seen.values()];
};

// ---------- Tablas (Excel / CSV) ----------
const parseRows = (rows: Cell[][]): PersonaPadron[] => {
  const width = Math.max(0, ...rows.map((r) => r.length));

  // 1) Fila de encabezados con una columna "DNI"
  let start = 0;
  let dniCol = -1;
  let nameCols: number[] = [];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const idx = rows[i].findIndex((c) => DNI_HEADER.test(textCell(c)));
    if (idx >= 0) {
      start = i + 1;
      dniCol = idx;
      nameCols = rows[i]
        .map((c, j) => (j !== idx && NAME_HEADER.test(textCell(c)) ? j : -1))
        .filter((j) => j >= 0);
      break;
    }
  }

  // 2) Sin encabezados: la columna con más valores que parecen DNI
  if (dniCol < 0) {
    let best = 0;
    for (let j = 0; j < width; j++) {
      const hits = rows.filter((r) => normDni(r[j])).length;
      if (hits > best) {
        best = hits;
        dniCol = j;
      }
    }
    if (dniCol < 0) return [];
  }

  const personas: PersonaPadron[] = [];
  for (const row of rows.slice(start)) {
    const dni = normDni(row[dniCol]);
    if (!dni) continue;
    const parts = nameCols.length
      ? nameCols.map((j) => textCell(row[j]))
      : row.map((c, j) => (j !== dniCol && /[a-záéíóúñ]/i.test(textCell(c)) ? textCell(c) : ""));
    personas.push({ dni, nombre: cleanName(parts.filter(Boolean).join(" ")) });
  }
  return personas;
};

const parseCsv = (text: string): Cell[][] => {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const first = lines[0] ?? "";
  const sep = [";", "\t", ","].reduce((a, b) =>
    first.split(b).length > first.split(a).length ? b : a
  );
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (ch === sep && !quoted) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  });
};

// ---------- PDF ----------
// Se reconstruyen las líneas por su posición vertical y en cada línea se
// busca un número de 8 dígitos; el resto del texto es el nombre.
const parsePdf = async (file: File): Promise<PersonaPadron[]> => {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const personas: PersonaPadron[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    const lines: { y: number; items: { x: number; str: string }[] }[] = [];
    for (const it of content.items as any[]) {
      if (!it.str?.trim()) continue;
      const [x, y] = [it.transform[4], it.transform[5]];
      let line = lines.find((l) => Math.abs(l.y - y) < 3);
      if (!line) lines.push((line = { y, items: [] }));
      line.items.push({ x, str: it.str });
    }

    lines.sort((a, b) => b.y - a.y);
    for (const line of lines) {
      const text = line.items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str)
        .join(" ");
      const dnis = text.match(/(?<!\d)\d{8}(?!\d)/g);
      if (!dnis) continue;
      const nombre = dnis.length === 1 ? cleanName(text.replace(dnis[0], " ")) : "";
      for (const dni of dnis) personas.push({ dni, nombre });
    }
  }
  return personas;
};

export const parsePadronFile = async (file: File): Promise<Padron> => {
  const name = file.name.toLowerCase();
  let personas: PersonaPadron[];

  if (name.endsWith(".pdf")) {
    personas = await parsePdf(file);
  } else if (name.endsWith(".csv") || name.endsWith(".txt")) {
    personas = parseRows(parseCsv(await file.text()));
  } else if (name.endsWith(".xlsx")) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    const sheets = await readXlsxFile(file);
    personas = sheets.flatMap((s) => parseRows(s.data as Cell[][]));
  } else if (name.endsWith(".xls")) {
    throw new Error('Formato .xls antiguo: ábrelo en Excel y guárdalo como .xlsx');
  } else {
    throw new Error("Formato no soportado. Usa Excel (.xlsx), CSV o PDF");
  }

  return { personas: dedupe(personas), archivo: file.name };
};
