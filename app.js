// Interfaz de Finanzas personales: pestañas tipo planilla, celdas editables y resúmenes.
// Firebase vive en datos.js; los cálculos, en calculos.js; Excel, en excel.js.

import * as D from "./datos.js";
import * as C from "./calculos.js";

const $ = id => document.getElementById(id);

// ---------- Preferencias locales (solo este dispositivo) ----------

const LOCAL = { tema: "finanzas-tema", vista: "finanzas-vista", periodo: "finanzas-periodo", filtro: "finanzas-filtro-" };
const leerLocal = (k, def) => { try { return localStorage.getItem(k) ?? def; } catch { return def; } };
const guardarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

// ---------- Estado ----------

const COLECCIONES = ["gastos", "ingresos", "periodos", "listas"];
const datos = { gastos: [], ingresos: [], periodos: [], listas: [], prefs: {} };
const cargado = { gastos: false, ingresos: false, periodos: false, listas: false };
let uid = null;
let unsubs = [];
let tema = leerLocal(LOCAL.tema, "claro") === "oscuro" ? "oscuro" : "claro";
const VISTAS = ["general", "gastos", "ingresos", "resumen", "config"];
let vista = VISTAS.includes(leerLocal(LOCAL.vista, "")) ? leerLocal(LOCAL.vista, "") : "general";
let periodoGeneral = leerLocal(LOCAL.periodo, "");
const filtros = { gastos: leerLocal(LOCAL.filtro + "gastos", "abiertos"), ingresos: leerLocal(LOCAL.filtro + "ingresos", "abiertos") };

// ---------- Utilidades de DOM ----------

// Crea un elemento. El texto del usuario siempre entra con textContent, nunca como HTML.
function el(tag, props = {}, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const h of hijos.flat()) if (h != null && h !== false) e.append(h instanceof Node ? h : String(h));
  return e;
}

function alertar(texto, { error = false, accion = null, ms = 4500 } = {}) {
  const caja = el("div", { class: "aviso" + (error ? " error" : ""), role: error ? "alert" : "status" }, texto);
  if (accion) {
    caja.append(" ", el("button", { type: "button", class: "secundario", text: accion.texto, onclick: () => { accion.fn(); caja.remove(); } }));
  }
  $("avisos").append(caja);
  setTimeout(() => caja.remove(), accion ? ms + 3000 : ms);
}

function errorGuardar(e) {
  console.error(e);
  const permisos = String(e?.code || e?.message).includes("permission");
  alertar(permisos ? "Sin permiso para guardar. Revisa las reglas de Firestore (GUIA-CONFIGURACION.md)." : "No se pudo guardar: " + (e?.message || e), { error: true });
}

const atrapar = p => Promise.resolve(p).catch(errorGuardar);

// Diálogo propio de confirmación. Los botones resuelven directamente (sin depender del evento close).
function confirmar(texto, textoOk = "Aceptar") {
  const dlg = $("dlg-confirmar");
  $("confirmar-texto").textContent = texto;
  $("confirmar-ok").textContent = textoOk;
  return new Promise(resolver => {
    const fin = v => { dlg.close(); $("confirmar-ok").onclick = $("confirmar-cancelar").onclick = dlg.oncancel = null; resolver(v); };
    $("confirmar-ok").onclick = () => fin(true);
    $("confirmar-cancelar").onclick = () => fin(false);
    dlg.oncancel = e => { e.preventDefault(); fin(false); };
    dlg.showModal();
  });
}

// ---------- Acceso a datos ----------

const listas = tipo => C.ordenarListas(datos.listas.filter(l => l.tipo === tipo));
const listasActivas = tipo => listas(tipo).filter(l => !l.eliminada);
const nombreDe = id => datos.listas.find(l => l.id === id)?.nombre ?? "";
const periodosOrd = () => C.ordenarPeriodos(datos.periodos);
const periodoPorId = id => datos.periodos.find(p => p.id === id);
const ms = v => (v == null ? Number.MAX_SAFE_INTEGER : typeof v.toMillis === "function" ? v.toMillis() : new Date(v).getTime() || 0);
const todoCargado = () => COLECCIONES.every(c => cargado[c]);

// Deshace una edición inválida: sale del campo (para no restaurar lo escrito) y redibuja
function revertir() { document.activeElement?.blur(); render(); }

const crear = (col, campos) => { const r = D.crear(uid, col, campos); atrapar(r.listo); return r.id; };
const actualizar = (col, id, cambios) => atrapar(D.actualizar(uid, col, id, cambios));

// ---------- Foco: se conserva al redibujar (llegan cambios de Firestore mientras escribes) ----------

function capturarFoco() {
  const a = document.activeElement;
  const nuevos = {};
  document.querySelectorAll("[data-clave^='nuevo:']").forEach(e => { nuevos[e.dataset.clave] = e.value; });
  if (!a?.dataset?.clave) return { nuevos };
  let ini = null, fin = null;
  try { ini = a.selectionStart; fin = a.selectionEnd; } catch { /* inputs sin selección */ }
  return { nuevos, clave: a.dataset.clave, valor: a.value, ini, fin };
}

