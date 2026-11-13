// Lógica pura: períodos, resúmenes y formatos. No usa Firebase ni el DOM,
// así que se puede probar con `node --test tests/`.

export const TODOS = "todos";
export const TZ = "America/Santiago";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
  "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// ---------- Fechas (texto "AAAA-MM-DD", sin horas ni zonas horarias) ----------

export function hoyISO(ahora = new Date()) {
  // en-CA da el formato AAAA-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(ahora);
}

export function sumarDias(iso, dias) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function finDeMes(iso) {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function esFechaValida(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

// "2026-08-21" -> "21/08"
export function fechaCorta(iso) {
  if (!esFechaValida(iso)) return "";
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

// ---------- Formatos ----------

const nf = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const pf = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Negativos con signo menos, nunca entre paréntesis: -$85.512
export function formatoMonto(n) {
  if (n == null || n === "" || !Number.isFinite(Number(n))) return "";
  const v = Math.round(Number(n));
  return (v < 0 ? "-" : "") + "$" + nf.format(Math.abs(v));
}

export function formatoNumero(n) {
  if (n == null || n === "" || !Number.isFinite(Number(n))) return "";
  const v = Math.round(Number(n));
  return (v < 0 ? "-" : "") + nf.format(Math.abs(v));
}

export function formatoPct(x) {
  if (x == null || !Number.isFinite(x)) return "–";
  return (x < 0 ? "-" : "") + pf.format(Math.abs(x * 100)) + "%";
}

// Acepta "2800", "2.800", "$2.800", "-1.500", "2800,5". Devuelve un entero o null.
export function parsearMonto(texto) {
  const s = String(texto ?? "").trim().replace(/[$\s.]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s));
}

// ---------- Listas, períodos y asignación ----------

const porOrden = (a, b) => (a.orden ?? 0) - (b.orden ?? 0) || String(a.nombre).localeCompare(String(b.nombre), "es");

export function ordenarListas(items) {
  return [...items].sort(porOrden);
}

export function ordenarPeriodos(periodos) {
  return [...periodos].sort((a, b) => String(a.desde).localeCompare(String(b.desde)) || String(a.nombre).localeCompare(String(b.nombre), "es"));
}

// Id del período que contiene la fecha, o null. `periodos` debe venir ordenado.
export function periodoDe(fecha, periodos) {
  if (!esFechaValida(fecha)) return null;
  for (const p of periodos) {
    if (esFechaValida(p.desde) && esFechaValida(p.hasta) && p.desde <= fecha && fecha <= p.hasta) return p.id;
  }
  return null;
}

// Pares de períodos cuyos intervalos se cruzan, y períodos con fechas inválidas.
export function problemasPeriodos(periodos) {
  const ps = ordenarPeriodos(periodos);
  const cruces = [];
  const invalidos = ps.filter(p => !esFechaValida(p.desde) || !esFechaValida(p.hasta) || p.desde > p.hasta);
  const validos = ps.filter(p => !invalidos.includes(p));
  for (let i = 0; i < validos.length; i++) {
    for (let j = i + 1; j < validos.length; j++) {
      const a = validos[i], b = validos[j];
      if (a.desde <= b.hasta && b.desde <= a.hasta) cruces.push([a, b]);
    }
  }
  return { cruces, invalidos };
}

export const activos = items => items.filter(x => !x.eliminado);
const suma = items => items.reduce((t, x) => t + (Number(x.monto) || 0), 0);

// Período por defecto: el que contiene hoy; si no hay, el más reciente; si no hay ninguno, "todos".
export function periodoPorDefecto(periodos, hoy = hoyISO()) {
  const ps = ordenarPeriodos(periodos);
  return periodoDe(hoy, ps) ?? (ps.length ? ps[ps.length - 1].id : TODOS);
}

// Propone el período siguiente al último: empieza el día después y termina a fin de ese mes.
export function sugerirPeriodo(periodos, hoy = hoyISO()) {
  const ps = ordenarPeriodos(periodos).filter(p => esFechaValida(p.hasta));
  const desde = ps.length ? sumarDias(ps[ps.length - 1].hasta, 1) : hoy.slice(0, 8) + "01";
  const hasta = finDeMes(desde);
  let nombre = MESES[Number(desde.slice(5, 7)) - 1];
  if (periodos.some(p => p.nombre === nombre)) nombre += " " + desde.slice(0, 4);
  return { nombre, desde, hasta };
}

// ---------- Resúmenes ----------

// Totales de un período (o de todos) y gasto por categoría.
// Las categorías en papelera siguen apareciendo si tienen gastos, para que el total siempre cuadre.
export function resumenPeriodo({ gastos, ingresos, periodos, categorias, periodoId }) {
  const ps = ordenarPeriodos(periodos);
  const dentro = x => periodoId === TODOS || periodoDe(x.fecha, ps) === periodoId;
  const g = activos(gastos).filter(dentro);
  const i = activos(ingresos).filter(dentro);
  const totalGastos = suma(g);
  const totalIngresos = suma(i);
  const ids = new Set(categorias.map(c => c.id));
  const porCategoria = ordenarListas(categorias)
    .map(c => ({ id: c.id, nombre: c.nombre, eliminada: !!c.eliminada, monto: suma(g.filter(x => x.categoriaId === c.id)) }))
    .filter(c => !c.eliminada || c.monto !== 0)
    .map(c => ({ ...c, pct: totalGastos ? c.monto / totalGastos : null }));
  const sinCategoria = suma(g.filter(x => !x.categoriaId || !ids.has(x.categoriaId)));
  const balance = totalIngresos - totalGastos;
  return {
    totalIngresos, totalGastos, balance,
    tasaAhorro: totalIngresos ? balance / totalIngresos : null,
    porCategoria,
    sinCategoria,
    sinCategoriaPct: totalGastos ? sinCategoria / totalGastos : null,
    control: totalGastos - porCategoria.reduce((t, c) => t + c.monto, 0),
    cantidadGastos: g.length,
    // Gastos activos que no caen en ningún período (solo informativo)
    sinPeriodo: activos(gastos).filter(x => periodoDe(x.fecha, ps) == null).length
  };
}

// Una fila por período: ingresos, gastos, balance y tasa de ahorro.
export function resumenMensual({ gastos, ingresos, periodos }) {
  const ps = ordenarPeriodos(periodos);
  const g = activos(gastos), i = activos(ingresos);
  return ps.map(p => {
    const ing = suma(i.filter(x => periodoDe(x.fecha, ps) === p.id));
    const gas = suma(g.filter(x => periodoDe(x.fecha, ps) === p.id));
    return { id: p.id, nombre: p.nombre, cerrado: !!p.cerrado, ingresos: ing, gastos: gas, balance: ing - gas, tasaAhorro: ing ? (ing - gas) / ing : null };
  });
}

// Porcentaje del gasto de cada período por categoría, más la columna "Año" (todos los gastos).
export function tablaAnual({ gastos, periodos, categorias }) {
  const ps = ordenarPeriodos(periodos);
  const g = activos(gastos);
  const pid = new Map(g.map(x => [x, periodoDe(x.fecha, ps)]));
  const totalesPer = ps.map(p => suma(g.filter(x => pid.get(x) === p.id)));
  const totalAnio = suma(g);
  const ids = new Set(categorias.map(c => c.id));
  const fila = filtro => {
    const valores = ps.map((p, k) => totalesPer[k] ? suma(g.filter(x => pid.get(x) === p.id && filtro(x))) / totalesPer[k] : null);
    const total = totalAnio ? suma(g.filter(filtro)) / totalAnio : null;
    return { valores, total };
  };
  const filas = ordenarListas(categorias)
    .map(c => ({ id: c.id, nombre: c.nombre, eliminada: !!c.eliminada, ...fila(x => x.categoriaId === c.id) }))
    .filter(f => !f.eliminada || f.total);
  return {
    columnas: ps.map(p => ({ id: p.id, nombre: p.nombre, cerrado: !!p.cerrado })),
    filas,
    sinCategoria: fila(x => !x.categoriaId || !ids.has(x.categoriaId)),
    totales: { valores: totalesPer, total: totalAnio }
  };
}
