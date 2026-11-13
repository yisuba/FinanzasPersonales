// Única capa que habla con Firebase. app.js solo usa estas funciones, así que las pruebas
// pueden reemplazar este archivo por una versión en memoria (tests/datos-simulados.js).
//
// Todo lo del usuario vive bajo usuarios/{uid}/...: gastos, ingresos, periodos, listas y ajustes/prefs.
// Nada se borra de verdad salvo los períodos: gastos, ingresos y listas se marcan como eliminados.

import config from "./firebase-config.js";

export const configurado = !String(config.apiKey).startsWith("TU_");

const V = "10.12.2";
let fb = null; // módulos de Firebase, cargados solo si hay configuración

async function cargar() {
  if (fb) return fb;
  const [appM, authM, fsM] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`)
  ]);
  const app = appM.initializeApp(config);
  fb = { ...authM, ...fsM, auth: authM.getAuth(app), db: fsM.getFirestore(app) };
  return fb;
}

const ruta = (uid, col) => fb.collection(fb.db, "usuarios", uid, col);

// ---------- Sesión ----------

export async function alCambiarSesion(cb) {
  await cargar();
  fb.onAuthStateChanged(fb.auth, u => cb(u ? { uid: u.uid, nombre: u.displayName, correo: u.email } : null));
}

export async function entrar() {
  await cargar();
  return fb.signInWithPopup(fb.auth, new fb.GoogleAuthProvider());
}

export async function salir() {
  await cargar();
  return fb.signOut(fb.auth);
}

// ---------- Lectura en tiempo real ----------

// Escucha una colección completa. cb recibe un arreglo de { id, ...campos }.
export function escuchar(uid, col, cb, onError) {
  return fb.onSnapshot(ruta(uid, col), snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), onError);
}

export function escucharPrefs(uid, cb, onError) {
  return fb.onSnapshot(fb.doc(fb.db, "usuarios", uid, "ajustes", "prefs"), s => cb(s.exists() ? s.data() : {}), onError);
}

// ---------- Escritura ----------

const sello = () => fb.serverTimestamp();

// Devuelve el id del documento nuevo sin esperar al servidor (con mala red, addDoc puede tardar mucho).
export function crear(uid, col, datos) {
  const ref = fb.doc(ruta(uid, col));
  const p = fb.setDoc(ref, { ...datos, creado: sello(), actualizado: sello() });
  return { id: ref.id, listo: p };
}

export function actualizar(uid, col, id, cambios) {
  return fb.updateDoc(fb.doc(fb.db, "usuarios", uid, col, id), { ...cambios, actualizado: sello() });
}

// Solo se usa para períodos: borrar un período no borra gastos (quedan "Sin período").
export function borrar(uid, col, id) {
  return fb.deleteDoc(fb.doc(fb.db, "usuarios", uid, col, id));
}

export function guardarPrefs(uid, cambios) {
  return fb.setDoc(fb.doc(fb.db, "usuarios", uid, "ajustes", "prefs"), cambios, { merge: true });
}

// Id nuevo sin escribir nada (para enlazar categorías con gastos dentro de una importación)
export function idNuevo(uid, col) {
  return fb.doc(ruta(uid, col)).id;
}

// Escribe muchos documentos de una vez (importación), en lotes de 400. ops: [{ col, id, datos }]
export async function escribirVarios(uid, ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const lote = fb.writeBatch(fb.db);
    for (const { col, id, datos } of ops.slice(i, i + 400)) {
      lote.set(fb.doc(fb.db, "usuarios", uid, col, id), { ...datos, creado: sello(), actualizado: sello() });
    }
    await lote.commit();
  }
}