function restaurarFoco(f) {
  for (const [clave, valor] of Object.entries(f.nuevos)) {
    const e = document.querySelector(`[data-clave="${CSS.escape(clave)}"]`);
    if (e) e.value = valor;
  }
  if (!f.clave) return;
  const e = document.querySelector(`[data-clave="${CSS.escape(f.clave)}"]`);
  if (!e) return;
  e.dataset.restaurando = "1";
  e.focus({ preventScroll: true });
  delete e.dataset.restaurando;
  e.value = f.valor;
  try { if (f.ini != null) e.setSelectionRange(f.ini, f.fin); } catch { /* sin selección */ }
}

// ---------- Celdas editables ----------

// Celda de texto: guarda al salir del campo o con Enter.
function celdaTexto(valor, clave, guardar, { placeholder = "", max = 120 } = {}) {
  const i = el("input", { class: "celda", value: valor ?? "", maxLength: max, placeholder, dataset: { clave } });
  i.addEventListener("keydown", e => { if (e.key === "Enter") i.blur(); if (e.key === "Escape") { i.value = valor ?? ""; i.blur(); } });
  if (guardar) i.addEventListener("change", () => { const v = i.value.trim(); if (v !== (valor ?? "")) guardar(v); });
  return i;
}

function celdaFecha(valor, clave, guardar) {
  const i = el("input", { class: "celda", type: "date", value: valor ?? "", required: true, dataset: { clave } });
  if (guardar) i.addEventListener("change", () => {
    if (!C.esFechaValida(i.value)) { i.value = valor ?? ""; alertar("La fecha no es válida.", { error: true }); return; }
    if (i.value !== valor) guardar(i.value);
  });
  return i;
}

// Monto: muestra 2.800 y al editar muestra 2800.
function celdaMonto(valor, clave, guardar) {
  const i = el("input", { class: "celda num", inputMode: "decimal", value: C.formatoNumero(valor), placeholder: guardar ? "" : "Monto", dataset: { clave } });
  i.addEventListener("focus", () => {
    if (i.dataset.restaurando) return;
    if (valor != null) i.value = String(valor);
    i.select();
  });
  i.addEventListener("keydown", e => { if (e.key === "Enter") i.blur(); if (e.key === "Escape") { i.value = String(valor ?? ""); i.blur(); } });
  if (guardar) {
    i.addEventListener("change", () => {
      const n = C.parsearMonto(i.value);
      if (n == null) { alertar("El monto no es válido. Escribe solo números, por ejemplo 2800.", { error: true }); i.value = C.formatoNumero(valor); return; }
      if (n !== valor) guardar(n);
    });
    i.addEventListener("blur", () => { const n = C.parsearMonto(i.value); i.value = C.formatoNumero(n ?? valor); });
  }
  return i;
}

// Desplegable de una lista (categorías, fuentes o formas de pago).
function celdaLista(tipo, valor, clave, guardar, textoVacio) {
  const s = el("select", { class: "celda", dataset: { clave } }, el("option", { value: "", text: textoVacio }));
  for (const l of listasActivas(tipo)) s.append(el("option", { value: l.id, text: l.nombre }));
  if (valor && !listasActivas(tipo).some(l => l.id === valor)) {
    s.append(el("option", { value: valor, text: (nombreDe(valor) || "(eliminada)") + " (en papelera)" }));
  }
  s.value = valor ?? "";
  // Un gasto sin categoría se marca en rojo para revisarlo
  if (guardar && tipo === "categoria" && !valor) s.classList.add("falta");
  if (guardar) s.addEventListener("change", () => guardar(s.value));
  return s;
}

// ---------- Pantallas y pestañas ----------

function mostrarPantalla(cual) {
  for (const p of ["cargando", "sin-config", "login", "app"]) $("pantalla-" + p).hidden = p !== cual;
}

function cambiarVista(v) {
  vista = v;
  guardarLocal(LOCAL.vista, v);
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  if (!uid) return;
  const foco = capturarFoco();
  document.querySelectorAll(".pestana").forEach(b => b.setAttribute("aria-selected", String(b.dataset.vista === vista)));
  for (const v of VISTAS) $("v-" + v).hidden = v !== vista;
  ({ general: renderGeneral, gastos: () => renderRegistro("gastos"), ingresos: () => renderRegistro("ingresos"), resumen: renderResumen, config: renderConfig })[vista]();
  restaurarFoco(foco);
}

function opcionesPeriodo(select, valor, extras) {
  select.replaceChildren(...extras.map(([v, t]) => el("option", { value: v, text: t })),
    ...periodosOrd().map(p => el("option", { value: p.id, text: p.nombre + (p.cerrado ? " (cerrado)" : "") })));
  select.value = [...select.options].some(o => o.value === valor) ? valor : select.options[0]?.value ?? "";
  return select.value;
}

