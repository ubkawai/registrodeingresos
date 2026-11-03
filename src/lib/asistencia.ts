// ================== Asistencia del personal ==================
// Tipos, cálculo de cada jornada (tardanza, horas, sobretiempo) y exportación.
// Las marcas solo se crean desde las funciones SQL marcar_asistencia y
// registrar_marca_manual; aquí solo se leen.

import { format } from "date-fns";
import type { Database } from "@/integrations/types";

export type Turno = Database["public"]["Tables"]["turnos"]["Row"];
export type Trabajador = Database["public"]["Tables"]["trabajadores"]["Row"];
export type Empleador = Database["public"]["Tables"]["empleador"]["Row"];
export type Marca = Database["public"]["Tables"]["marcas"]["Row"];
// Horario mensual: turno_id null = descanso
export type Programacion = Database["public"]["Tables"]["programacion_turnos"]["Row"];
export type Jornada = Database["public"]["Tables"]["jornadas"]["Row"] & {
  marcas: Marca[];
  trabajadores: Pick<Trabajador, "nombre_completo" | "cargo" | "area"> | null;
};

export type TipoMarca = "entrada" | "inicio_refrigerio" | "fin_refrigerio" | "salida";

export const TIPO_LABEL: Record<TipoMarca, string> = {
  entrada: "Entrada",
  inicio_refrigerio: "Inicio de refrigerio",
  fin_refrigerio: "Fin de refrigerio",
  salida: "Salida",
};

export const TIPO_CORTO: Record<TipoMarca, string> = {
  entrada: "Entrada",
  inicio_refrigerio: "Refrigerio",
  fin_refrigerio: "Vuelta",
  salida: "Salida",
};

export const ROL_LABEL: Record<string, string> = {
  admin: "Administrador",
  rrhh: "RR.HH.",
  kiosko: "Kiosko de asistencia",
  usuario: "Usuario",
};

// ================== Respuesta de marcar_asistencia ==================
export type MarcaOk = {
  ok: true;
  id: string;
  tipo: TipoMarca;
  marcado_at: string;
  dni: string;
  nombre: string;
  turno: string | null;
  programada_inicio: string | null;
  programada_fin: string | null;
  tardanza_min: number;
  marcas: { tipo: TipoMarca; marcado_at: string }[];
};

export type MarcaNo =
  | { ok: false; motivo: "dni_invalido" | "no_registrado" | "tipo_invalido"; dni: string }
  | { ok: false; motivo: "inactivo"; dni: string; nombre: string }
  | { ok: false; motivo: "reciente"; dni: string; nombre: string; tipo: TipoMarca; marcado_at: string }
  | {
      ok: false;
      motivo: "elegir";
      dni: string;
      nombre: string;
      opciones: TipoMarca[];
      sugerida: TipoMarca;
    };

export type MarcaResult = MarcaOk | MarcaNo;

// ================== Horas ==================
// "06:00:00" -> "06:00"
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

export const horaDe = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "HH:mm") : "";

export const turnoHorario = (t: Pick<Turno, "hora_inicio" | "hora_fin">) =>
  `${hhmm(t.hora_inicio)} – ${hhmm(t.hora_fin)}`;

export const cruzaMedianoche = (t: Pick<Turno, "hora_inicio" | "hora_fin">) =>
  t.hora_fin <= t.hora_inicio;

// Abreviatura de cada turno para la cuadrícula del horario mensual:
// "Noche (vigilancia)" -> "NV", "Tarde" -> "T". Si se repite, se numera.
export const abreviarTurnos = (turnos: Turno[]) => {
  const res = new Map<string, string>();
  const usadas = new Set<string>(["D"]);
  for (const t of turnos) {
    const palabras = t.nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^A-Za-z0-9]+/)
      .filter((p) => p.length >= 3);
    const base = (palabras.slice(0, 2).map((p) => p[0]).join("") || "T").toUpperCase();
    let abr = base;
    for (let i = 2; usadas.has(abr); i++) abr = `${base}${i}`;
    usadas.add(abr);
    res.set(t.id, abr);
  }
  return res;
};

