import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Scanner } from "@/components/Scanner";
import {
  ArrowRight,
  Camera,
  CircleX,
  Coffee,
  Loader2,
  LogIn,
  LogOut,
  Maximize,
  ScanBarcode,
  TriangleAlert,
  UtensilsCrossed,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { extractDniFromBarcode } from "@/lib/dni";
import {
  TIPO_CORTO,
  TIPO_LABEL,
  horaDe,
  type MarcaNo,
  type MarcaOk,
  type MarcaResult,
  type TipoMarca,
} from "@/lib/asistencia";

// Pantalla del equipo de la puerta. El trabajador escanea su DNI y el
// servidor decide si es entrada, refrigerio o salida y pone la hora.

type Eleccion = Extract<MarcaNo, { motivo: "elegir" }>;
type Rechazo = MarcaNo | { ok: false; motivo: "error"; mensaje: string };

type Pantalla =
  | { k: "espera" }
  | { k: "cargando"; dni: string }
  | { k: "elegir"; res: Eleccion }
  | { k: "resultado"; res: MarcaResult | Rechazo };

const isOk = (r: MarcaResult | Rechazo): r is MarcaOk => r.ok === true;

type Reciente = { id: string; nombre: string; tipo: TipoMarca; at: string };

const SEG_RESULTADO = 6;
const SEG_ELEGIR = 8;

const isTouch =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

const TONO: Record<TipoMarca, { cls: string; icon: typeof LogIn }> = {
  entrada: { cls: "bg-success text-white", icon: LogIn },
  inicio_refrigerio: { cls: "bg-warning text-foreground", icon: UtensilsCrossed },
  fin_refrigerio: { cls: "bg-warning text-foreground", icon: Coffee },
  salida: { cls: "bg-accent text-accent-foreground", icon: LogOut },
};

export const Marcador = () => {
  const [ahora, setAhora] = useState(() => new Date());
  const [pantalla, setPantalla] = useState<Pantalla>({ k: "espera" });
  const pantallaRef = useRef<Pantalla>(pantalla);
  pantallaRef.current = pantalla;
  const [seq, setSeq] = useState(0);
  const [restante, setRestante] = useState(0);
  const [recientes, setRecientes] = useState<Reciente[]>([]);
  const [scanValue, setScanValue] = useState("");
  const [camara, setCamara] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const beepRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const focusScan = () => {
    if (!isTouch) inputRef.current?.focus();
  };

  useEffect(focusScan, []);

  const beep = () => {
    try {
      if (!beepRef.current) beepRef.current = new Audio("/beep.wav");
      beepRef.current.currentTime = 0;
      beepRef.current.play().catch(() => {});
    } catch {}
    if (navigator.vibrate) navigator.vibrate(120);
  };

  const mostrar = (p: Pantalla) => {
    setPantalla(p);
    pantallaRef.current = p;
    setSeq((n) => n + 1);
  };

  const marcar = async (dni: string, tipo?: TipoMarca) => {
    mostrar({ k: "cargando", dni });
    const { data, error } = await supabase.rpc("marcar_asistencia", {
      p_dni: dni,
      ...(tipo ? { p_tipo: tipo } : {}),
    });

    if (error) {
      console.error(error);
      mostrar({
        k: "resultado",
        res: {
          ok: false,
          motivo: "error",
          mensaje:
            error.code === "42501"
              ? "Esta cuenta no puede registrar asistencia"
              : "Sin conexión con el servidor. Vuelve a escanear.",
        },
      });
      return;
    }

    const res = data as unknown as MarcaResult;
    if (!res.ok && (res as MarcaNo).motivo === "elegir") {
      mostrar({ k: "elegir", res: res as Eleccion });
      return;
    }
    if (isOk(res)) {
      beep();
      setRecientes((prev) =>
        [{ id: res.id, nombre: res.nombre, tipo: res.tipo, at: res.marcado_at }, ...prev].slice(0, 8)
      );
    }
    mostrar({ k: "resultado", res });
  };

  // Una lectura mientras se espera la elección confirma la sugerida
  // (el mismo DNI) o la confirma y pasa a la siguiente persona.
  const procesar = async (raw: string) => {
    const dni = extractDniFromBarcode(raw);
    const actual = pantallaRef.current;
    if (actual.k === "elegir") {
      await marcar(actual.res.dni, actual.res.sugerida);
      if (dni === actual.res.dni) return;
    }
    if (!dni) {
      mostrar({ k: "resultado", res: { ok: false, motivo: "dni_invalido", dni: raw } });
      return;
    }
    await marcar(dni);
  };

  const encolar = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    queueRef.current = queueRef.current.then(() => procesar(code)).catch(console.error);
  };

  const elegir = (tipo: TipoMarca) => {
    const actual = pantallaRef.current;
    if (actual.k !== "elegir") return;
    queueRef.current = queueRef.current
      .then(() => marcar(actual.res.dni, tipo))
      .catch(console.error);
    focusScan();
  };

  useBarcodeScanner(encolar, { enabled: !camara });

  // Cuenta regresiva: vuelve a la espera o confirma la opción sugerida
  useEffect(() => {
    if (pantalla.k !== "resultado" && pantalla.k !== "elegir") return;
    const total = pantalla.k === "elegir" ? SEG_ELEGIR : SEG_RESULTADO;
    const fin = Date.now() + total * 1000;
    setRestante(total);
    const id = window.setInterval(() => {
      const s = Math.ceil((fin - Date.now()) / 1000);
      setRestante(Math.max(0, s));
      if (s > 0) return;
      window.clearInterval(id);
      if (pantalla.k === "elegir") elegir(pantalla.res.sugerida);
      else setPantalla({ k: "espera" });
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    encolar(scanValue);
    setScanValue("");
    focusScan();
  };

  const pantallaCompleta = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    focusScan();
  };

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
      {/* ================== Reloj y lector ================== */}
      <div className="min-w-0 space-y-5">
        <div>
          <p className="text-sm capitalize text-muted-foreground">
            {format(ahora, "EEEE d 'de' MMMM yyyy", { locale: es })}
          </p>
          <p className="font-sign text-7xl font-extrabold tabular-nums leading-none sm:text-8xl">
            {format(ahora, "HH:mm")}
            <span className="text-3xl text-muted-foreground sm:text-4xl">
              :{format(ahora, "ss")}
            </span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="relative">
          <Label htmlFor="dni-asistencia" className="sr-only">
            DNI
          </Label>
          <ScanBarcode className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="dni-asistencia"
            ref={inputRef}
            placeholder="Escanea tu DNI"
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
            aria-label="Marcar"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </form>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11 rounded-md" onClick={() => setCamara(true)}>
            <Camera className="mr-2 h-4 w-4" />
            Usar cámara
          </Button>
          <Button variant="ghost" className="h-11 rounded-md" onClick={pantallaCompleta}>
            <Maximize className="mr-2 h-4 w-4" />
            Pantalla completa
          </Button>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">
          La hora la registra el servidor. Si te equivocas, avisa a RR.HH.: las marcas no se
          borran, se corrigen dejando constancia.
        </p>

        {recientes.length > 0 && (
          <section aria-label="Últimas marcas en este equipo">
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
              Últimas marcas en este equipo
            </h2>
            <ul className="divide-y rounded-lg border bg-card">
              {recientes.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="tabular-nums text-muted-foreground">{horaDe(r.at)}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.nombre}</span>
                  <span className="text-muted-foreground">{TIPO_CORTO[r.tipo]}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* ================== Letrero ================== */}
      <div className="min-w-0">
        <Letrero key={seq} pantalla={pantalla} restante={restante} onElegir={elegir} />
      </div>

      <Scanner
        isActive={camara}
        onClose={() => {
          setCamara(false);
          focusScan();
        }}
        onScanSuccess={(dni) => {
          setCamara(false);
          encolar(dni);
        }}
      />
    </div>
  );
};

const Letrero = ({
  pantalla,
  restante,
  onElegir,
}: {
  pantalla: Pantalla;
  restante: number;
  onElegir: (t: TipoMarca) => void;
}) => {
  const base = "min-h-[320px] rounded-2xl px-6 py-6 sm:px-8 sm:py-8";

  if (pantalla.k === "espera") {
    return (
      <div className={cn(base, "flex flex-col justify-center border-2 border-dashed border-input")}>
        <ScanBarcode className="h-10 w-10 text-muted-foreground" />
        <p className="font-sign mt-4 text-4xl font-bold">Acerca tu DNI al lector</p>
        <p className="mt-2 text-muted-foreground">
          Se registra sola la entrada, el refrigerio o la salida.
        </p>
      </div>
    );
  }

  if (pantalla.k === "cargando") {
    return (
      <div className={cn(base, "flex flex-col justify-center border-2 border-dashed border-input")}>
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Registrando…
        </p>
        <p className="dni mt-3 text-4xl font-semibold text-muted-foreground">{pantalla.dni}</p>
      </div>
    );
  }

  if (pantalla.k === "elegir") {
    const { res } = pantalla;
    return (
      <div className={cn(base, "animate-stamp border-2 border-primary bg-card")} role="status">
        <p className="text-base font-semibold text-muted-foreground">¿Qué vas a marcar?</p>
        <p className="font-sign mt-2 break-words text-4xl font-extrabold leading-[0.95] sm:text-5xl">
          {res.nombre}
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {res.opciones.map((t) => {
            const Icon = TONO[t].icon;
            const sugerida = t === res.sugerida;
            return (
              <button
                key={t}
                onClick={() => onElegir(t)}
                className={cn(
                  "flex min-h-[96px] flex-col items-start justify-center rounded-xl px-5 py-4 text-left transition-transform active:scale-[0.98]",
                  TONO[t].cls,
                  !sugerida && "opacity-80"
                )}
              >
                <span className="flex items-center gap-2 text-2xl font-bold">
                  <Icon className="h-6 w-6" />
                  {TIPO_LABEL[t]}
                </span>
                {sugerida && (
                  <span className="mt-1 text-sm font-medium opacity-90">
                    Se marcará en {restante} s
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Toca una opción o vuelve a escanear para confirmar la resaltada.
        </p>
      </div>
    );
  }

  const { res: resultado } = pantalla;

  if (isOk(resultado)) {
    const res = resultado;
    const tono = TONO[res.tipo];
    const Icon = tono.icon;
    return (
      <div className={cn(base, tono.cls, "animate-stamp")} role="status" aria-live="polite">
        <p className="flex items-center gap-2 text-xl font-bold uppercase tracking-wide">
          <Icon className="h-7 w-7" strokeWidth={2.5} />
          {TIPO_LABEL[res.tipo]}
        </p>
        <p className="font-sign mt-4 break-words text-4xl font-extrabold leading-[0.95] sm:text-5xl">
          {res.nombre}
        </p>
        <p className="font-sign mt-4 text-6xl font-extrabold tabular-nums leading-none">
          {horaDe(res.marcado_at)}
        </p>
        <div className="mt-4 space-y-1 text-base opacity-90">
          {res.turno && (
            <p>
              Turno {res.turno}
              {res.programada_inicio &&
                ` · ${horaDe(res.programada_inicio)} – ${horaDe(res.programada_fin)}`}
            </p>
          )}
          {res.tardanza_min > 0 && (
            <p className="flex items-center gap-1.5 font-semibold">
              <TriangleAlert className="h-4 w-4" />
              Tardanza de {res.tardanza_min} min
            </p>
          )}
          {res.marcas.length > 1 && (
            <p>
              Hoy:{" "}
              {res.marcas.map((m) => `${TIPO_CORTO[m.tipo]} ${horaDe(m.marcado_at)}`).join(" · ")}
            </p>
          )}
        </div>
      </div>
    );
  }

  const res = resultado as Rechazo;
  const aviso = (() => {
    switch (res.motivo) {
      case "reciente":
        return {
          warn: true,
          titulo: "Ya marcaste",
          nombre: res.nombre,
          texto: `${TIPO_LABEL[res.tipo]} a las ${horaDe(res.marcado_at)}. Espera 2 minutos para otra marca.`,
        };
      case "no_registrado":
        return {
          warn: false,
          titulo: "DNI no registrado",
          nombre: res.dni,
          texto: "No figura como trabajador. Acércate a RR.HH.",
        };
      case "inactivo":
        return {
          warn: false,
          titulo: "Trabajador inactivo",
          nombre: res.nombre,
          texto: "No puede marcar asistencia. Acércate a RR.HH.",
        };
      case "dni_invalido":
        return {
          warn: false,
          titulo: "Código no reconocido",
          nombre: "",
          texto: "Vuelve a escanear el DNI.",
        };
      case "tipo_invalido":
        return {
          warn: false,
          titulo: "No se registró",
          nombre: res.dni,
          texto: "La situación cambió mientras elegías. Vuelve a escanear.",
        };
      case "error":
        return { warn: false, titulo: "No se registró", nombre: "", texto: res.mensaje };
    }
  })();

  return (
    <div
      className={cn(
        base,
        "animate-stamp",
        aviso.warn ? "bg-warning text-foreground" : "border-2 border-destructive bg-card text-destructive"
      )}
      role="status"
      aria-live="assertive"
    >
      <p className="flex items-center gap-2 text-xl font-bold">
        {aviso.warn ? <TriangleAlert className="h-7 w-7" /> : <CircleX className="h-7 w-7" />}
        {aviso.titulo}
      </p>
      {aviso.nombre && (
        <p className="font-sign mt-4 break-words text-4xl font-extrabold leading-[0.95]">
          {aviso.nombre}
        </p>
      )}
      <p className="mt-4 text-lg">{aviso.texto}</p>
    </div>
  );
};