function avisoLinea(texto) { return el("p", { class: "aviso-linea", text: texto }); }

// ---------- General ----------

function renderGeneral() {
  const ps = periodosOrd();
  if (!ps.some(p => p.id === periodoGeneral) && periodoGeneral !== C.TODOS) periodoGeneral = C.periodoPorDefecto(ps);
  const sel = $("sel-periodo-general");
  sel.replaceChildren(...ps.map(p => el("option", { value: p.id, text: p.nombre + (p.cerrado ? " (cerrado)" : "") })),
    el("option", { value: C.TODOS, text: "Todos los períodos" }));
  sel.value = periodoGeneral;

  const vacio = todoCargado() && !datos.gastos.length && !datos.ingresos.length && !datos.periodos.length;
  $("general-vacio").hidden = !vacio;

  const r = C.resumenPeriodo({ ...datos, categorias: listas("categoria"), periodoId: periodoGeneral });
  $("kpi-ingresos").textContent = C.formatoMonto(r.totalIngresos);
  $("kpi-gastos").textContent = C.formatoMonto(r.totalGastos);
  $("kpi-balance").textContent = C.formatoMonto(r.balance);
  $("kpi-tasa").textContent = C.formatoPct(r.tasaAhorro);

  const avisos = [];
  if (r.sinPeriodo) avisos.push(avisoLinea(`Hay ${r.sinPeriodo} gasto(s) con fecha fuera de todo período. Crea o ajusta un período en Configuración.`));
  for (const [a, b] of C.problemasPeriodos(datos.periodos).cruces) avisos.push(avisoLinea(`Los períodos "${a.nombre}" y "${b.nombre}" se superponen: un gasto en ambos se cuenta solo en el primero.`));
  $("general-avisos").replaceChildren(...avisos);

  const filas = r.porCategoria.map(c => el("tr", {},
    el("td", { class: c.eliminada ? "eliminada" : "", text: c.nombre + (c.eliminada ? " (en papelera)" : "") }),
    el("td", { class: "num", text: C.formatoMonto(c.monto) }),
    el("td", { class: "num", text: C.formatoPct(c.pct) })));
  if (r.sinCategoria) {
    filas.push(el("tr", { class: "fila-sincat" }, el("td", { text: "Sin categoría" }),
      el("td", { class: "num", text: C.formatoMonto(r.sinCategoria) }), el("td", { class: "num", text: C.formatoPct(r.sinCategoriaPct) })));
  }
  if (!filas.length) filas.push(el("tr", {}, el("td", { colSpan: 3, class: "muted", text: "Sin categorías. Agrégalas en Configuración." })));
  $("tb-general").replaceChildren(...filas);
  $("tf-general").replaceChildren(el("tr", {}, el("td", { text: "Total" }),
    el("td", { class: "num", text: C.formatoMonto(r.totalGastos) }), el("td", { class: "num", text: r.totalGastos ? "100,0%" : "–" })));

  $("ctl-sincat").textContent = C.formatoMonto(r.sinCategoria);
  $("ctl-diferencia").textContent = C.formatoMonto(r.control);
  const ok = r.control === 0;
  $("ctl-estado").textContent = ok ? "Todo cuadra" : "Revisa Sin categoría";
  $("ctl-estado").className = "num " + (ok ? "txt-verde" : "txt-rojo");
}

// ---------- Gastos e ingresos ----------

const ESQUEMA = {
  gastos: {
    singular: "gasto", plural: "gastos",
    campos: [
      { k: "fecha", t: "fecha" },
      { k: "categoriaId", t: "lista", lista: "categoria", vacio: "Sin categoría" },
      { k: "descripcion", t: "texto" },
      { k: "monto", t: "monto" },
      { k: "pagoId", t: "lista", lista: "pago", vacio: "—" },
      { k: "comentario", t: "texto" }
    ]
  },
  ingresos: {
    singular: "ingreso", plural: "ingresos",
    campos: [
      { k: "fecha", t: "fecha" },
      { k: "fuenteId", t: "lista", lista: "fuente", vacio: "—" },
      { k: "descripcion", t: "texto" },
      { k: "monto", t: "monto" },
      { k: "comentario", t: "texto" }
    ]
  }
};

function celdaCampo(c, valor, clave, guardar) {
  if (c.t === "fecha") return celdaFecha(valor, clave, guardar);
  if (c.t === "monto") return celdaMonto(valor, clave, guardar);
  if (c.t === "lista") return celdaLista(c.lista, valor, clave, guardar, c.vacio);
  return celdaTexto(valor, clave, guardar, { placeholder: guardar ? "" : (c.k === "descripcion" ? "Descripción" : "Comentario") });
}

function filtrar(tipo, items) {
  const ps = periodosOrd();
  const f = filtros[tipo];
  return items.filter(x => {
    const pid = C.periodoDe(x.fecha, ps);
    if (f === C.TODOS) return true;
    if (f === "sin") return pid == null;
    if (f === "abiertos") return pid == null || !periodoPorId(pid)?.cerrado;
    return pid === f;
  });
}

