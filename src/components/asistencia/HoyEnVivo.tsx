import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/client";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  JORNADA_SELECT,
  duracion,
  estadoJornada,
  horaDe,
  hhmm,
  resumirJornada,
  type Jornada,
  type Trabajador,
  type Turno,
} from "@/lib/asistencia";

// Quién está dentro ahora, quién está en refrigerio, quién ya salió y a
// quién le empezó el turno sin haber marcado. Se actualiza con cada marca.

const minutosDesde = (iso: string, ahora: Date) =>
  (ahora.getTime() - new Date(iso).getTime()) / 60000;

// Jornada sin salida que ya pasó su plazo (olvidó marcar la salida)
// (mismo criterio que marcar_asistencia en la BD)
const abandonada = (j: Jornada, ahora: Date) => {
  const entrada = new Date(j.entrada_at).getTime();
  const limite = Math.min(
    j.programada_fin
      ? new Date(j.programada_fin).getTime() + 6 * 3600_000
      : entrada + 16 * 3600_000,
    entrada + 20 * 3600_000
  );
  return ahora.getTime() > limite;
};

export const HoyEnVivo = ({ turnos }: { turnos: Turno[] }) => {
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([]);
  // Turno programado hoy de quienes tienen horario mensual (null = descanso)
  const [programacionHoy, setProgramacionHoy] = useState<Map<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [ahora, setAhora] = useState(() => new Date());
  const reloadTimer = useRef<number | null>(null);

  const load = async () => {
    const desde = new Date(Date.now() - 40 * 3600_000).toISOString();
    const [j, t, p] = await Promise.all([
      supabase
        .from("jornadas")
        .select(JORNADA_SELECT)
        .gte("entrada_at", desde)
        .order("entrada_at", { ascending: false }),
      supabase.from("trabajadores").select("*").eq("activo", true),
      supabase
        .from("programacion_turnos")
        .select("dni, turno_id")
        .eq("fecha", format(new Date(), "yyyy-MM-dd")),
    ]);
    if (j.error) toast.error("No se pudo cargar la asistencia: " + j.error.message);
    else setJornadas((j.data ?? []) as unknown as Jornada[]);
    if (!t.error) setTrabajadores(t.data ?? []);
    if (!p.error) setProgramacionHoy(new Map((p.data ?? []).map((r) => [r.dni, r.turno_id])));
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("asistencia-hoy")
      .on("postgres_changes", { event: "*", schema: "public", table: "marcas" }, () => {
        // Varias marcas seguidas -> una sola recarga
        if (reloadTimer.current) window.clearTimeout(reloadTimer.current);
        reloadTimer.current = window.setTimeout(load, 400);
      })
      .subscribe();
    const tick = window.setInterval(() => setAhora(new Date()), 30_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const hoy = format(ahora, "yyyy-MM-dd");

  const grupos = useMemo(() => {
    const dentro: Jornada[] = [];
    const refrigerio: Jornada[] = [];
    const salieron: Jornada[] = [];
    const sinSalida: Jornada[] = [];
    for (const j of jornadas) {
      const estado = estadoJornada(j);
      if (!estado) continue;
      if (estado === "salio") {
        if (j.fecha === hoy) salieron.push(j);
      } else if (abandonada(j, ahora)) {
        sinSalida.push(j);
      } else if (estado === "refrigerio") {
        refrigerio.push(j);
      } else {
        dentro.push(j);
      }
    }

    const conJornadaHoy = new Set(jornadas.filter((j) => j.fecha === hoy).map((j) => j.dni));
    const turnoPorId = new Map(turnos.map((t) => [t.id, t]));
    const pendientes = trabajadores
      .map((w) => {
        const id = w.horario_mensual ? programacionHoy.get(w.dni) : w.turno_id;
        return { w, t: id ? turnoPorId.get(id) : undefined };
      })
      .filter(({ w, t }) => {
        if (!t || conJornadaHoy.has(w.dni)) return false;
        const inicio = new Date(`${hoy}T${t.hora_inicio}`);
        return ahora >= inicio;
      })
      .sort((a, b) => a.t!.hora_inicio.localeCompare(b.t!.hora_inicio));

    const tardanzas = jornadas.filter(
      (j) => j.fecha === hoy && resumirJornada(j).tardanzaMin > 0
    ).length;

    return { dentro, refrigerio, salieron, sinSalida, pendientes, tardanzas };
  }, [jornadas, trabajadores, programacionHoy, turnos, ahora, hoy]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Cargando asistencia…
      </div>
    );
  }

  const tiles = [
    { label: "Dentro", value: grupos.dentro.length, dot: "bg-success" },
    { label: "En refrigerio", value: grupos.refrigerio.length, dot: "bg-warning" },
    { label: "Salieron hoy", value: grupos.salieron.length, dot: "bg-accent" },
    { label: "Tardanzas hoy", value: grupos.tardanzas, dot: "bg-destructive" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-sign text-3xl font-bold">Hoy</h1>
          <p className="text-sm capitalize text-muted-foreground">
            {format(ahora, "EEEE d 'de' MMMM", { locale: es })} · se actualiza con cada marca
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Actualizar
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border bg-card p-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full", t.dot)} />
              {t.label}
            </p>
            <p className="font-sign mt-1 text-4xl font-bold tabular-nums">{t.value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Grupo titulo="Dentro ahora" vacio="Nadie dentro en este momento">
          {grupos.dentro.map((j) => {
            const r = resumirJornada(j);
            return (
              <Fila
                key={j.id}
                nombre={j.trabajadores?.nombre_completo ?? j.dni}
                detalle={`${j.turno_nombre ?? "Sin turno"} · entró ${horaDe(r.entrada?.marcado_at)}`}
                extra={r.tardanzaMin > 0 ? `${r.tardanzaMin} min tarde` : undefined}
                extraTone="destructive"
                derecha={duracion(minutosDesde(j.entrada_at, ahora))}
              />
            );
          })}
        </Grupo>

        <Grupo titulo="En refrigerio" vacio="Nadie en refrigerio">
          {grupos.refrigerio.map((j) => {
            const r = resumirJornada(j);
            const desde = r.inicioRef?.marcado_at;
            const min = desde ? minutosDesde(desde, ahora) : 0;
            const excedido = j.refrigerio_min > 0 && min > j.refrigerio_min;
            return (
              <Fila
                key={j.id}
                nombre={j.trabajadores?.nombre_completo ?? j.dni}
                detalle={`desde ${horaDe(desde)} · le corresponden ${j.refrigerio_min} min`}
                extra={excedido ? `Excedido ${Math.round(min - j.refrigerio_min)} min` : undefined}
                extraTone="warning"
                derecha={duracion(min)}
              />
            );
          })}
        </Grupo>

        <Grupo
          titulo="Turno empezado sin marca"
          vacio="Todos los que tienen turno ya marcaron"
          nota="En turnos fijos incluye a quienes tienen descanso hoy; los rotativos siguen el horario mensual."
        >
          {grupos.pendientes.map(({ w, t }) => (
            <Fila
              key={w.dni}
              nombre={w.nombre_completo}
              detalle={`${t!.nombre} · empezó ${hhmm(t!.hora_inicio)}`}
              derecha={w.cargo ?? ""}
            />
          ))}
        </Grupo>

        <Grupo titulo="Salieron hoy" vacio="Nadie ha salido todavía">
          {grupos.salieron.map((j) => {
            const r = resumirJornada(j);
            return (
              <Fila
                key={j.id}
                nombre={j.trabajadores?.nombre_completo ?? j.dni}
                detalle={`${horaDe(r.entrada?.marcado_at)} – ${horaDe(r.salida?.marcado_at)}`}
                extra={r.sobretiempoMin > 0 ? `+${duracion(r.sobretiempoMin)} sobretiempo` : undefined}
                extraTone="accent"
                derecha={duracion(r.trabajadoMin)}
              />
            );
          })}
        </Grupo>

        {grupos.sinSalida.length > 0 && (
          <Grupo
            titulo="Sin marca de salida"
            vacio=""
            nota="Corrígelo en Reportes agregando la salida con su motivo."
          >
            {grupos.sinSalida.map((j) => (
              <Fila
                key={j.id}
                nombre={j.trabajadores?.nombre_completo ?? j.dni}
                detalle={`${j.turno_nombre ?? "Sin turno"} · entró ${format(new Date(j.entrada_at), "dd/MM HH:mm")}`}
                extra="Olvidó marcar"
                extraTone="destructive"
              />
            ))}
          </Grupo>
        )}
      </div>
    </div>
  );
};

const Grupo = ({
  titulo,
  vacio,
  nota,
  children,
}: {
  titulo: string;
  vacio: string;
  nota?: string;
  children: React.ReactNode[];
}) => (
  <section className="rounded-lg border bg-card">
    <div className="flex items-baseline justify-between gap-3 border-b px-4 py-3">
      <h2 className="font-semibold">{titulo}</h2>
      <span className="text-sm tabular-nums text-muted-foreground">{children.length}</span>
    </div>
    {nota && <p className="px-4 pt-2 text-xs text-muted-foreground">{nota}</p>}
    {children.length === 0 ? (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">{vacio}</p>
    ) : (
      <ul className="max-h-[420px] divide-y overflow-y-auto">{children}</ul>
    )}
  </section>
);

const Fila = ({
  nombre,
  detalle,
  extra,
  extraTone,
  derecha,
}: {
  nombre: string;
  detalle: string;
  extra?: string;
  extraTone?: "destructive" | "warning" | "accent";
  derecha?: string;
}) => (
  <li className="flex items-center gap-3 px-4 py-2.5">
    <div className="min-w-0 flex-1">
      <p className="truncate font-medium">{nombre}</p>
      <p className="truncate text-sm text-muted-foreground">
        {detalle}
        {extra && (
          <span
            className={cn(
              "ml-2 font-semibold",
              extraTone === "destructive" && "text-destructive",
              extraTone === "warning" && "text-warning",
              extraTone === "accent" && "text-accent"
            )}
          >
            {extra}
          </span>
        )}
      </p>
    </div>
    {derecha && <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{derecha}</span>}
  </li>
);
