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
import { toast } from "sonner";
import {
  AlarmClock,
  UserX,
  Ban,
  Flag,
  ArrowLeftFromLine,
  ArrowRight,
  ArrowRightToLine,
  Bell,
  CircleX,
  Loader2,
  MapPin,
  RotateCcw,
  ScanBarcode,
  Settings2,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { extractDniFromBarcode } from "@/lib/dni";
import {
  MOTIVOS_RAPIDOS,
  duracion,
  estaVencido,
  horaCorta,
  sonido,
  vencimiento,
  type EstadoPuerta,
  type Centro,
} from "@/lib/estadia";

type Lectura =
  | {
      estado: "salida" | "reingreso";
      id: string;
      dni: string;
      nombre: string;
      lista: string;
      lugar?: string | null;
      bungalow?: string | null;
      at: string;
      salidaAt?: string | null;
      salidaMotivo?: string | null;
      tarde?: boolean;
      // Salida después del check-out: ya no vuelve
      final?: boolean;
    }
  | { estado: "repetido"; dni: string; nombre: string; lista: string; tipo: string }
  | {
      estado: "terminada";
      dni: string;
      nombre: string;
      lista: string;
      lugar?: string | null;
      bungalow?: string | null;
      checkoutAt: string | null;
      por: "retiro" | "checkout";
      salidaAt: string;
    }
  | { estado: "no_pertenece"; dni: string; nombre?: string; otroCentro?: string; lista?: string }
  | { estado: "error"; dni: string; mensaje: string };

const centroKey = "puerta:centro";

const leerCentro = () => {
  try {
    return localStorage.getItem(centroKey);
  } catch {
    return null;
  }
};

const isTouch =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

export const Puerta = ({
  active,
  isAdmin,
  centros,
  onAdministrar,
  onVencidos,
}: {
  // La pestaña está a la vista (el componente sigue montado para avisar a las 23:00)
  active: boolean;
  isAdmin: boolean;
  centros: Centro[];
  onAdministrar: () => void;
  onVencidos: (n: number) => void;
}) => {
  const activos = useMemo(() => centros.filter((l) => l.activo), [centros]);
  const [centroId, setLugarId] = useState<string | null>(leerCentro);
  const centro = centros.find((l) => l.id === centroId) ?? null;
  const horaLimite = centro?.hora_limite ?? "23:00";

  // Si el centro recordado ya no existe, se elige el único disponible
  useEffect(() => {
    if (centros.length === 0) return;
    if (!centro && activos.length === 1) elegirCentro(activos[0].id);
  }, [centros]);

  const elegirCentro = (id: string) => {
    setLugarId(id);
    setEstado(null);
    setLectura(null);
    try {
      localStorage.setItem(centroKey, id);
    } catch {}
  };

  const [estado, setEstado] = useState<EstadoPuerta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [ahora, setAhora] = useState(() => new Date());

  const centroRef = useRef(centroId);
  centroRef.current = centroId;

  const cargar = async () => {
    const id = centroRef.current;
    if (!id) return;
    const { data, error } = await supabase.rpc("estado_puerta", { p_centro_id: id });
    if (error) {
      console.error(error);
      return;
    }
    if (centroRef.current === id) setEstado(data as unknown as EstadoPuerta);
  };

  // Recarga agrupada: varias lecturas seguidas generan una sola consulta
  const recargaRef = useRef<number | null>(null);
  const recargar = () => {
    if (recargaRef.current) window.clearTimeout(recargaRef.current);
    recargaRef.current = window.setTimeout(cargar, 300);
  };

  useEffect(() => {
    if (!centroId) return;
    setCargando(true);
    cargar().finally(() => setCargando(false));

    // Otros equipos en la misma puerta (o en otra puerta del mismo centro)
    const channel = supabase
      .channel(`puerta-${centroId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "movimientos" }, recargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "scan_lists" }, recargar)
      .subscribe();

    // Llegadas registradas por otras cuentas no llegan por Realtime (RLS):
    // se repasa cada 30 s
    const intervalo = window.setInterval(() => {
      setAhora(new Date());
      cargar();
    }, 30_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setAhora(new Date());
        cargar();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [centroId]);

  // ================== Quiénes están fuera ==================
  const fuera = useMemo(() => {
    const lista = (estado?.fuera ?? []).map((p) => ({
      ...p,
      vencido: estaVencido(p.salida_at, horaLimite, ahora),
    }));
    // Primero los que ya pasaron la hora límite, luego por hora de salida
    return lista.sort(
      (a, b) => Number(b.vencido) - Number(a.vencido) || a.salida_at.localeCompare(b.salida_at)
    );
  }, [estado, horaLimite, ahora]);

  const vencidos = fuera.filter((p) => p.vencido).length;
  const total = (estado?.listas ?? []).reduce((s, l) => s + l.total, 0);

  useEffect(() => onVencidos(vencidos), [vencidos]);

  // Aviso al llegar la hora límite (y cada vez que aumentan los que faltan)
  const avisadosRef = useRef(0);
  useEffect(() => {
    if (vencidos > avisadosRef.current) {
      sonido.alarma();
      const texto =
        vencidos === 1
          ? `1 acampante no ha regresado (hora límite ${horaCorta(horaLimite)})`
          : `${vencidos} acampantes no han regresado (hora límite ${horaCorta(horaLimite)})`;
      toast.error(texto, { duration: 60_000 });
      try {
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification("Acampantes fuera de hora", { body: texto, tag: "puerta-vencidos" });
        }
      } catch {}
    }
    avisadosRef.current = vencidos;
  }, [vencidos]);

  const [permisoAvisos, setPermisoAvisos] = useState<string>(() =>
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const pedirAvisos = async () => {
    try {
      setPermisoAvisos(await Notification.requestPermission());
    } catch {}
  };

  // ================== Lector ==================
  const [scanValue, setScanValue] = useState("");
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [seq, setSeq] = useState(0);
  const colaRef = useRef<Promise<void>>(Promise.resolve());

  const focusScan = () => {
    if (!isTouch) scanInputRef.current?.focus();
  };

  useEffect(() => {
    if (active && centroId) focusScan();
  }, [active, centroId]);

  const mostrar = (l: Lectura) => {
    setLectura(l);
    setSeq((n) => n + 1);
  };

  const procesar = async (raw: string) => {
    const id = centroRef.current;
    if (!id) return;
    const dni = extractDniFromBarcode(raw);
    if (!dni) {
      sonido.error();
      mostrar({ estado: "error", dni: raw, mensaje: "Código no reconocido" });
      return;
    }

    setProcesando(true);
    try {
      const { data, error } = await supabase.rpc("registrar_movimiento", {
        p_centro_id: id,
        p_dni: dni,
      });
      if (error) throw error;
      const r = data as any;

      if (r.ok) {
        const tarde =
          r.tipo === "reingreso" && r.salida_at
            ? new Date(r.created_at) > vencimiento(r.salida_at, horaLimite)
            : false;
        if (r.tipo === "salida") sonido.salida();
        else sonido.reingreso();
        mostrar({
          estado: r.tipo,
          id: r.id,
          dni,
          nombre: r.nombre,
          lista: r.lista,
          lugar: r.lugar,
          bungalow: r.bungalow,
          at: r.created_at,
          salidaAt: r.salida_at,
          salidaMotivo: r.salida_motivo,
          final: !!r.final,
          tarde,
        });
        cargar();
      } else if (r.motivo === "estadia_terminada") {
        sonido.error();
        mostrar({
          estado: "terminada",
          dni,
          nombre: r.nombre,
          lista: r.lista,
          lugar: r.lugar,
          bungalow: r.bungalow,
          checkoutAt: r.checkout_at,
          por: r.por === "retiro" ? "retiro" : "checkout",
          salidaAt: r.salida_at,
        });
      } else if (r.motivo === "repetido") {
        mostrar({ estado: "repetido", dni, nombre: r.nombre, lista: r.lista, tipo: r.tipo });
      } else if (r.motivo === "no_pertenece") {
        sonido.error();
        mostrar({
          estado: "no_pertenece",
          dni,
          nombre: r.nombre,
          otroCentro: r.otro_centro,
          lista: r.lista,
        });
      } else {
        sonido.error();
        mostrar({ estado: "error", dni, mensaje: "DNI no válido" });
      }
    } catch (e: any) {
      console.error(e);
      sonido.error();
      mostrar({ estado: "error", dni, mensaje: "No se pudo registrar: " + (e?.message ?? "") });
    } finally {
      setProcesando(false);
    }
  };

  const encolar = (raw: string) => {
    const code = raw.trim();
    if (!code || !centroRef.current) return;
    colaRef.current = colaRef.current.then(() => procesar(code));
  };

  useBarcodeScanner(encolar, { enabled: active && !!centroId });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    encolar(scanValue);
    setScanValue("");
    scanInputRef.current?.focus();
  };

  // ================== Motivo (opcional) ==================
  const [motivo, setMotivo] = useState("");
  const [motivoGuardado, setMotivoGuardado] = useState<string | null>(null);
  useEffect(() => {
    setMotivo("");
    setMotivoGuardado(null);
  }, [seq]);

  const guardarMotivo = async (movId: string, texto: string) => {
    const t = texto.trim();
    if (!t) return;
    const { error } = await supabase.from("movimientos").update({ motivo: t }).eq("id", movId);
    if (error) {
      toast.error("No se pudo guardar el motivo: " + error.message);
      return;
    }
    setMotivoGuardado(t);
    setMotivo(t);
    cargar();
    focusScan();
  };

  // Se retira antes que su grupo: la salida queda como definitiva
  const [retiroGuardado, setRetiroGuardado] = useState(false);
  useEffect(() => setRetiroGuardado(false), [seq]);

  const marcarRetiro = async (movId: string, nombre: string, definitiva: boolean) => {
    const { error } = await supabase.from("movimientos").update({ definitiva }).eq("id", movId);
    if (error) {
      toast.error("No se pudo guardar: " + error.message);
      return false;
    }
    toast(definitiva ? `${nombre} se retiró: ya no cuenta como fuera` : `${nombre} vuelve a contar como fuera`);
    cargar();
    focusScan();
    return true;
  };

  // ================== Pantalla ==================
  if (centros.length === 0 || activos.length === 0) {
    return (
      <div className="mx-auto max-w-md rounded-lg border-2 border-dashed px-6 py-14 text-center">
        <MapPin className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" strokeWidth={1.5} />
        <p className="font-sign text-2xl font-bold">No hay centros todavía</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "Crea los centros a donde van las listas para controlar la puerta."
            : "Pide al administrador que cree los centros."}
        </p>
        {isAdmin && (
          <Button className="mt-5" onClick={onAdministrar}>
            <Settings2 className="mr-2 h-4 w-4" />
            Crear centros
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
      {/* ================== Columna lector ================== */}
      <div className="min-w-0 space-y-5 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label className="text-sm text-muted-foreground">Puerta de</Label>
            <Select value={centro ? centroId! : undefined} onValueChange={elegirCentro}>
              <SelectTrigger className="h-11 border-2 bg-card text-base font-semibold">
                <SelectValue placeholder="Elige el centro" />
              </SelectTrigger>
              <SelectContent>
                {activos.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isAdmin && (
            <Button
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={onAdministrar}
              title="Administrar centros y lugares"
              aria-label="Administrar centros y lugares"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        {!centro ? (
          <p className="rounded-lg border-2 border-dashed px-5 py-10 text-center text-muted-foreground">
            Elige el centro de esta puerta para empezar.
          </p>
        ) : (
          <>
            <form onSubmit={onSubmit} className="relative">
              <Label htmlFor="scan-puerta" className="sr-only">
                DNI
              </Label>
              <ScanBarcode className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="scan-puerta"
                ref={scanInputRef}
                placeholder="Escanea el DNI al salir o al regresar"
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                autoComplete="off"
                inputMode="numeric"
                className="dni h-14 rounded-lg border-2 border-input bg-card pl-12 pr-16 text-lg placeholder:tracking-normal placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <Button
                type="submit"
                size="icon"
                className="absolute right-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-md"
                disabled={!scanValue.trim()}
                aria-label="Registrar DNI"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <Letrero key={seq} lectura={lectura} procesando={procesando} animar={seq > 0} />

            {lectura?.estado === "salida" && (
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm font-semibold">
                  Motivo de salida <span className="font-normal text-muted-foreground">(opcional)</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {MOTIVOS_RAPIDOS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => guardarMotivo(lectura.id, m)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-sm transition-colors",
                        motivoGuardado === m
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:border-primary/50 hover:bg-muted"
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    guardarMotivo(lectura.id, motivo);
                  }}
                >
                  <Input
                    placeholder="Otro motivo…"
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="h-9"
                  />
                  <Button type="submit" size="sm" variant="secondary" className="h-9" disabled={!motivo.trim()}>
                    Guardar
                  </Button>
                </form>
                {motivoGuardado && (
                  <p className="mt-2 text-sm text-success">Motivo guardado: {motivoGuardado}</p>
                )}

                {!lectura.final && (
                  <div className="mt-3 border-t pt-3">
                    {retiroGuardado ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-1.5 text-sm font-semibold">
                          <UserX className="h-4 w-4" />
                          Se retira: no regresa
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8"
                          onClick={async () => {
                            if (await marcarRetiro(lectura.id, lectura.nombre, false)) setRetiroGuardado(false);
                          }}
                        >
                          Deshacer
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full justify-start"
                        onClick={async () => {
                          if (await marcarRetiro(lectura.id, lectura.nombre, true)) setRetiroGuardado(true);
                        }}
                      >
                        <UserX className="mr-2 h-4 w-4" />
                        Se retira (no regresa)
                      </Button>
                    )}
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      Úsalo si se va antes que su grupo. No contará como fuera ni sonará la alarma de
                      la hora límite, y no podrá volver a entrar.
                    </p>
                  </div>
                )}
              </div>
            )}

            <p className="hidden text-sm leading-relaxed text-muted-foreground lg:block">
              Cada lectura alterna: si la persona estaba dentro se registra su salida, si estaba
              fuera su regreso. Solo se aceptan acampantes de las listas activas de este centro.
            </p>
          </>
        )}
      </div>

      {/* ================== Estado del centro ================== */}
      {centro && (
        <section className="min-w-0 space-y-5">
          {vencidos > 0 && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg bg-destructive px-4 py-3.5 text-white"
            >
              <AlarmClock className="mt-0.5 h-6 w-6 shrink-0" />
              <div>
                <p className="font-sign text-2xl font-bold leading-tight">
                  {vencidos === 1 ? "1 no ha regresado" : `${vencidos} no han regresado`}
                </p>
                <p className="text-sm opacity-90">
                  Hora límite {horaCorta(horaLimite)}. Están marcados en rojo abajo.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <Contador etiqueta="En estadía" valor={total} icon={Users} />
            <Contador etiqueta="Dentro" valor={total - fuera.length} icon={ArrowRightToLine} tono="ok" />
            <Contador
              etiqueta="Fuera"
              valor={fuera.length}
              icon={ArrowLeftFromLine}
              tono={vencidos > 0 ? "mal" : fuera.length > 0 ? "aviso" : undefined}
            />
          </div>

          <div className="rounded-lg border bg-card">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
              <div>
                <h2 className="font-sign text-2xl font-bold">Fuera ahora</h2>
                <p className="text-sm text-muted-foreground">
                  Deben regresar antes de las {horaCorta(horaLimite)}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {permisoAvisos === "default" && (
                  <Button variant="ghost" size="sm" onClick={pedirAvisos} title="Avisar aunque la pestaña esté en segundo plano">
                    <Bell className="mr-1.5 h-4 w-4" />
                    Activar avisos
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => {
                    setAhora(new Date());
                    cargar();
                  }}
                  aria-label="Actualizar"
                  title="Actualizar"
                >
                  {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {fuera.length === 0 ? (
              <p className="px-6 py-12 text-center text-sm text-muted-foreground">
                {total === 0
                  ? "No hay acampantes en estadía en este centro."
                  : "Todos están dentro de las instalaciones."}
              </p>
            ) : (
              <ol className="max-h-[60vh] divide-y divide-border/70 overflow-y-auto px-2 sm:px-3">
                {fuera.map((p) => (
                  <li
                    key={`${p.lista_id}-${p.dni}`}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-2 py-2.5",
                      p.vencido && "bg-destructive/10"
                    )}
                  >
                    {p.vencido ? (
                      <AlarmClock className="h-5 w-5 shrink-0 text-destructive" aria-label="Fuera de hora" />
                    ) : (
                      <ArrowLeftFromLine className="h-5 w-5 shrink-0 text-warning" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-narrow truncate text-[15px] font-semibold leading-tight">
                        {p.nombre}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        <span className="dni">{p.dni}</span> ·{" "}
                        {(p.bungalow || p.lugar) && (
                          <span className="font-medium text-foreground">{p.bungalow || p.lugar} · </span>
                        )}
                        {p.lista}
                        {p.motivo && <> · {p.motivo}</>}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm tabular-nums">
                      <p className={cn("font-semibold", p.vencido && "text-destructive")}>
                        {duracion(p.salida_at, ahora)}
                      </p>
                      <p className="text-muted-foreground">salió {format(new Date(p.salida_at), "HH:mm")}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground"
                      title="Se retiró (no regresa)"
                      aria-label={`${p.nombre} se retiró (no regresa)`}
                      onClick={() => {
                        if (window.confirm(`¿${p.nombre} se retiró y ya no regresa?`)) marcarRetiro(p.id, p.nombre, true);
                      }}
                    >
                      <UserX className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {(estado?.bungalows ?? []).some((b) => b.bungalow) && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Por bungalow</h3>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {estado!.bungalows.map((b) => (
                  <li
                    key={`${b.lugar}-${b.bungalow}`}
                    className={cn(
                      "rounded-lg border bg-card px-3 py-2",
                      !b.bungalow && "border-dashed"
                    )}
                  >
                    <p className="truncate text-sm font-medium">{b.bungalow ?? "Sin bungalow"}</p>
                    <p className="truncate text-xs text-muted-foreground">{b.lugar ?? "Sin lugar"}</p>
                    <p className="mt-1 text-sm tabular-nums">
                      <span className="font-semibold">{b.total - b.fuera}</span> dentro
                      {b.fuera > 0 && <span className="text-warning"> · {b.fuera} fuera</span>}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(estado?.listas.length ?? 0) > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                Listas activas en {centro.nombre}
              </h3>
              <ul className="divide-y rounded-lg border bg-card">
                {estado!.listas.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                    <p className="min-w-0 flex-1 truncate font-medium">
                      {l.lugar && <span className="text-muted-foreground">{l.lugar} · </span>}
                      {l.title}
                    </p>
                    {l.en_llegada && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        llegando
                      </span>
                    )}
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {l.total - l.fuera} dentro
                      {l.fuera > 0 && <span className="text-warning"> · {l.fuera} fuera</span>}
                      {l.retirados > 0 && <span> · {l.retirados} se fueron</span>}
                      {l.por_salir > 0 && (
                        <span className="font-semibold text-destructive">
                          {" "}
                          · {l.por_salir} debían salir {format(new Date(l.checkout_at!), "HH:mm")}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

const Contador = ({
  etiqueta,
  valor,
  icon: Icon,
  tono,
}: {
  etiqueta: string;
  valor: number;
  icon: React.ElementType;
  tono?: "ok" | "aviso" | "mal";
}) => (
  <div
    className={cn(
      "rounded-lg border bg-card px-3 py-3 sm:px-4",
      tono === "mal" && "border-destructive"
    )}
  >
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Icon
        className={cn(
          "h-4 w-4",
          tono === "ok" && "text-success",
          tono === "aviso" && "text-warning",
          tono === "mal" && "text-destructive"
        )}
      />
      {etiqueta}
    </p>
    <p className="font-sign mt-1 text-3xl font-bold tabular-nums leading-none">{valor}</p>
  </div>
);

// ================== Letrero de resultado ==================
const Letrero = ({
  lectura,
  procesando,
  animar,
}: {
  lectura: Lectura | null;
  procesando: boolean;
  animar: boolean;
}) => {
  if (procesando) {
    return (
      <div className="flex min-h-[168px] items-center justify-center gap-2 rounded-xl border-2 border-dashed border-input text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Registrando…
      </div>
    );
  }

  if (!lectura) {
    return (
      <div className="flex min-h-[168px] flex-col justify-center rounded-xl border-2 border-dashed border-input px-5 py-5">
        <p className="font-sign text-2xl font-bold text-muted-foreground">Esperando lectura</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Escanea el DNI de quien sale o regresa.
        </p>
      </div>
    );
  }

  let cls = "";
  let Icon: React.ElementType = CircleX;
  let titulo = "";
  let nombre = "";
  let detalle: React.ReactNode = null;

  switch (lectura.estado) {
    case "salida":
      cls = lectura.final ? "bg-primary text-primary-foreground" : "bg-warning text-foreground";
      Icon = lectura.final ? Flag : ArrowLeftFromLine;
      titulo = lectura.final
        ? `Salida final · ${format(new Date(lectura.at), "HH:mm")} · estadía terminada`
        : `Salió · ${format(new Date(lectura.at), "HH:mm")}`;
      nombre = lectura.nombre;
      detalle = [lectura.bungalow || lectura.lugar, lectura.lista].filter(Boolean).join(" · ");
      break;
    case "reingreso":
      cls = lectura.tarde ? "bg-destructive text-white" : "bg-success text-white";
      Icon = lectura.tarde ? AlarmClock : ArrowRightToLine;
      titulo = `${lectura.tarde ? "Regresó fuera de hora" : "Regresó"} · ${format(new Date(lectura.at), "HH:mm")}`;
      nombre = lectura.nombre;
      detalle = (
        <>
          {[lectura.bungalow || lectura.lugar, lectura.lista].filter(Boolean).join(" · ")}
          {lectura.salidaAt && (
            <>
              {" "}
              · estuvo fuera {duracion(lectura.salidaAt, lectura.at)}
              {lectura.salidaMotivo && ` (${lectura.salidaMotivo})`}
            </>
          )}
        </>
      );
      break;
    case "terminada":
      cls = "bg-destructive text-white";
      Icon = Ban;
      titulo =
        lectura.por === "retiro" || !lectura.checkoutAt
          ? "Se retiró · no puede volver a entrar"
          : `Estadía terminada · check-out ${format(new Date(lectura.checkoutAt), "dd/MM HH:mm")}`;
      nombre = lectura.nombre;
      detalle = `${lectura.por === "retiro" ? "Salida definitiva" : "No puede volver a entrar"}. Salió el ${format(new Date(lectura.salidaAt), "dd/MM HH:mm")} · ${[
        lectura.bungalow || lectura.lugar,
        lectura.lista,
      ]
        .filter(Boolean)
        .join(" · ")}`;
      break;
    case "repetido":
      cls = "border-2 border-input bg-card text-foreground";
      Icon = RotateCcw;
      titulo = lectura.tipo === "salida" ? "Ya se marcó su salida" : "Ya se marcó su regreso";
      nombre = lectura.nombre;
      detalle = "Lectura repetida, no se registró de nuevo.";
      break;
    case "no_pertenece":
      cls = "bg-destructive text-white";
      Icon = CircleX;
      titulo = "No pertenece a este centro";
      nombre = lectura.nombre || "No está en ninguna lista activa";
      detalle = lectura.otroCentro
        ? `Está en "${lectura.lista}" de ${lectura.otroCentro}`
        : lectura.lista
        ? `Está en "${lectura.lista}", que no tiene centro asignado`
        : "No se registró.";
      break;
    case "error":
      cls = "border-2 border-destructive bg-card text-destructive";
      Icon = CircleX;
      titulo = lectura.mensaje;
      nombre = "Vuelve a escanear";
      break;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("min-h-[168px] rounded-xl px-5 py-5", cls, animar && "animate-stamp")}
    >
      <p className="flex items-center gap-2 text-base font-semibold">
        <Icon className="h-6 w-6" strokeWidth={2.5} />
        {titulo}
      </p>
      <p className="font-sign mt-3 break-words text-4xl font-extrabold leading-[0.95] sm:text-5xl">
        {nombre}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="dni text-xl font-medium opacity-80">{lectura.dni}</span>
        {detalle && <span className="text-sm opacity-80">{detalle}</span>}
      </div>
    </div>
  );
};