function renderRegistro(tipo) {
  const esq = ESQUEMA[tipo];
  filtros[tipo] = opcionesPeriodo($("sel-filtro-" + tipo), filtros[tipo],
    [["abiertos", "Períodos abiertos"], [C.TODOS, "Todos"], ["sin", "Sin período"]]);
  const ps = periodosOrd();
  const items = filtrar(tipo, C.activos(datos[tipo]))
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || ms(a.creado) - ms(b.creado));

  const filas = items.map(x => {
    const tr = el("tr", { dataset: { id: x.id } });
    for (const c of esq.campos) {
      tr.append(el("td", {}, celdaCampo(c, x[c.k], `${tipo}:${x.id}:${c.k}`, v => actualizar(tipo, x.id, { [c.k]: v }))));
    }
    const pid = C.periodoDe(x.fecha, ps);
    tr.append(el("td", { class: "estatico" + (pid ? "" : " txt-rojo"), text: pid ? periodoPorId(pid).nombre : "Sin período" }));
    tr.append(el("td", {}, el("button", {
      type: "button", class: "btn-icono", title: "Enviar a la papelera", "aria-label": "Enviar a la papelera", text: "✕",
      onclick: () => {
        actualizar(tipo, x.id, { eliminado: true });
        alertar(`${capitalizar(esq.singular)} enviado a la papelera.`, { accion: { texto: "Deshacer", fn: () => actualizar(tipo, x.id, { eliminado: false }) } });
      }
    })));
    return tr;
  });
  if (!filas.length) {
    const texto = datos[tipo].some(x => !x.eliminado) ? `No hay ${esq.plural} en esta vista. Cambia el filtro "Mostrar".` : `Aún no hay ${esq.plural}. Usa la fila de abajo para agregar el primero.`;
    filas.push(el("tr", {}, el("td", { colSpan: esq.campos.length + 2, class: "estatico muted", text: texto })));
  }
  $("tb-" + tipo).replaceChildren(...filas);

  // Fila para agregar
  const nueva = el("tr", { class: "fila-nueva" });
  for (const c of esq.campos) {
    const ctl = celdaCampo(c, c.k === "fecha" ? C.hoyISO() : (c.t === "monto" ? null : ""), `nuevo:${tipo}:${c.k}`, null);
    if (ctl.tagName === "INPUT") ctl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); agregar(tipo); } });
    nueva.append(el("td", {}, ctl));
  }
  nueva.append(el("td", { class: "estatico muted", text: "" }));
  nueva.append(el("td", {}, el("button", { type: "button", class: "btn-agregar", title: `Agregar ${esq.singular}`, "aria-label": `Agregar ${esq.singular}`, text: "+", onclick: () => agregar(tipo) })));
  $("tf-" + tipo).replaceChildren(nueva);

  const total = items.reduce((t, x) => t + (Number(x.monto) || 0), 0);
  $("res-" + tipo).textContent = `${items.length} ${items.length === 1 ? esq.singular : esq.plural} · total ${C.formatoMonto(total)}`;
}

function agregar(tipo) {
  const esq = ESQUEMA[tipo];
  const campo = k => document.querySelector(`[data-clave="nuevo:${tipo}:${k}"]`);
  const nuevo = { eliminado: false };
  for (const c of esq.campos) {
    const v = campo(c.k).value;
    nuevo[c.k] = c.t === "monto" ? C.parsearMonto(v) : v.trim();
  }
  if (!C.esFechaValida(nuevo.fecha)) { alertar("Elige una fecha.", { error: true }); campo("fecha").focus(); return; }
  if (nuevo.monto == null) { alertar("Escribe el monto, por ejemplo 2800.", { error: true }); campo("monto").focus(); return; }
  crear(tipo, nuevo);
  // Se conserva la fecha para registrar varios gastos del mismo día
  for (const c of esq.campos) if (c.k !== "fecha") campo(c.k).value = "";
  campo(esq.campos[1].k).focus();
  render();
}

const capitalizar = s => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- Resumen ----------

