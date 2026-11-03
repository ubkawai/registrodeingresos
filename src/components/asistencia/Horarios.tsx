import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Eraser,
  Loader2,
  MoreVertical,
  Printer,
  Repeat,
  Save,
  Search,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, startOfMonth } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  abreviarTurnos,
  turnoHorario,
  type Empleador,
  type Programacion,
  type Trabajador,
  type Turno,
} from "@/lib/asistencia";

// Horario mensual (rol de turnos) del personal con horario rotativo.
// Cada celda es el turno de un trabajador en un día: un turno, descanso ("D")
// o vacía (sin programar). Los cambios se acumulan y se guardan juntos.

// undefined = sin programar, null = descanso, string = id del turno
type Celda = string | null | undefined;

const DESCANSO = "descanso";
const BORRAR = "borrar";

// Colores de los turnos en la cuadrícula (por orden de hora de inicio)
const COLORES = [
  "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100",
  "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
  "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/50 dark:text-indigo-100",
  "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100",
  "bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100",
  "bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100",
  "bg-teal-100 text-teal-900 dark:bg-teal-900/50 dark:text-teal-100",
  "bg-orange-100 text-orange-900 dark:bg-orange-900/50 dark:text-orange-100",
];
const COLOR_DESCANSO = "bg-muted text-muted-foreground";

const clave = (dni: string, fecha: string) => `${dni}|${fecha}`;
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

