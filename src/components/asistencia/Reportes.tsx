import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import { toast } from "sonner";
import {
  Ban,
  FileDown,
  Loader2,
  Plus,
  Printer,
  Search,
} from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { cn } from "@/lib/utils";
import {
  JORNADA_SELECT,
  TIPO_LABEL,
  descargarCsv,
  duracion,
  filasMarcas,
  filasReporte,
  horaDe,
  resumirJornada,
  type Empleador,
  type Jornada,
  type Marca,
  type TipoMarca,
  type Trabajador,
} from "@/lib/asistencia";

const TIPOS: TipoMarca[] = ["entrada", "inicio_refrigerio", "fin_refrigerio", "salida"];

const hoyStr = () => format(new Date(), "yyyy-MM-dd");

export const Reportes = ({ empleador }: { empleador: Empleador | null }) => {
  const [desde, setDesde] = useState(() => format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [hasta, setHasta] = useState(hoyStr);
  const [buscar, setBuscar] = useState("");
  const [vista, setVista] = useState<"jornadas" | "resumen">("jornadas");
  const [jornadas, setJornadas] = useState<Jornada[]>([]);
  const [loading, setLoading] = useState(false);
  const [detalle, setDetalle] = useState<Jornada | null>(null);
  const [manualAbierto, setManualAbierto] = useState(false);
  const [trabajadores, setTrabajadores] = useState<Trabajador[]>([]);

  const load = async () => {
    if (desde > hasta) {
      toast.error("La fecha inicial es posterior a la final");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("jornadas")
      .select(JORNADA_SELECT)
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .order("fecha", { ascending: true })
      .order("entrada_at", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error("No se pudo cargar el reporte: " + error.message);
      return;
    }
    const lista = (data ?? []) as unknown as Jornada[];
    setJornadas(lista);
    // El detalle abierto se refresca tras una corrección
    setDetalle((d) => (d ? lista.find((j) => j.id === d.id) ?? null : null));
  };

  useEffect(() => {
    load();
    supabase
      .from("trabajadores")
      .select("*")
      .order("nombre_completo")
      .then(({ data }) => setTrabajadores(data ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtradas = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    if (!q) return jornadas;
    return jornadas.filter(
      (j) =>
        j.dni.includes(q) ||
        j.trabajadores?.nombre_completo.toLowerCase().includes(q) ||
        j.trabajadores?.area?.toLowerCase().includes(q) ||
        j.turno_nombre?.toLowerCase().includes(q)
    );
  }, [jornadas, buscar]);

  const resumen = useMemo(() => {
    const porDni = new Map<
      string,
      {
        dni: string;
        nombre: string;
        jornadas: number;
        trabajado: number;
        tardanzas: number;
        tardanzaMin: number;
        sobretiempo: number;
        incompletas: number;
      }
    >();
    for (const j of filtradas) {
      const r = resumirJornada(j);
      const acc = porDni.get(j.dni) ?? {
        dni: j.dni,
        nombre: j.trabajadores?.nombre_completo ?? j.dni,
        jornadas: 0,
        trabajado: 0,
        tardanzas: 0,
        tardanzaMin: 0,
        sobretiempo: 0,
        incompletas: 0,
      };
      acc.jornadas++;
      acc.trabajado += r.trabajadoMin ?? 0;
      if (r.tardanzaMin) {
        acc.tardanzas++;
        acc.tardanzaMin += r.tardanzaMin;
      }
      acc.sobretiempo += r.sobretiempoMin;
      if (!r.entrada || !r.salida) acc.incompletas++;
      porDni.set(j.dni, acc);
    }
    return [...porDni.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [filtradas]);

  const exportar = () => {
    descargarCsv(
      `asistencia_${desde}_${hasta}.csv`,
      filasReporte(empleador, fmt(desde), fmt(hasta), filtradas)
    );
  };

  const exportarMarcas = () => {
    descargarCsv(`marcas_detalle_${desde}_${hasta}.csv`, filasMarcas(filtradas));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-sign text-3xl font-bold">Reportes</h1>
          <p className="text-sm text-muted-foreground">
            Registro de control de asistencia. Toca una fila para ver o corregir sus marcas.
          </p>
        </div>
        <Button onClick={() => setManualAbierto(true)} variant="outline">
          <Plus className="mr-2 h-4 w-4" />
          Marca manual
        </Button>
      </div>

      {/* Encabezado que exige la norma, solo al imprimir */}
      <div className="hidden print:block">
        <p className="text-lg font-bold">Registro de control de asistencia (D.S. 004-2006-TR)</p>
        <p>
          {empleador?.razon_social || "Empleador: (completar)"} · RUC {empleador?.ruc || "(completar)"}
        </p>
        <p>
          Periodo: {fmt(desde)} al {fmt(hasta)}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4 print:hidden">
        <div className="space-y-1.5">
          <Label htmlFor="desde">Desde</Label>
          <Input id="desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hasta">Hasta</Label>
          <Input id="hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Consultar
        </Button>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filtrar por nombre, DNI, área o turno"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="mr-auto inline-flex rounded-md border bg-card p-0.5 text-sm">
          {(["jornadas", "resumen"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              className={cn(
                "rounded px-3 py-1.5 font-medium",
                vista === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              )}
            >
              {v === "jornadas" ? "Por jornada" : "Resumen por trabajador"}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={exportar} disabled={!filtradas.length}>
          <FileDown className="mr-2 h-4 w-4" />
          Excel
        </Button>
        <Button variant="outline" size="sm" onClick={exportarMarcas} disabled={!filtradas.length}>
          <FileDown className="mr-2 h-4 w-4" />
          Detalle de marcas
        </Button>
        <Button variant="outline" size="sm" onClick={() => window.print()} disabled={!filtradas.length}>
          <Printer className="mr-2 h-4 w-4" />
          Imprimir
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        {filtradas.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {loading ? "Cargando…" : "No hay jornadas en ese periodo"}
          </p>
        ) : vista === "jornadas" ? (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Trabajador</th>
                <th className="px-3 py-2">Turno</th>
                <th className="px-3 py-2">Ingreso</th>
                <th className="px-3 py-2">Refrigerio</th>
                <th className="px-3 py-2">Salida</th>
                <th className="px-3 py-2 text-right">Tardanza</th>
                <th className="px-3 py-2 text-right">Trabajado</th>
                <th className="px-3 py-2 text-right">Sobretiempo</th>
                <th className="px-3 py-2">Observaciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtradas.map((j) => {
                const r = resumirJornada(j);
                return (
                  <tr
                    key={j.id}
                    onClick={() => setDetalle(j)}
                    className="cursor-pointer align-top hover:bg-muted/40"
                  >
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fmt(j.fecha)}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{j.trabajadores?.nombre_completo}</p>
                      <p className="dni text-xs text-muted-foreground">{j.dni}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {j.turno_nombre ?? "—"}
                      {j.programada_inicio && (
                        <p className="text-xs text-muted-foreground">
                          {horaDe(j.programada_inicio)} – {horaDe(j.programada_fin)}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{horaDe(r.entrada?.marcado_at) || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                      {r.inicioRef
                        ? `${horaDe(r.inicioRef.marcado_at)} – ${horaDe(r.finRef?.marcado_at) || "?"}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{horaDe(r.salida?.marcado_at) || "—"}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        r.tardanzaMin > 0 && "font-semibold text-destructive"
                      )}
                    >
                      {r.tardanzaMin ? `${r.tardanzaMin} min` : ""}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {duracion(r.trabajadoMin)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-accent">
                      {r.sobretiempoMin ? duracion(r.sobretiempoMin) : ""}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.observaciones.join(" · ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Trabajador</th>
                <th className="px-3 py-2 text-right">Jornadas</th>
                <th className="px-3 py-2 text-right">Horas trabajadas</th>
                <th className="px-3 py-2 text-right">Tardanzas</th>
                <th className="px-3 py-2 text-right">Sobretiempo</th>
                <th className="px-3 py-2 text-right">Incompletas</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {resumen.map((r) => (
                <tr key={r.dni}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{r.nombre}</p>
                    <p className="dni text-xs text-muted-foreground">{r.dni}</p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.jornadas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{duracion(r.trabajado)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.tardanzas ? `${r.tardanzas} (${r.tardanzaMin} min)` : ""}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.sobretiempo ? duracion(r.sobretiempo) : ""}
                  </td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right tabular-nums",
                      r.incompletas > 0 && "font-semibold text-destructive"
                    )}
                  >
                    {r.incompletas || ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-muted-foreground print:hidden">
        Sobretiempo = permanencia después del horario de salida del turno. Las marcas se conservan 5
        años y no se pueden borrar; las correcciones quedan registradas con su motivo.
      </p>

      <DetalleJornada jornada={detalle} onClose={() => setDetalle(null)} onChange={load} />

      <MarcaManualDialog
        open={manualAbierto}
        onClose={() => setManualAbierto(false)}
        trabajadores={trabajadores}
        onDone={load}
      />
    </div>
  );
};

// "2026-10-21" -> "21/10/2026"
const fmt = (d: string) => format(new Date(d + "T12:00:00"), "dd/MM/yyyy");

// ================== Detalle y correcciones ==================
const DetalleJornada = ({
  jornada,
  onClose,
  onChange,
}: {
  jornada: Jornada | null;
  onClose: () => void;
  onChange: () => Promise<void>;
}) => {
  const [anular, setAnular] = useState<Marca | null>(null);
  const [agregar, setAgregar] = useState(false);

  if (!jornada) return null;
  const marcas = [...jornada.marcas].sort((a, b) => a.marcado_at.localeCompare(b.marcado_at));
  const r = resumirJornada(jornada);

  return (
    <>
      <Dialog open={!!jornada && !anular && !agregar} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{jornada.trabajadores?.nombre_completo}</DialogTitle>
            <DialogDescription>
              DNI {jornada.dni} · {fmt(jornada.fecha)} · {jornada.turno_nombre ?? "Sin turno"}
              {jornada.programada_inicio &&
                ` (${horaDe(jornada.programada_inicio)} – ${horaDe(jornada.programada_fin)})`}
            </DialogDescription>
          </DialogHeader>

          <ul className="divide-y rounded-md border">
            {marcas.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-3 py-2.5">
                <div className={cn("min-w-0 flex-1", m.anulada_at && "text-muted-foreground")}>
                  <p className={cn("font-medium", m.anulada_at && "line-through")}>
                    {TIPO_LABEL[m.tipo as TipoMarca]} ·{" "}
                    <span className="tabular-nums">
                      {format(new Date(m.marcado_at), "dd/MM HH:mm")}
                    </span>
                    {m.origen === "manual" && (
                      <Badge variant="outline" className="ml-2 px-1.5 py-0 text-[11px]">
                        Manual
                      </Badge>
                    )}
                  </p>
                  {m.motivo && <p className="text-xs">Motivo: {m.motivo}</p>}
                  {m.anulada_at && (
                    <p className="text-xs text-destructive">
                      Anulada el {format(new Date(m.anulada_at), "dd/MM/yyyy HH:mm")}:{" "}
                      {m.anulada_motivo}
                    </p>
                  )}
                </div>
                {!m.anulada_at && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setAnular(m)}
                  >
                    <Ban className="mr-1.5 h-3.5 w-3.5" />
                    Anular
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {r.observaciones.length > 0 && (
            <p className="text-sm text-muted-foreground">{r.observaciones.join(" · ")}</p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAgregar(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Agregar marca faltante
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AnularDialog
        marca={anular}
        onClose={() => setAnular(null)}
        onDone={async () => {
          setAnular(null);
          await onChange();
        }}
      />

      <MarcaManualDialog
        open={agregar}
        onClose={() => setAgregar(false)}
        dniFijo={jornada.dni}
        nombreFijo={jornada.trabajadores?.nombre_completo}
        fechaBase={jornada.programada_fin ?? jornada.entrada_at}
        tipoInicial={!r.salida ? "salida" : !r.inicioRef ? "inicio_refrigerio" : "fin_refrigerio"}
        onDone={async () => {
          setAgregar(false);
          await onChange();
        }}
      />
    </>
  );
};

const AnularDialog = ({
  marca,
  onClose,
  onDone,
}: {
  marca: Marca | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) => {
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setMotivo(""), [marca]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!marca) return;
    setSaving(true);
    const { error } = await supabase.rpc("anular_marca", { p_id: marca.id, p_motivo: motivo });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Marca anulada");
    await onDone();
  };

  return (
    <Dialog open={!!marca} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Anular marca</DialogTitle>
            <DialogDescription>
              {marca && `${TIPO_LABEL[marca.tipo as TipoMarca]} del ${format(new Date(marca.marcado_at), "dd/MM/yyyy HH:mm")}. `}
              La marca no se borra: queda tachada junto con el motivo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="motivo-anular">Motivo</Label>
            <Textarea
              id="motivo-anular"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. marcó por error dos veces"
              minLength={5}
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Anular
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const toLocalInput = (iso: string | null | undefined) =>
  format(iso ? new Date(Math.min(new Date(iso).getTime(), Date.now())) : new Date(), "yyyy-MM-dd'T'HH:mm");

const MarcaManualDialog = ({
  open,
  onClose,
  onDone,
  trabajadores,
  dniFijo,
  nombreFijo,
  fechaBase,
  tipoInicial = "entrada",
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<void> | void;
  trabajadores?: Trabajador[];
  dniFijo?: string;
  nombreFijo?: string;
  fechaBase?: string | null;
  tipoInicial?: TipoMarca;
}) => {
  const [dni, setDni] = useState(dniFijo ?? "");
  const [tipo, setTipo] = useState<TipoMarca>(tipoInicial);
  const [cuando, setCuando] = useState(() => toLocalInput(fechaBase));
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDni(dniFijo ?? "");
    setTipo(tipoInicial);
    setCuando(toLocalInput(fechaBase));
    setMotivo("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dni) {
      toast.error("Elige al trabajador");
      return;
    }
    setSaving(true);
    const { error } = await supabase.rpc("registrar_marca_manual", {
      p_dni: dni,
      p_tipo: tipo,
      p_marcado_at: new Date(cuando).toISOString(),
      p_motivo: motivo,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Marca manual registrada");
    await onDone();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Marca manual</DialogTitle>
            <DialogDescription>
              Para olvidos o fallas del lector. Queda identificada como manual, con el motivo y
              quién la registró.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label>Trabajador</Label>
            {dniFijo ? (
              <p className="text-sm font-medium">
                {nombreFijo} <span className="dni text-muted-foreground">{dniFijo}</span>
              </p>
            ) : (
              <Select value={dni} onValueChange={setDni}>
                <SelectTrigger>
                  <SelectValue placeholder="Elige al trabajador" />
                </SelectTrigger>
                <SelectContent>
                  {(trabajadores ?? []).map((w) => (
                    <SelectItem key={w.dni} value={w.dni}>
                      {w.nombre_completo} · {w.dni}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as TipoMarca)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPO_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cuando">Fecha y hora</Label>
              <Input
                id="cuando"
                type="datetime-local"
                value={cuando}
                max={toLocalInput(null)}
                onChange={(e) => setCuando(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="motivo-manual">Motivo</Label>
            <Textarea
              id="motivo-manual"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej. olvidó marcar la salida; confirmado por su supervisor"
              minLength={5}
              required
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