// 125 -> "2 h 05 min"
export const duracion = (min: number | null | undefined) => {
  if (min == null) return "";
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return `${h} h ${String(r).padStart(2, "0")} min`;
};

// 125 -> "2:05" (para Excel)
const hMin = (min: number | null) =>
  min == null ? "" : `${Math.floor(min / 60)}:${String(Math.round(min) % 60).padStart(2, "0")}`;

const minutosEntre = (a: string, b: string) =>
  (new Date(b).getTime() - new Date(a).getTime()) / 60000;

// ================== Resumen de una jornada ==================
export type ResumenJornada = {
  entrada: Marca | null;
  inicioRef: Marca | null;
  finRef: Marca | null;
  salida: Marca | null;
  tardanzaMin: number;
  refrigerioMin: number | null;
  trabajadoMin: number | null;
  sobretiempoMin: number;
  salidaAnticipadaMin: number;
  manual: boolean;
  anuladas: Marca[];
  observaciones: string[];
};

export const resumirJornada = (j: Jornada): ResumenJornada => {
  const validas = j.marcas
    .filter((m) => !m.anulada_at)
    .sort((a, b) => a.marcado_at.localeCompare(b.marcado_at));
  const anuladas = j.marcas.filter((m) => m.anulada_at);
  const de = (t: TipoMarca) => validas.find((m) => m.tipo === t) ?? null;

  const entrada = de("entrada");
  const inicioRef = de("inicio_refrigerio");
  const finRef = de("fin_refrigerio");
  const salida = de("salida");

  let tardanzaMin = 0;
  if (entrada && j.programada_inicio) {
    const tarde = minutosEntre(j.programada_inicio, entrada.marcado_at);
    if (tarde > j.tolerancia_min) tardanzaMin = Math.floor(tarde);
  }

  const refrigerioMin =
    inicioRef && finRef ? minutosEntre(inicioRef.marcado_at, finRef.marcado_at) : null;

  const trabajadoMin =
    entrada && salida
      ? minutosEntre(entrada.marcado_at, salida.marcado_at) - (refrigerioMin ?? 0)
      : null;

  // Permanencia después del horario de salida (art. 7: se presume sobretiempo)
  const sobretiempoMin =
    salida && j.programada_fin
      ? Math.max(0, Math.floor(minutosEntre(j.programada_fin, salida.marcado_at)))
      : 0;

  const salidaAnticipadaMin =
    salida && j.programada_fin
      ? Math.max(0, Math.floor(minutosEntre(salida.marcado_at, j.programada_fin)))
      : 0;

  const observaciones: string[] = [];
  if (!entrada) observaciones.push("Sin entrada válida");
  if (entrada && !salida) observaciones.push("Sin salida");
  if (inicioRef && !finRef) observaciones.push("Refrigerio sin cierre");
  if (j.refrigerio_min > 0 && entrada && salida && !inicioRef) {
    observaciones.push("Sin marca de refrigerio");
  }
  if (refrigerioMin != null && j.refrigerio_min > 0 && refrigerioMin > j.refrigerio_min + 5) {
    observaciones.push(`Refrigerio excedido ${Math.round(refrigerioMin - j.refrigerio_min)} min`);
  }
  if (salidaAnticipadaMin > 0) observaciones.push(`Salida anticipada ${duracion(salidaAnticipadaMin)}`);
  const manual = validas.some((m) => m.origen === "manual");
  if (manual) observaciones.push("Con corrección manual");
  if (anuladas.length) observaciones.push(`${anuladas.length} marca(s) anulada(s)`);

  return {
    entrada,
    inicioRef,
    finRef,
    salida,
    tardanzaMin,
    refrigerioMin,
    trabajadoMin,
    sobretiempoMin,
    salidaAnticipadaMin,
    manual,
    anuladas,
    observaciones,
  };
};