function renderResumen() {
  const m = C.resumenMensual(datos);
  const td = (texto, clase = "num") => el("td", { class: clase, text: texto });
  const filas = m.map(x => el("tr", {},
    el("td", { text: x.nombre + (x.cerrado ? " (cerrado)" : "") }),
    td(C.formatoMonto(x.ingresos)), td(C.formatoMonto(x.gastos)),
    td(C.formatoMonto(x.balance), "num" + (x.balance < 0 ? " neg" : "")), td(C.formatoPct(x.tasaAhorro))));
  if (!filas.length) filas.push(el("tr", {}, el("td", { colSpan: 5, class: "muted", text: "No hay períodos. Créalos en Configuración." })));
  $("tb-mensual").replaceChildren(...filas);

  const a = C.tablaAnual({ ...datos, categorias: listas("categoria") });
  $("th-anual").replaceChildren(el("tr", {}, el("th", { text: "Categoría" }),
    ...a.columnas.map(c => el("th", { class: "num", text: c.nombre })), el("th", { class: "num", text: "Año" })));
  const fila = (nombre, f, clase = "") => el("tr", { class: clase }, el("td", { text: nombre }),
    ...f.valores.map(v => td(C.formatoPct(v))), td(C.formatoPct(f.total)));
  const cuerpo = a.filas.map(f => fila(f.nombre + (f.eliminada ? " (en papelera)" : ""), f, f.eliminada ? "eliminada" : ""));
  if (a.sinCategoria.total) cuerpo.push(fila("Sin categoría", a.sinCategoria, "fila-sincat"));
  $("tb-anual").replaceChildren(...cuerpo);
  $("tf-anual").replaceChildren(el("tr", {}, el("td", { text: "Gasto total" }),
    ...a.totales.valores.map(v => td(C.formatoMonto(v))), td(C.formatoMonto(a.totales.total))));
}

// ---------- Configuración ----------

function renderConfig() {
  // Períodos
  const ps = periodosOrd();
  const filas = ps.map(p => {
    const guardarFecha = campo => v => {
      const otro = campo === "desde" ? p.hasta : p.desde;
      const [d, h] = campo === "desde" ? [v, otro] : [otro, v];
      if (C.esFechaValida(d) && C.esFechaValida(h) && d > h) { alertar('"Desde" no puede ser posterior a "Hasta".', { error: true }); revertir(); return; }
      actualizar("periodos", p.id, { [campo]: v });
    };
    return el("tr", {},
      el("td", {}, celdaTexto(p.nombre, `periodos:${p.id}:nombre`, v => v ? actualizar("periodos", p.id, { nombre: v }) : revertir(), { max: 30 })),
      el("td", {}, celdaFecha(p.desde, `periodos:${p.id}:desde`, guardarFecha("desde"))),
      el("td", {}, celdaFecha(p.hasta, `periodos:${p.id}:hasta`, guardarFecha("hasta"))),
      el("td", { class: "estatico" }, el("span", { class: "estado " + (p.cerrado ? "cerrado" : "abierto"), text: p.cerrado ? "Cerrado" : "Abierto" })),
      el("td", {}, el("div", { class: "acc-celda" },
        p.cerrado
          ? el("button", { type: "button", text: "Reabrir", onclick: () => actualizar("periodos", p.id, { cerrado: false }) })
          : el("button", { type: "button", text: "Cerrar período", onclick: () => cerrarPeriodo(p) }),
        el("button", { type: "button", class: "secundario", text: "Eliminar", onclick: () => eliminarPeriodo(p) }))));
  });
  if (!filas.length) filas.push(el("tr", {}, el("td", { colSpan: 5, class: "estatico muted", text: "No hay períodos. Crea el primero con el botón de abajo." })));
  $("tb-periodos").replaceChildren(...filas);
  const { cruces, invalidos } = C.problemasPeriodos(datos.periodos);
  const msgs = [...cruces.map(([a, b]) => `"${a.nombre}" y "${b.nombre}" se superponen.`), ...invalidos.map(p => `"${p.nombre}" tiene fechas inválidas.`)];
  $("aviso-periodos").hidden = !msgs.length;
  $("aviso-periodos").textContent = msgs.join(" ");

  // Listas
  for (const tipo of ["categoria", "fuente", "pago"]) {
    $("lista-" + tipo).replaceChildren(...listasActivas(tipo).map(l => el("li", {},
      celdaTexto(l.nombre, `listas:${l.id}:nombre`, v => renombrarLista(l, v), { max: 40 }),
      el("button", { type: "button", class: "btn-icono", title: "Enviar a la papelera", "aria-label": `Enviar ${l.nombre} a la papelera`, text: "✕", onclick: () => eliminarLista(l) }))));
  }

  renderPapelera();
  $("sw-tema").setAttribute("aria-checked", String(tema === "oscuro"));
}

function renderPapelera() {
  const grupos = [];
  const grupo = (titulo, items, texto, restaurar) => {
    if (!items.length) return;
    grupos.push(el("div", { class: "papelera-grupo" }, el("h4", { text: titulo }),
      ...items.map(x => el("div", { class: "papelera-item" }, el("span", { text: texto(x) }),
        el("button", { type: "button", text: "Restaurar", onclick: () => restaurar(x) })))));
  };
  const desc = x => [C.fechaCorta(x.fecha), x.descripcion || "(sin descripción)", C.formatoMonto(x.monto)].join(" · ");
  grupo("Gastos", datos.gastos.filter(x => x.eliminado), x => desc(x) + (x.categoriaId ? " · " + nombreDe(x.categoriaId) : ""), x => actualizar("gastos", x.id, { eliminado: false }));
  grupo("Ingresos", datos.ingresos.filter(x => x.eliminado), x => desc(x) + (x.fuenteId ? " · " + nombreDe(x.fuenteId) : ""), x => actualizar("ingresos", x.id, { eliminado: false }));
  const tipos = { categoria: "Categorías", fuente: "Fuentes de ingreso", pago: "Formas de pago" };
  for (const [tipo, titulo] of Object.entries(tipos)) {
    grupo(titulo, listas(tipo).filter(l => l.eliminada), l => l.nombre, l => restaurarLista(l));
  }
  $("papelera").replaceChildren(...(grupos.length ? grupos : [el("p", { class: "muted", text: "La papelera está vacía." })]));
}

