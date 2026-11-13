// Importar desde la planilla (formato Finanzas_Personales_v1.04 o el boceto original)
// y exportar un respaldo. SheetJS se carga desde su CDN solo cuando se usa.
// El archivo se lee en el navegador: nunca se sube a GitHub ni a otro servidor.

const XLSX_URL = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
let XLSX = null;

async function cargarXLSX() {
  if (!XLSX) XLSX = await import(XLSX_URL);
  return XLSX;
}

// ---------- Lectura (parte pura, probada con node) ----------

const texto = v => (v == null ? "" : String(v).trim());
const normal = v => texto(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Fecha de Excel (número de serie, Date o texto "dd/mm/aaaa") -> "AAAA-MM-DD"
export function fechaDeExcel(v) {
  if (typeof v === "number" && v > 0) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  }
  if (v instanceof Date && !isNaN(v)) {
    const z = n => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${z(v.getMonth() + 1)}-${z(v.getDate())}`;
  }
  const s = texto(v);
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

function numero(v) {
  if (typeof v === "number") return Math.round(v);
  const s = texto(v).replace(/[$\s.]/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(s) ? Math.round(Number(s)) : null;
}

function buscarHoja(hojas, ...nombres) {
  const claves = Object.keys(hojas);
  for (const n of nombres) {
    const k = claves.find(c => normal(c) === normal(n));
    if (k) return hojas[k];
  }
  return null;
}

// Índice de la fila cuyo primer valor es `titulo` (por ejemplo "Fecha")
function filaEncabezado(filas, titulo, col = 0) {
  return filas.findIndex(f => normal(f?.[col]) === normal(titulo));
}

function leerRegistros(filas, columnas) {
  const h = filaEncabezado(filas, "Fecha");
  if (h < 0) return { registros: [], omitidas: 0 };
  const cab = filas[h].map(normal);
  const idx = Object.fromEntries(Object.entries(columnas).map(([clave, titulos]) => [clave, cab.findIndex(c => titulos.map(normal).includes(c))]));
  const registros = [];
  let omitidas = 0;
  for (const f of filas.slice(h + 1)) {
    if (!f || f.every(v => texto(v) === "")) continue;
    const get = k => (idx[k] >= 0 ? f[idx[k]] : null);
    const fecha = fechaDeExcel(get("fecha"));
    const monto = numero(get("monto"));
    if (!fecha || monto == null) { omitidas++; continue; }
    const r = { fecha, monto };
    for (const k of Object.keys(columnas)) if (!(k in r)) r[k] = texto(get(k));
    registros.push(r);
  }
  return { registros, omitidas };
}

function columna(filas, desde, col) {
  const out = [];
  for (const f of filas.slice(desde)) {
    const v = texto(f?.[col]);
    if (v) out.push(v);
  }
  return out;
}

// Mayúscula inicial ("alcohol" -> "Alcohol"), para no duplicar categorías por mayúsculas
const capitalizar = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Une una lista con los valores usados en los registros sin duplicar por mayúsculas
// ("efectivo" y "Efectivo" quedan como uno solo) y corrige el valor en cada registro.
function unir(lista, registros, campo) {
  const canon = new Map();
  for (const v of lista.map(capitalizar)) if (!canon.has(normal(v))) canon.set(normal(v), v);
  for (const r of registros) {
    if (!r[campo]) continue;
    const k = normal(r[campo]);
    if (!canon.has(k)) canon.set(k, capitalizar(r[campo]));
    r[campo] = canon.get(k);
  }
  return [...canon.values()];
}

// hojas: { nombreHoja: filas[][] } con valores crudos (números de serie para fechas)
export function interpretarLibro(hojas) {
  const avisos = [];
  const gastosH = buscarHoja(hojas, "Gastos");
  const ingresosH = buscarHoja(hojas, "Ingresos");
  const confH = buscarHoja(hojas, "Configuración", "Configuracion", "Categorías", "Categorias");
  if (!gastosH) throw new Error("El archivo no tiene una hoja llamada Gastos.");

  const g = leerRegistros(gastosH, {
    fecha: ["Fecha"], categoria: ["Categoría", "Categoria"], descripcion: ["Descripción", "Descripcion"],
    monto: ["Monto"], pago: ["Forma de pago"], comentario: ["Comentario"]
  });
  const i = ingresosH ? leerRegistros(ingresosH, {
    fecha: ["Fecha"], fuente: ["Fuente"], descripcion: ["Descripción", "Descripcion"], monto: ["Monto"], comentario: ["Comentario"]
  }) : { registros: [], omitidas: 0 };
  if (g.omitidas) avisos.push(`${g.omitidas} fila(s) de Gastos sin fecha o monto válidos no se importaron.`);
  if (i.omitidas) avisos.push(`${i.omitidas} fila(s) de Ingresos sin fecha o monto válidos no se importaron.`);

  let categorias = [], fuentes = [], pagos = [], periodos = [];
  if (confH) {
    const h = filaEncabezado(confH, "Categorías de gasto") >= 0 ? filaEncabezado(confH, "Categorías de gasto") : filaEncabezado(confH, "Categorías de gastos");
    if (h >= 0) {
      categorias = columna(confH, h + 1, 0);
      fuentes = columna(confH, h + 1, 1);
      pagos = columna(confH, h + 1, 2);
      const cab = confH[h].map(normal);
      const cp = cab.findIndex(c => c === normal("Nombre del período"));
      if (cp >= 0) {
        for (const f of confH.slice(h + 1)) {
          const nombre = texto(f?.[cp]);
          const desde = fechaDeExcel(f?.[cp + 1]);
          const hasta = fechaDeExcel(f?.[cp + 2]);
          if (nombre && desde && hasta) periodos.push({ nombre, desde, hasta });
        }
      }
    }
  }

  // Normaliza mayúsculas de categorías en listas y registros
  const canon = new Map();
  for (const c of categorias.map(capitalizar)) if (!canon.has(normal(c))) canon.set(normal(c), c);
  for (const r of g.registros) {
    if (!r.categoria) continue;
    const k = normal(r.categoria);
    if (!canon.has(k)) canon.set(k, capitalizar(r.categoria));
    r.categoria = canon.get(k);
  }
  categorias = [...canon.values()];
  fuentes = unir(fuentes, i.registros, "fuente");
  pagos = unir(pagos, g.registros, "pago");

  // Sin períodos en el archivo (boceto original): un período por mes calendario con gastos o ingresos
  if (!periodos.length) {
    const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    const meses = [...new Set([...g.registros, ...i.registros].map(r => r.fecha.slice(0, 7)))].sort();
    periodos = meses.map(m => {
      const [y, mo] = m.split("-").map(Number);
      return { nombre: MESES[mo - 1], desde: `${m}-01`, hasta: new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10) };
    });
    if (periodos.length) avisos.push("El archivo no tenía períodos: se creó uno por cada mes con movimientos.");
  }

  return { gastos: g.registros, ingresos: i.registros, categorias, fuentes, pagos, periodos, avisos };
}

// ---------- Lectura y escritura con SheetJS (navegador) ----------

export async function leerArchivo(archivo) {
  const X = await cargarXLSX();
  const libro = X.read(await archivo.arrayBuffer(), { type: "array" });
  const hojas = {};
  for (const n of libro.SheetNames) {
    hojas[n] = X.utils.sheet_to_json(libro.Sheets[n], { header: 1, raw: true, defval: null, blankrows: true });
  }
  return interpretarLibro(hojas);
}

// Respaldo completo en .xlsx (incluye lo que está en la papelera, marcado)
export async function exportarRespaldo({ gastos, ingresos, periodos, listas, nombreArchivo }) {
  const X = await cargarXLSX();
  const nombrePorId = new Map(listas.map(l => [l.id, l.nombre]));
  const n = id => nombrePorId.get(id) ?? "";
  const libro = X.utils.book_new();
  const hoja = (filas, titulo) => X.utils.book_append_sheet(libro, X.utils.aoa_to_sheet(filas), titulo);
  hoja([["Fecha", "Categoría", "Descripción", "Monto", "Forma de pago", "Comentario", "En papelera"],
    ...gastos.map(x => [x.fecha, n(x.categoriaId), x.descripcion ?? "", x.monto, n(x.pagoId), x.comentario ?? "", x.eliminado ? "Sí" : ""])], "Gastos");
  hoja([["Fecha", "Fuente", "Descripción", "Monto", "Comentario", "En papelera"],
    ...ingresos.map(x => [x.fecha, n(x.fuenteId), x.descripcion ?? "", x.monto, x.comentario ?? "", x.eliminado ? "Sí" : ""])], "Ingresos");
  hoja([["Nombre del período", "Desde", "Hasta", "Estado"],
    ...periodos.map(p => [p.nombre, p.desde, p.hasta, p.cerrado ? "Cerrado" : "Abierto"])], "Períodos");
  const tipos = { categoria: "Categoría de gasto", fuente: "Fuente de ingreso", pago: "Forma de pago" };
  hoja([["Tipo", "Nombre", "En papelera"], ...listas.map(l => [tipos[l.tipo] ?? l.tipo, l.nombre, l.eliminada ? "Sí" : ""])], "Listas");
  X.writeFile(libro, nombreArchivo);
}