// Estado actual de una jornada para "Hoy en vivo"
export type EstadoHoy = "dentro" | "refrigerio" | "salio";

export const estadoJornada = (j: Jornada): EstadoHoy | null => {
  const ultima = j.marcas
    .filter((m) => !m.anulada_at)
    .sort((a, b) => b.marcado_at.localeCompare(a.marcado_at))[0];
  if (!ultima) return null;
  if (ultima.tipo === "salida") return "salio";
  if (ultima.tipo === "inicio_refrigerio") return "refrigerio";
  return "dentro";
};

// ================== Exportar a Excel (CSV) ==================
// Separador ";" y BOM para que Excel en español lo abra con tildes y columnas.
const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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

const fechaHora = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "dd/MM/yyyy HH:mm") : "";

export const filasReporte = (
  empleador: Empleador | null,
  desde: string,
  hasta: string,
  jornadas: Jornada[]
): unknown[][] => [
  ["REGISTRO DE CONTROL DE ASISTENCIA (D.S. 004-2006-TR)"],
  ["Empleador", empleador?.razon_social || "(completar en Configuración)"],
  ["RUC", empleador?.ruc || "(completar en Configuración)"],
  ["Periodo", `${desde} al ${hasta}`],
  ["Generado", format(new Date(), "dd/MM/yyyy HH:mm")],
  [],
  [
    "Fecha",
    "DNI",
    "Apellidos y nombres",
    "Cargo",
    "Turno",
    "Horario",
    "Ingreso",
    "Inicio refrigerio",
    "Fin refrigerio",
    "Salida",
    "Tardanza (min)",
    "Refrigerio (h:mm)",
    "Horas trabajadas (h:mm)",
    "Sobretiempo (h:mm)",
    "Observaciones",
  ],
  ...jornadas.map((j) => {
    const r = resumirJornada(j);
    return [
      format(new Date(j.fecha + "T12:00:00"), "dd/MM/yyyy"),
      j.dni,
      j.trabajadores?.nombre_completo ?? "",
      j.trabajadores?.cargo ?? "",
      j.turno_nombre ?? "Sin turno",
      j.programada_inicio ? `${horaDe(j.programada_inicio)} - ${horaDe(j.programada_fin)}` : "",
      fechaHora(r.entrada?.marcado_at),
      fechaHora(r.inicioRef?.marcado_at),
      fechaHora(r.finRef?.marcado_at),
      fechaHora(r.salida?.marcado_at),
      r.tardanzaMin || "",
      hMin(r.refrigerioMin),
      hMin(r.trabajadoMin),
      r.sobretiempoMin ? hMin(r.sobretiempoMin) : "",
      r.observaciones.join(" | "),
    ];
  }),
];

// Detalle de todas las marcas, incluidas anuladas y manuales (trazabilidad)
export const filasMarcas = (jornadas: Jornada[]): unknown[][] => [
  [
    "Fecha y hora",
    "DNI",
    "Apellidos y nombres",
    "Tipo",
    "Origen",
    "Motivo",
    "Anulada el",
    "Motivo de anulación",
  ],
  ...jornadas
    .flatMap((j) => j.marcas.map((m) => ({ m, nombre: j.trabajadores?.nombre_completo ?? "" })))
    .sort((a, b) => a.m.marcado_at.localeCompare(b.m.marcado_at))
    .map(({ m, nombre }) => [
      fechaHora(m.marcado_at),
      m.dni,
      nombre,
      TIPO_LABEL[m.tipo as TipoMarca] ?? m.tipo,
      m.origen === "manual" ? "Manual" : "Lector",
      m.motivo ?? "",
      fechaHora(m.anulada_at),
      m.anulada_motivo ?? "",
    ]),
];

export const JORNADA_SELECT = "*, marcas(*), trabajadores(nombre_completo, cargo, area)";