async function cerrarPeriodo(p) {
  const ok = await confirmar(`¿Cerrar "${p.nombre}"? Sus gastos e ingresos dejan de mostrarse en Gastos e Ingresos (filtro "Períodos abiertos"), pero siguen en General, Resumen y en el filtro "Todos". Puedes reabrirlo cuando quieras.`, "Cerrar período");
  if (!ok) return;
  await actualizar("periodos", p.id, { cerrado: true });
  const haySiguiente = datos.periodos.some(o => o.id !== p.id && o.desde > p.hasta);
  if (!haySiguiente && await confirmar("¿Quieres crear el período siguiente?", "Crear período")) abrirDialogoPeriodo();
}

async function eliminarPeriodo(p) {
  const ok = await confirmar(`¿Eliminar el período "${p.nombre}"? Los gastos e ingresos no se borran: quedan como "Sin período" hasta que otro período cubra sus fechas.`, "Eliminar período");
  if (ok) atrapar(D.borrar(uid, "periodos", p.id));
}

function abrirDialogoPeriodo() {
  const s = C.sugerirPeriodo(datos.periodos);
  $("per-nombre").value = s.nombre;
  $("per-desde").value = s.desde;
  $("per-hasta").value = s.hasta;
  $("per-error").hidden = true;
  $("dlg-periodo").showModal();
}

function crearPeriodoDesdeDialogo(e) {
  e.preventDefault();
  const nuevo = { nombre: $("per-nombre").value.trim(), desde: $("per-desde").value, hasta: $("per-hasta").value, cerrado: false };
  const error = msg => { $("per-error").textContent = msg; $("per-error").hidden = false; };
  if (!nuevo.nombre) return error("Escribe un nombre.");
  if (!C.esFechaValida(nuevo.desde) || !C.esFechaValida(nuevo.hasta)) return error("Elige las dos fechas.");
  if (nuevo.desde > nuevo.hasta) return error('"Desde" no puede ser posterior a "Hasta".');
  const cruce = datos.periodos.find(p => nuevo.desde <= p.hasta && p.desde <= nuevo.hasta);
  if (cruce) return error(`Se superpone con "${cruce.nombre}" (${C.fechaCorta(cruce.desde)} a ${C.fechaCorta(cruce.hasta)}).`);
  crear("periodos", nuevo);
  $("dlg-periodo").close();
}

const mismoNombre = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

function agregarLista(tipo, nombre) {
  nombre = nombre.trim();
  if (!nombre) return;
  if (listasActivas(tipo).some(l => mismoNombre(l.nombre, nombre))) { alertar(`"${nombre}" ya existe.`, { error: true }); return; }
  const enPapelera = listas(tipo).find(l => l.eliminada && mismoNombre(l.nombre, nombre));
  if (enPapelera) { restaurarLista(enPapelera); alertar(`"${enPapelera.nombre}" estaba en la papelera y se restauró.`); return; }
  const orden = Math.max(0, ...listas(tipo).map(l => l.orden ?? 0)) + 1;
  crear("listas", { tipo, nombre, orden, eliminada: false });
}

function renombrarLista(l, nombre) {
  if (!nombre) { revertir(); return; }
  if (listasActivas(l.tipo).some(o => o.id !== l.id && mismoNombre(o.nombre, nombre))) { alertar(`"${nombre}" ya existe.`, { error: true }); revertir(); return; }
  actualizar("listas", l.id, { nombre });
}

// Enviar a la papelera no cambia los gastos: siguen con su categoría y se cuentan igual.
function eliminarLista(l) {
  actualizar("listas", l.id, { eliminada: true });
  alertar(`"${l.nombre}" se envió a la papelera. Sus registros la conservan.`, { accion: { texto: "Deshacer", fn: () => restaurarLista(l) } });
}

function restaurarLista(l) {
  if (listasActivas(l.tipo).some(o => mismoNombre(o.nombre, l.nombre))) { alertar(`Ya existe otra "${l.nombre}" activa. Renómbrala antes de restaurar.`, { error: true }); return; }
  actualizar("listas", l.id, { eliminada: false });
}

// ---------- Importar y exportar ----------

let importacion = null;

