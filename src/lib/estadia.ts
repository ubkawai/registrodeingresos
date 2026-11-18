import { format } from "date-fns";
import { supabase } from "@/integrations/client";

// Estadía de los acampantes: centros, lugares, salidas y reingresos en la puerta.
// Los movimientos solo se crean con la función SQL registrar_movimiento.

// Centro (ej. Kawai, Killay): tiene la puerta y la hora límite
export type Centro = {
  id: string;
  nombre: string;
  hora_limite: string; // "23:00:00"
  activo: boolean;
};

// Lugar o alojamiento dentro de un centro (ej. Tambo II, Casa A1)
export type Lugar = {
  id: string;
  centro_id: string;
  nombre: string;
  activo: boolean;
};

// Bungalow dentro de un lugar (ej. Casona Hombres 1). Se asigna a cada acampante.
export type Bungalow = {
  id: string;
  lugar_id: string;
  nombre: string;
  activo: boolean;
};

export type Movimiento = {
  id: string;
  scan_list_id: string;
  dni_number: string;
  full_name: string;
  tipo: "salida" | "reingreso";
  motivo: string | null;
  created_at: string;
};

export type ListaPuerta = {
  id: string;
  title: string;
  lugar: string | null;
  created_at: string;
  en_llegada: boolean;
  total: number;
  fuera: number;
};

export type PersonaFuera = {
  id: string; // movimiento de salida
  dni: string;
  nombre: string;
  lista_id: string;
  lista: string;
  lugar: string | null;
  bungalow: string | null;
  salida_at: string;
  motivo: string | null;
};

export type OcupacionBungalow = {
  lugar: string | null;
  bungalow: string | null; // null = sin bungalow asignado
  total: number;
  fuera: number;
};

export type EstadoPuerta = {
  listas: ListaPuerta[];
  bungalows: OcupacionBungalow[];
  fuera: PersonaFuera[];
};

// Etapa de una lista según sus fechas
export type Etapa = "llegada" | "estadia" | "finalizada";

export const etapaLista = (l: { closed_at: string | null; estadia_fin_at: string | null }): Etapa =>
  !l.closed_at ? "llegada" : !l.estadia_fin_at ? "estadia" : "finalizada";

export const MOTIVOS_RAPIDOS = ["Compras", "Salud", "Permiso familiar", "Trabajo", "Paseo"];

export const horaCorta = (hora: string | null | undefined) => (hora ?? "23:00").slice(0, 5);

export const cargarCentrosYLugares = async (): Promise<{
  centros: Centro[];
  lugares: Lugar[];
  bungalows: Bungalow[];
}> => {
  const [c, l, b] = await Promise.all([
    supabase.from("centros").select("*").order("nombre"),
    supabase.from("lugares").select("*").order("nombre"),
    supabase.from("bungalows").select("*").order("nombre"),
  ]);
  if (c.error) throw c.error;
  if (l.error) throw l.error;
  if (b.error) throw b.error;
  return {
    centros: (c.data ?? []) as Centro[],
    lugares: (l.data ?? []) as Lugar[],
    bungalows: (b.data ?? []) as Bungalow[],
  };
};

// Hora a la que debía regresar quien salió en `salidaIso`.
// La "noche" se cuenta con el día anterior: quien sale a las 00:30 ya está
// pasado de la hora límite de las 23:00 del día anterior.
const CORTE_MADRUGADA = 6;

export const vencimiento = (salidaIso: string, horaLimite: string): Date => {
  const salida = new Date(salidaIso);
  const base = new Date(salida.getTime() - CORTE_MADRUGADA * 3600_000);
  const [h, m] = horaCorta(horaLimite).split(":").map(Number);
  const v = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m || 0);
  // Hora límite de madrugada (ej. 01:00): corresponde al día siguiente
  if (h < CORTE_MADRUGADA) v.setDate(v.getDate() + 1);
  return v;
};

export const estaVencido = (salidaIso: string, horaLimite: string, ahora = new Date()) =>
  ahora.getTime() >= vencimiento(salidaIso, horaLimite).getTime();

// "2 h 05 min", "35 min"
export const duracion = (desdeIso: string, hasta: Date | string = new Date()) => {
  const fin = typeof hasta === "string" ? new Date(hasta) : hasta;
  const min = Math.max(0, Math.round((fin.getTime() - new Date(desdeIso).getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h`;
  return `${h} h ${String(resto).padStart(2, "0")} min`;
};

// ================== Sonidos de la puerta ==================
// Tonos distintos para que el encargado sepa el resultado sin mirar.
let ctx: AudioContext | null = null;

const tono = (frecuencias: number[], dur = 0.12, tipo: OscillatorType = "sine") => {
  try {
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    let t = ctx.currentTime;
    for (const f of frecuencias) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tipo;
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.25, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + 0.03;
    }
  } catch {}
};

export const sonido = {
  salida: () => tono([880, 587]), // baja: sale
  reingreso: () => tono([587, 880]), // sube: regresa
  error: () => tono([220, 220], 0.2, "square"),
  alarma: () => tono([988, 740, 988, 740, 988], 0.18, "triangle"),
};

// ================== Exportar ==================
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const descargarCsv = (nombre: string, filas: unknown[][]) => {
  const csv = "﻿" + filas.map((f) => f.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
};

const fh = (iso: string) => format(new Date(iso), "dd/MM/yyyy HH:mm");

// Una fila por salida, con su reingreso (si lo hubo) y el tiempo fuera
export const filasMovimientos = (
  lista: string,
  centro: string,
  lugar: string,
  horaLimite: string | null,
  movs: Movimiento[],
  // DNI → bungalow
  bungalowDe: Map<string, string> = new Map()
): unknown[][] => {
  const filas: unknown[][] = [
    ["Lista", lista],
    ["Centro", centro || "(sin centro)"],
    ["Lugar", lugar || "(sin lugar)"],
    ["Hora límite", horaLimite ? horaCorta(horaLimite) : ""],
    ["Generado", format(new Date(), "dd/MM/yyyy HH:mm")],
    [],
    ["DNI", "Nombre", "Bungalow", "Salida", "Motivo", "Reingreso", "Tiempo fuera", "Fuera de hora"],
  ];
  for (const s of salidasConReingreso(movs)) {
    const tarde = horaLimite
      ? s.reingreso
        ? new Date(s.reingreso.created_at) > vencimiento(s.salida.created_at, horaLimite)
        : estaVencido(s.salida.created_at, horaLimite)
      : false;
    filas.push([
      s.salida.dni_number,
      s.salida.full_name,
      bungalowDe.get(s.salida.dni_number) ?? "",
      fh(s.salida.created_at),
      s.salida.motivo ?? "",
      s.reingreso ? fh(s.reingreso.created_at) : "NO REGRESÓ",
      s.reingreso ? duracion(s.salida.created_at, s.reingreso.created_at) : "",
      tarde ? "SÍ" : "",
    ]);
  }
  return filas;
};

export type Salida = { salida: Movimiento; reingreso: Movimiento | null };

// Empareja cada salida con el reingreso siguiente de la misma persona
export const salidasConReingreso = (movs: Movimiento[]): Salida[] => {
  const orden = [...movs].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const abiertas = new Map<string, Salida>();
  const res: Salida[] = [];
  for (const m of orden) {
    if (m.tipo === "salida") {
      const s = { salida: m, reingreso: null };
      abiertas.set(m.dni_number, s);
      res.push(s);
    } else {
      const s = abiertas.get(m.dni_number);
      if (s) {
        s.reingreso = m;
        abiertas.delete(m.dni_number);
      }
    }
  }
  return res;
};