export const Horarios = ({
  turnos,
  empleador,
}: {
  turnos: Turno[];
  empleador: Empleador | null;
}) => {
  const [mes, setMes] = useState(() => startOfMonth(new Date()));
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([]);
  const [guardado, setGuardado] = useState<Map<string, Celda>>(new Map());
  const [cambios, setCambios] = useState<Map<string, Celda>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pincel, setPincel] = useState<string>(DESCANSO);
  const [agregando, setAgregando] = useState(false);
  const [patronPara, setPatronPara] = useState<Trabajador | null>(null);
  const pintando = useRef(false);

  const activos = useMemo(() => turnos.filter((t) => t.activo), [turnos]);
  const abrev = useMemo(() => abreviarTurnos(turnos), [turnos]);
  const color = useMemo(
    () => new Map(turnos.map((t, i) => [t.id, COLORES[i % COLORES.length]])),
    [turnos]
  );
  const turnoPorId = useMemo(() => new Map(turnos.map((t) => [t.id, t])), [turnos]);

  const dias = useMemo(
    () => eachDayOfInterval({ start: mes, end: endOfMonth(mes) }),
    [mes]
  );
  const hoy = ymd(new Date());

  const rotativos = useMemo(
    () => trabajadores.filter((w) => w.activo && w.horario_mensual),
    [trabajadores]
  );

  const loadTrabajadores = async () => {
    const { data, error } = await supabase
      .from("trabajadores")
      .select("*")
      .order("nombre_completo", { ascending: true });
    if (error) toast.error("No se pudieron cargar los trabajadores: " + error.message);
    else setTrabajadores(data ?? []);
  };

  const loadProgramacion = async (m: Date) => {
    setLoading(true);
    const { data, error } = await supabase
      .from("programacion_turnos")
      .select("*")
      .gte("fecha", ymd(m))
      .lte("fecha", ymd(endOfMonth(m)));
    setLoading(false);
    if (error) {
      toast.error("No se pudo cargar el horario: " + error.message);
      return;
    }
    setGuardado(
      new Map((data as Programacion[]).map((p) => [clave(p.dni, p.fecha), p.turno_id]))
    );
    setCambios(new Map());
  };

  useEffect(() => {
    loadTrabajadores();
  }, []);

  useEffect(() => {
    loadProgramacion(mes);
  }, [mes]);

  useEffect(() => {
    const fin = () => (pintando.current = false);
    window.addEventListener("pointerup", fin);
    return () => window.removeEventListener("pointerup", fin);
  }, []);

  // Avisar si se cierra la página con cambios sin guardar
  useEffect(() => {
    if (!cambios.size) return;
    const aviso = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [cambios.size]);

  const valor = (k: string): Celda => (cambios.has(k) ? cambios.get(k) : guardado.get(k));

  // Aplica varios valores a la vez; si una celda vuelve a lo guardado deja de ser un cambio
  const aplicar = (valores: [string, Celda][]) =>
    setCambios((prev) => {
      const next = new Map(prev);
      for (const [k, v] of valores) {
        if (v === guardado.get(k)) next.delete(k);
        else next.set(k, v);
      }
      return next;
    });

  const valorPincel = (): Celda =>
    pincel === BORRAR ? undefined : pincel === DESCANSO ? null : pincel;

  const pintar = (dni: string, fecha: string) => aplicar([[clave(dni, fecha), valorPincel()]]);

  const cambiarMes = (delta: number) => {
    if (
      cambios.size &&
      !window.confirm(`Hay ${cambios.size} cambio(s) sin guardar que se perderán. ¿Continuar?`)
    )
      return;
    setMes((m) => addMonths(m, delta));
  };

  const guardar = async () => {
    if (!cambios.size) return;
    setSaving(true);
    const upserts: { dni: string; fecha: string; turno_id: string | null }[] = [];
    const borrar = new Map<string, string[]>();
    for (const [k, v] of cambios) {
      const [dni, fecha] = k.split("|");
      if (v === undefined) borrar.set(dni, [...(borrar.get(dni) ?? []), fecha]);
      else upserts.push({ dni, fecha, turno_id: v });
    }

    const resultados = await Promise.all([
      upserts.length
        ? supabase.from("programacion_turnos").upsert(upserts, { onConflict: "dni,fecha" })
        : Promise.resolve({ error: null }),
      ...[...borrar].map(([dni, fechas]) =>
        supabase.from("programacion_turnos").delete().eq("dni", dni).in("fecha", fechas)
      ),
    ]);
    setSaving(false);
    const error = resultados.find((r) => r.error)?.error;
    if (error) {
      toast.error("No se pudo guardar el horario: " + error.message);
      return;
    }
    toast.success(`Horario de ${format(mes, "MMMM yyyy", { locale: es })} guardado`);
    await loadProgramacion(mes);
  };

  const quitarDelHorario = async (w: Trabajador) => {
    if (
      !window.confirm(
        `¿Quitar a ${w.nombre_completo} del horario mensual? Volverá a usar el turno fijo de su ficha. Lo ya programado se conserva.`
      )
    )
      return;
    const { error } = await supabase
      .from("trabajadores")
      .update({ horario_mensual: false })
      .eq("dni", w.dni);
    if (error) toast.error(error.message);
    else loadTrabajadores();
  };

  const limpiarFila = (w: Trabajador) =>
    aplicar(dias.map((d) => [clave(w.dni, ymd(d)), undefined]));

  // Copia a este mes el turno del mismo día del mes anterior
  const copiarMesAnterior = async () => {
    const anterior = addMonths(mes, -1);
    const { data, error } = await supabase
      .from("programacion_turnos")
      .select("*")
      .gte("fecha", ymd(anterior))
      .lte("fecha", ymd(endOfMonth(anterior)));
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data?.length) {
      toast.error("El mes anterior no tiene horario");
      return;
    }
    const valores: [string, Celda][] = [];
    for (const p of data as Programacion[]) {
      const dia = Number(p.fecha.slice(8, 10));
      if (dia > dias.length) continue;
      const k = clave(p.dni, ymd(dias[dia - 1]));
      if (valor(k) === undefined) valores.push([k, p.turno_id]);
    }
    aplicar(valores);
    toast.success(`${valores.length} día(s) copiados; revisa y guarda`);
  };

  const sinProgramar = (w: Trabajador) =>
    dias.filter((d) => valor(clave(w.dni, ymd(d))) === undefined).length;

  // Cuántos trabajan cada día (sin contar descansos)
  const cobertura = dias.map(
    (d) => rotativos.filter((w) => typeof valor(clave(w.dni, ymd(d))) === "string").length
  );

  const pinceles = [
    ...activos.map((t) => ({
      key: t.id,
      abr: abrev.get(t.id)!,
      label: t.nombre,
      detalle: turnoHorario(t),
      clase: color.get(t.id)!,
    })),
    { key: DESCANSO, abr: "D", label: "Descanso", detalle: "", clase: COLOR_DESCANSO },
  ];

  const tituloMes = format(mes, "MMMM yyyy", { locale: es });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-sign text-3xl font-bold">Horario mensual</h1>
          <p className="text-sm text-muted-foreground">
            Turnos rotativos día por día. Cambiarlos no altera las jornadas ya marcadas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setAgregando(true)}>
            <UserPlus className="mr-2 h-4 w-4" />
            Agregar trabajadores
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimir
          </Button>
        </div>
      </div>

      {/* Mes */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <div className="flex items-center gap-1 rounded-lg border bg-card p-1">
          <Button variant="ghost" size="icon" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[150px] text-center font-semibold capitalize">{tituloMes}</span>
          <Button variant="ghost" size="icon" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={copiarMesAnterior} disabled={!rotativos.length}>
          <Copy className="mr-2 h-4 w-4" />
          Copiar mes anterior
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {cambios.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">{cambios.size} cambio(s) sin guardar</span>
              <Button variant="ghost" size="sm" onClick={() => setCambios(new Map())} disabled={saving}>
                <X className="mr-1 h-4 w-4" />
                Descartar
              </Button>
            </>
          )}
          <Button onClick={guardar} disabled={saving || !cambios.size}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Guardar
          </Button>
        </div>
      </div>

      {/* Pincel */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 print:hidden">
        <span className="mr-1 text-sm text-muted-foreground">Elige y toca los días:</span>
        {pinceles.map((p) => (
          <button
            key={p.key}
            onClick={() => setPincel(p.key)}
            aria-pressed={pincel === p.key}
            title={p.detalle ? `${p.label} · ${p.detalle}` : p.label}
            className={cn(
              "flex items-center gap-2 rounded-md border px-2 py-1 text-sm transition",
              pincel === p.key ? "border-primary ring-2 ring-primary" : "hover:border-foreground/30"
            )}
          >
            <span className={cn("rounded px-1.5 py-0.5 text-xs font-bold", p.clase)}>{p.abr}</span>
            <span>{p.label}</span>
            {p.detalle && <span className="tabular-nums text-muted-foreground">{p.detalle}</span>}
          </button>
        ))}
        <button
          onClick={() => setPincel(BORRAR)}
          aria-pressed={pincel === BORRAR}
          className={cn(
            "flex items-center gap-2 rounded-md border px-2 py-1 text-sm transition",
            pincel === BORRAR ? "border-primary ring-2 ring-primary" : "hover:border-foreground/30"
          )}
        >
          <Eraser className="h-4 w-4" />
          Borrar
        </button>
      </div>

      {/* Encabezado impreso */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold capitalize">Rol de turnos · {tituloMes}</h1>
        <p>
          {empleador?.razon_social} {empleador?.ruc && `· RUC ${empleador.ruc}`}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cargando…
        </div>
      ) : rotativos.length === 0 ? (
        <div className="rounded-lg border bg-card px-4 py-12 text-center text-sm text-muted-foreground">
          <p>Aún no hay trabajadores con horario rotativo.</p>
          <p className="mt-1">
            Usa “Agregar trabajadores” o, en la ficha del trabajador, elige el turno “Rotativo
            (horario mensual)”.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card print:overflow-visible">
          <table className="w-full border-collapse select-none text-sm print:text-[9px]">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 z-10 min-w-[180px] bg-card px-3 py-2 text-left font-semibold">
                  Trabajador
                </th>
                {dias.map((d) => {
                  const finde = getDay(d) === 0 || getDay(d) === 6;
                  return (
                    <th
                      key={ymd(d)}
                      className={cn(
                        "min-w-[34px] px-0.5 py-1 text-center font-medium",
                        finde && "text-destructive",
                        ymd(d) === hoy && "bg-primary/10"
                      )}
                    >
                      <div className="text-[10px] uppercase leading-none text-muted-foreground">
                        {format(d, "EEEEE", { locale: es })}
                      </div>
                      <div className="tabular-nums">{format(d, "d")}</div>
                    </th>
                  );
                })}
                <th className="w-10 print:hidden" />
              </tr>
            </thead>
            <tbody>
              {rotativos.map((w) => {
                const faltan = sinProgramar(w);
                return (
                  <tr key={w.dni} className="border-b last:border-b-0">
                    <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
                      <p className="max-w-[220px] truncate font-medium">{w.nombre_completo}</p>
                      <p className="text-xs text-muted-foreground print:hidden">
                        {faltan ? (
                          <span className="text-warning">{faltan} día(s) sin programar</span>
                        ) : (
                          <span className="dni">{w.dni}</span>
                        )}
                      </p>
                    </td>
                    {dias.map((d) => {
                      const fecha = ymd(d);
                      const k = clave(w.dni, fecha);
                      const v = valor(k);
                      const t = typeof v === "string" ? turnoPorId.get(v) : undefined;
                      return (
                        <td
                          key={fecha}
                          className={cn("p-0.5", fecha === hoy && "bg-primary/10")}
                        >
                          <button
                            type="button"
                            onPointerDown={(e) => {
                              e.preventDefault();
                              pintando.current = true;
                              pintar(w.dni, fecha);
                            }}
                            onPointerEnter={() => pintando.current && pintar(w.dni, fecha)}
                            title={`${format(d, "EEEE d", { locale: es })}: ${
                              t ? `${t.nombre} ${turnoHorario(t)}` : v === null ? "Descanso" : "Sin programar"
                            }`}
                            className={cn(
                              "flex h-8 w-full min-w-[30px] items-center justify-center rounded text-xs font-bold print:h-5",
                              t ? color.get(t.id) : v === null ? COLOR_DESCANSO : "border border-dashed",
                              cambios.has(k) && "ring-2 ring-primary/60"
                            )}
                          >
                            {t ? abrev.get(t.id) : v === null ? "D" : ""}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-1 print:hidden">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Acciones para ${w.nombre_completo}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setPatronPara(w)}>
                            <Repeat className="mr-2 h-4 w-4" />
                            Rellenar con patrón
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => limpiarFila(w)}>
                            <Eraser className="mr-2 h-4 w-4" />
                            Borrar el mes
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => quitarDelHorario(w)}>
                            <UserMinus className="mr-2 h-4 w-4" />
                            Quitar del horario mensual
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t bg-muted/40 text-xs text-muted-foreground">
                <td className="sticky left-0 z-10 bg-muted px-3 py-1.5 font-medium">
                  Trabajan ese día
                </td>
                {cobertura.map((n, i) => (
                  <td key={i} className="text-center tabular-nums">
                    {n}
                  </td>
                ))}
                <td className="print:hidden" />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Leyenda */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {pinceles.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5">
            <span className={cn("rounded px-1 font-bold", p.clase)}>{p.abr}</span>
            {p.label} {p.detalle && <span className="tabular-nums">({p.detalle})</span>}
          </span>
        ))}
        <span className="print:hidden">Celda vacía: sin programar (la jornada queda sin turno)</span>
      </div>

      <AgregarDialog
        open={agregando}
        trabajadores={trabajadores.filter((w) => w.activo && !w.horario_mensual)}
        onClose={() => setAgregando(false)}
        onDone={() => {
          setAgregando(false);
          loadTrabajadores();
        }}
      />

      <PatronDialog
        trabajador={patronPara}
        pinceles={pinceles}
        dias={dias}
        onClose={() => setPatronPara(null)}
        onAplicar={(valores) => {
          aplicar(valores);
          setPatronPara(null);
        }}
      />
    </div>
  );
};

const AgregarDialog = ({
  open,
  trabajadores,
  onClose,
  onDone,
}: {
  open: boolean;
  trabajadores: Trabajador[];
  onClose: () => void;
  onDone: () => void;
}) => {
  const [buscar, setBuscar] = useState("");
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setBuscar("");
      setElegidos(new Set());
    }
  }, [open]);

  const q = buscar.trim().toLowerCase();
  const filtrados = trabajadores.filter(
    (w) =>
      !q ||
      w.dni.includes(q) ||
      w.nombre_completo.toLowerCase().includes(q) ||
      w.cargo?.toLowerCase().includes(q) ||
      w.area?.toLowerCase().includes(q)
  );

  const toggle = (dni: string) =>
    setElegidos((prev) => {
      const next = new Set(prev);
      if (next.has(dni)) next.delete(dni);
      else next.add(dni);
      return next;
    });

  const submit = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("trabajadores")
      .update({ horario_mensual: true })
      .in("dni", [...elegidos]);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${elegidos.size} trabajador(es) agregados al horario mensual`);
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar al horario mensual</DialogTitle>
          <DialogDescription>
            Desde ahora su turno se toma del horario de cada día, no del turno fijo de su ficha.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, DNI, cargo o área (ej. vigilancia)"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            className="pl-9"
          />
        </div>
        <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
          {filtrados.length === 0 ? (
            <li className="px-3 py-6 text-center text-muted-foreground">Ningún trabajador</li>
          ) : (
            filtrados.map((w) => (
              <li key={w.dni}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={elegidos.has(w.dni)}
                    onChange={() => toggle(w.dni)}
                  />
                  <span className="min-w-0 flex-1 truncate">{w.nombre_completo}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {[w.cargo, w.area].filter(Boolean).join(" · ")}
                  </span>
                </label>
              </li>
            ))
          )}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving || elegidos.size === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Agregar {elegidos.size || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

type Pincel = { key: string; abr: string; label: string; detalle: string; clase: string };

// Repite una secuencia (ej. N N N N D D) desde un día hasta fin de mes
const PatronDialog = ({
  trabajador,
  pinceles,
  dias,
  onClose,
  onAplicar,
}: {
  trabajador: Trabajador | null;
  pinceles: Pincel[];
  dias: Date[];
  onClose: () => void;
  onAplicar: (valores: [string, Celda][]) => void;
}) => {
  const [secuencia, setSecuencia] = useState<string[]>([]);
  const [desde, setDesde] = useState("1");

  useEffect(() => {
    if (trabajador) {
      setSecuencia([]);
      setDesde("1");
    }
  }, [trabajador]);

  const porKey = new Map(pinceles.map((p) => [p.key, p]));

  const aplicar = () => {
    if (!trabajador || !secuencia.length) return;
    const inicio = Number(desde) - 1;
    onAplicar(
      dias.slice(inicio).map((d, i) => {
        const key = secuencia[i % secuencia.length];
        return [clave(trabajador.dni, ymd(d)), key === DESCANSO ? null : key];
      })
    );
  };

  return (
    <Dialog open={!!trabajador} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rellenar con patrón</DialogTitle>
          <DialogDescription>
            {trabajador?.nombre_completo}: arma la secuencia de turnos y se repetirá hasta fin de
            mes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Agrega en orden</Label>
          <div className="flex flex-wrap gap-2">
            {pinceles.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setSecuencia((s) => [...s, p.key])}
                title={p.detalle ? `${p.label} · ${p.detalle}` : p.label}
                className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm hover:border-foreground/30"
              >
                <span className={cn("rounded px-1.5 py-0.5 text-xs font-bold", p.clase)}>{p.abr}</span>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>Secuencia ({secuencia.length} días)</Label>
            {secuencia.length > 0 && (
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => setSecuencia((s) => s.slice(0, -1))}
              >
                Quitar el último
              </button>
            )}
          </div>
          <div className="flex min-h-10 flex-wrap gap-1 rounded-md border p-2">
            {secuencia.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                Ej. 4 noches y 2 descansos: NV NV NV NV D D
              </span>
            ) : (
              secuencia.map((k, i) => {
                const p = porKey.get(k);
                return (
                  <span key={i} className={cn("rounded px-1.5 py-0.5 text-xs font-bold", p?.clase)}>
                    {p?.abr ?? "?"}
                  </span>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Desde el día</Label>
          <Select value={desde} onValueChange={setDesde}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dias.map((d, i) => (
                <SelectItem key={i} value={String(i + 1)}>
                  {format(d, "EEE d", { locale: es })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={aplicar} disabled={!secuencia.length}>
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