async function elegirArchivo(e) {
  const archivo = e.target.files[0];
  e.target.value = "";
  if (!archivo) return;
  let r;
  try {
    const { leerArchivo } = await import("./excel.js");
    r = await leerArchivo(archivo);
  } catch (err) {
    console.error(err);
    alertar("No se pudo leer el archivo: " + (err?.message || err), { error: true, ms: 8000 });
    return;
  }
  importacion = { ...r, archivo: archivo.name };
  const suma = xs => C.formatoMonto(xs.reduce((t, x) => t + x.monto, 0));
  const nuevas = (tipo, nombres) => nombres.filter(n => !listas(tipo).some(l => mismoNombre(l.nombre, n)));
  const perNuevos = r.periodos.filter(p => !datos.periodos.some(o => o.nombre === p.nombre && o.desde === p.desde && o.hasta === p.hasta));
  const items = [
    `${r.gastos.length} gastos (${suma(r.gastos)})`,
    `${r.ingresos.length} ingresos (${suma(r.ingresos)})`,
    `${nuevas("categoria", r.categorias).length} categorías nuevas, ${nuevas("fuente", r.fuentes).length} fuentes nuevas, ${nuevas("pago", r.pagos).length} formas de pago nuevas`,
    `${perNuevos.length} períodos nuevos` + (perNuevos.length ? `: ${perNuevos.map(p => p.nombre).join(", ")}` : "")
  ];
  const sinCat = r.gastos.filter(g => !g.categoria).length;
  if (sinCat) items.push(`${sinCat} gasto(s) sin categoría (se importan así, para que los revises)`);
  const contenido = [el("p", { text: `Archivo: ${archivo.name}` }), el("ul", {}, ...items.map(t => el("li", { text: t })))];
  for (const a of r.avisos) contenido.push(avisoLinea(a));
  const previas = datos.prefs.importaciones ?? [];
  if (previas.length) {
    const u = previas[previas.length - 1];
    contenido.push(avisoLinea(`Ya importaste "${u.archivo}" el ${C.fechaCorta(u.fecha)}. Si es el mismo archivo, los gastos quedarán duplicados.`));
  } else if (C.activos(datos.gastos).length) {
    contenido.push(avisoLinea(`Ya tienes ${C.activos(datos.gastos).length} gastos registrados. Los del archivo se agregan a ellos.`));
  }
  if (perNuevos.some(p => datos.periodos.some(o => p.desde <= o.hasta && o.desde <= p.hasta))) {
    contenido.push(avisoLinea("Algunos períodos del archivo se superponen con los tuyos. Revísalos después en Configuración."));
  }
  $("importar-resumen").replaceChildren(...contenido);
  $("importar-ok").disabled = false;
  $("dlg-importar").showModal();
}

async function ejecutarImportacion() {
  const r = importacion;
  if (!r) return;
  $("importar-ok").disabled = true;
  try {
    const ops = [];
    const restaurar = [];
    const idsPorNombre = {};
    for (const [tipo, nombres] of [["categoria", r.categorias], ["fuente", r.fuentes], ["pago", r.pagos]]) {
      const mapa = new Map();
      let orden = Math.max(0, ...listas(tipo).map(l => l.orden ?? 0));
      for (const n of nombres) {
        const existente = listas(tipo).find(l => mismoNombre(l.nombre, n));
        if (existente) {
          mapa.set(n.toLowerCase(), existente.id);
          if (existente.eliminada) restaurar.push(existente.id);
        } else if (!mapa.has(n.toLowerCase())) {
          const id = D.idNuevo(uid, "listas");
          mapa.set(n.toLowerCase(), id);
          ops.push({ col: "listas", id, datos: { tipo, nombre: n, orden: ++orden, eliminada: false } });
        }
      }
      idsPorNombre[tipo] = n => (n ? mapa.get(n.toLowerCase()) ?? "" : "");
    }
    for (const p of r.periodos) {
      if (!datos.periodos.some(o => o.nombre === p.nombre && o.desde === p.desde && o.hasta === p.hasta)) {
        ops.push({ col: "periodos", id: D.idNuevo(uid, "periodos"), datos: { ...p, cerrado: false } });
      }
    }
    for (const g of r.gastos) {
      ops.push({ col: "gastos", id: D.idNuevo(uid, "gastos"), datos: {
        fecha: g.fecha, categoriaId: idsPorNombre.categoria(g.categoria), descripcion: g.descripcion, monto: g.monto,
        pagoId: idsPorNombre.pago(g.pago), comentario: g.comentario, eliminado: false } });
    }
    for (const i of r.ingresos) {
      ops.push({ col: "ingresos", id: D.idNuevo(uid, "ingresos"), datos: {
        fecha: i.fecha, fuenteId: idsPorNombre.fuente(i.fuente), descripcion: i.descripcion, monto: i.monto, comentario: i.comentario, eliminado: false } });
    }
    await D.escribirVarios(uid, ops);
    for (const id of restaurar) await D.actualizar(uid, "listas", id, { eliminada: false });
    const previas = datos.prefs.importaciones ?? [];
    await D.guardarPrefs(uid, { importaciones: [...previas, { fecha: C.hoyISO(), archivo: r.archivo, gastos: r.gastos.length, ingresos: r.ingresos.length }] });
    $("dlg-importar").close();
    importacion = null;
    alertar(`Importados ${r.gastos.length} gastos y ${r.ingresos.length} ingresos.`);
    cambiarVista("general");
  } catch (e) {
    $("importar-ok").disabled = false;
    errorGuardar(e);
  }
}

async function exportar() {
  try {
    const { exportarRespaldo } = await import("./excel.js");
    await exportarRespaldo({ ...datos, nombreArchivo: `Finanzas_respaldo_${C.hoyISO()}.xlsx` });
  } catch (e) {
    console.error(e);
    alertar("No se pudo crear el respaldo: " + (e?.message || e), { error: true });
  }
}

// ---------- Tema ----------

function aplicarTema(t, guardar = true) {
  tema = t;
  document.documentElement.dataset.tema = t;
  guardarLocal(LOCAL.tema, t);
  $("sw-tema").setAttribute("aria-checked", String(t === "oscuro"));
  if (guardar && uid) atrapar(D.guardarPrefs(uid, { tema: t }));
}

// ---------- Sesión y suscripciones ----------

function suscribir() {
  unsubs.forEach(u => u());
  unsubs = COLECCIONES.map(col => D.escuchar(uid, col, docs => { datos[col] = docs; cargado[col] = true; render(); }, errorGuardar));
  unsubs.push(D.escucharPrefs(uid, p => {
    datos.prefs = p;
    if ((p.tema === "claro" || p.tema === "oscuro") && p.tema !== tema) aplicarTema(p.tema, false);
  }, errorGuardar));
}

function limpiar() {
  unsubs.forEach(u => u());
  unsubs = [];
  for (const c of COLECCIONES) { datos[c] = []; cargado[c] = false; }
  datos.prefs = {};
}

// ---------- Eventos ----------

document.querySelectorAll(".pestana").forEach(b => b.addEventListener("click", () => cambiarVista(b.dataset.vista)));
$("titulo-app").addEventListener("click", () => cambiarVista("general"));
$("sel-periodo-general").addEventListener("change", e => { periodoGeneral = e.target.value; guardarLocal(LOCAL.periodo, periodoGeneral); render(); });
for (const tipo of ["gastos", "ingresos"]) {
  $("sel-filtro-" + tipo).addEventListener("change", e => { filtros[tipo] = e.target.value; guardarLocal(LOCAL.filtro + tipo, e.target.value); render(); });
}
$("btn-nuevo-periodo").addEventListener("click", abrirDialogoPeriodo);
$("btn-vacio-periodo").addEventListener("click", abrirDialogoPeriodo);
$("form-periodo").addEventListener("submit", crearPeriodoDesdeDialogo);
$("per-cancelar").addEventListener("click", () => $("dlg-periodo").close());
document.querySelectorAll(".form-lista").forEach(f => f.addEventListener("submit", e => {
  e.preventDefault();
  const input = f.querySelector("input");
  agregarLista(f.dataset.tipo, input.value);
  input.value = "";
}));
$("btn-importar").addEventListener("click", () => $("archivo-excel").click());
$("btn-vacio-importar").addEventListener("click", () => $("archivo-excel").click());
$("archivo-excel").addEventListener("change", elegirArchivo);
$("importar-ok").addEventListener("click", ejecutarImportacion);
$("importar-cancelar").addEventListener("click", () => { importacion = null; $("dlg-importar").close(); });
$("btn-exportar").addEventListener("click", exportar);
$("sw-tema").addEventListener("click", () => aplicarTema(tema === "oscuro" ? "claro" : "oscuro"));
$("btn-salir").addEventListener("click", async () => {
  if (await confirmar("¿Cerrar sesión en este dispositivo?", "Cerrar sesión")) atrapar(D.salir());
});

let entrando = false;
$("btn-login").addEventListener("click", async () => {
  if (entrando) return; // evita auth/cancelled-popup-request por doble clic
  entrando = true;
  try { await D.entrar(); }
  catch (e) { if (e?.code !== "auth/popup-closed-by-user") alertar("No se pudo iniciar sesión: " + (e?.message || e), { error: true }); }
  finally { entrando = false; }
});

// ---------- Inicio ----------

aplicarTema(tema, false);
if (!D.configurado) {
  mostrarPantalla("sin-config");
} else {
  D.alCambiarSesion(u => {
    if (u) {
      uid = u.uid;
      $("usuario").textContent = u.nombre || u.correo || "";
      mostrarPantalla("app");
      suscribir();
      render();
    } else {
      uid = null;
      limpiar();
      $("usuario").textContent = "";
      mostrarPantalla("login");
    }
  }).catch(e => {
    console.error(e);
    $("pantalla-cargando").replaceChildren(el("p", { text: "No se pudo cargar Firebase. Revisa tu conexión y recarga la página." }));
  });
}
