import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RecordsList } from "@/components/RecordsList";
import { AdminUsers } from "@/components/AdminUsers";
import { Puerta } from "@/components/eventos/Puerta";
import { CentrosDialog } from "@/components/eventos/CentrosDialog";
import { MovimientosLista } from "@/components/eventos/MovimientosLista";
import {
  cargarCentrosYLugares,
  etapaLista,
  calcularHorario,
  HORARIO,
  textoHorario,
  type Bungalow,
  type Centro,
  type Horario,
  type Lugar,
  type Modalidad,
} from "@/lib/estadia";
import { toast } from "sonner";
import {
  ScanBarcode,
  Check,
  ArrowRight,
  LogOut,
  Tent,
  ClipboardList,
  Search,
  Users,
  ChevronDown,
  Loader2,
  ShieldCheck,
  CircleCheck,
  CircleX,
  Database,
  Globe,
  FileUp,
  Trash2,
  Clock,
  DoorOpen,
  Building2,
  MapPin,
  Settings2,
  Flag,
  BedDouble,
  CalendarDays,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { extractDniFromBarcode, lookupDni } from "@/lib/dni";
import { buscarPorNombre, parsePadronFile, type Padron, type PersonaPadron } from "@/lib/padron";

type Fuente = "bd" | "api";

interface Record {
  id: string;
  dni_number: string;
  full_name: string;
  scanned_at: string;
  fuente?: Fuente;
  bungalow_id?: string | null;
}

type OpenList = {
  id: string;
  title: string;
  centro_id: string | null;
  lugar_id: string | null;
} & Horario;

const toOpenList = (row: any): OpenList => ({
  id: row.id,
  title: row.title,
  centro_id: row.centro_id ?? null,
  lugar_id: row.lugar_id ?? null,
  modalidad: row.modalidad ?? null,
  fecha_inicio: row.fecha_inicio ?? null,
  fecha_fin: row.fecha_fin ?? null,
});

const SIN_HORARIO: Horario = { modalidad: null, fecha_inicio: null, fecha_fin: null };

const hoyYmd = () => format(new Date(), "yyyy-MM-dd");

// Resultado de la lectura: pinta el letrero de veredicto
type Estado = "ok" | "fuera" | "dup" | "error";

type LastRead = {
  raw: string;
  dni: string;
  nombre: string;
  fuente: Fuente | null;
  estado: Estado;
};

type LiveStatus = "connecting" | "live" | "offline";

const toRecord = (r: any): Record => ({
  id: r.id,
  dni_number: r.dni_number,
  full_name: r.full_name,
  scanned_at: r.scanned_at,
  fuente: r.fuente === "bd" || r.fuente === "api" ? r.fuente : undefined,
  bungalow_id: r.bungalow_id ?? null,
});

const toPadron = (row: any): Padron | null =>
  Array.isArray(row?.padron)
    ? { personas: row.padron as PersonaPadron[], archivo: row.padron_archivo ?? "" }
    : null;

const padronDnis = (row: any): Set<string> | null => {
  const p = toPadron(row);
  return p ? new Set(p.personas.map((x) => x.dni).filter(Boolean)) : null;
};

// Padrón con el DNI guardado en las personas que solo tenían nombre
const conDnis = (personas: PersonaPadron[], asignados: Map<PersonaPadron, string>) =>
  personas.map((p) => {
    const dni = asignados.get(p);
    return dni ? { ...p, dni } : p;
  });

// Sin Excel (o sin institución en el Excel) la lista se llama "Ingreso" y la fecha
const defaultTitle = () => `Ingreso ${format(new Date(), "dd/MM/yyyy")}`;

// En el celular no se fuerza el foco al campo del lector: abriría el teclado
// en pantalla. Un lector Bluetooth igual funciona por el escucha global.
const isTouch =
  typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

type EventosProps = {
  session: any;
  role: string | null;
  // Solo el administrador puede pasar al módulo de asistencia
  onCambiarModulo?: () => void;
};

const Eventos = ({ session, role, onCambiarModulo }: EventosProps) => {
  const userId: string | undefined = session?.user?.id;
  const [currentRecords, setCurrentRecords] = useState<Record[]>([]);
  const [listTitle, setListTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedLists, setSavedLists] = useState<any[]>([]);
  const [view, setView] = useState<"registro" | "puerta" | "listas" | "usuarios">("registro");
  const showSavedLists = view === "listas";
  const isAdmin = role === "admin";
  const [listSearch, setListSearch] = useState("");
  const [centroFiltro, setCentroFiltro] = useState<string>("todos");

  // ====== Centros y lugares (a dónde va cada lista) ======
  const [centros, setCentros] = useState<Centro[]>([]);
  const [lugares, setLugares] = useState<Lugar[]>([]);
  const [bungalows, setBungalows] = useState<Bungalow[]>([]);
  // Bungalows activos de un lugar (y el asignado aunque esté inactivo)
  const bungalowsDe = (lId: string | null | undefined, incluir?: (string | null | undefined)[]) =>
    lId
      ? bungalows.filter(
          (b) => b.lugar_id === lId && (b.activo || (incluir ?? []).includes(b.id))
        )
      : [];
  // Bungalow al que va cada DNI que se escanea (el grupo llega por bungalow)
  const [bungalowActual, setBungalowActual] = useState<string | null>(null);
  const bungalowActualRef = useRef<string | null>(null);
  bungalowActualRef.current = bungalowActual;
  const centrosActivos = useMemo(() => centros.filter((c) => c.activo), [centros]);
  const lugaresActivos = useMemo(() => lugares.filter((l) => l.activo), [lugares]);
  const lugaresDe = (cId: string | null) => lugaresActivos.filter((l) => l.centro_id === cId);
  const centrosActivosRef = useRef<Centro[]>([]);
  centrosActivosRef.current = centrosActivos;
  const lugaresActivosRef = useRef<Lugar[]>([]);
  lugaresActivosRef.current = lugaresActivos;
  const [lugaresOpen, setLugaresOpen] = useState(false);
  // Destino de la lista en curso (o el elegido antes de la primera lectura)
  const [centroId, setCentroId] = useState<string | null>(null);
  const centroIdRef = useRef<string | null>(null);
  centroIdRef.current = centroId;
  const [lugarId, setLugarId] = useState<string | null>(null);
  const lugarIdRef = useRef<string | null>(null);
  lugarIdRef.current = lugarId;
  const [askLugar, setAskLugar] = useState(false);
  // Horario de la lista en curso (modalidad y fechas del campamento)
  const [horario, setHorario] = useState<Horario>(SIN_HORARIO);
  const horarioRef = useRef<Horario>(SIN_HORARIO);
  horarioRef.current = horario;

  // Centro elegido en el aviso, mientras se elige su lugar
  const [askCentro, setAskCentro] = useState<string | null>(null);

  // Falta el destino: el centro, o el lugar si el centro tiene lugares
  const faltaDestino = () => {
    if (centrosActivosRef.current.length === 0) return false;
    if (!centroIdRef.current) return true;
    const tieneLugares = lugaresActivosRef.current.some((l) => l.centro_id === centroIdRef.current);
    return tieneLugares && !lugarIdRef.current;
  };
  const [vencidosPuerta, setVencidosPuerta] = useState(0);
  const [finalizarOpen, setFinalizarOpen] = useState(false);

  const recargarLugares = () =>
    cargarCentrosYLugares()
      .then((r) => {
        setCentros(r.centros);
        setLugares(r.lugares);
        setBungalows(r.bungalows);
      })
      .catch((e) => toast.error("No se pudieron cargar los centros: " + e.message));

  useEffect(() => {
    if (session) recargarLugares();
  }, [session]);

  // "Kawai · Casona"
  const nombreDestino = (cId: string | null | undefined, lId: string | null | undefined) =>
    [centros.find((c) => c.id === cId)?.nombre, lugares.find((l) => l.id === lId)?.nombre]
      .filter(Boolean)
      .join(" · ");

  const destinoCompleto = !!centroId && (lugaresDe(centroId).length === 0 || !!lugarId);

  // Bungalows del lugar de la lista en curso y cuántos hay en cada uno
  const bungalowsLista = bungalowsDe(lugarId, currentRecords.map((r) => r.bungalow_id));
  const ocupacion = useMemo(() => {
    const m = new Map<string | null, number>();
    for (const r of currentRecords) m.set(r.bungalow_id ?? null, (m.get(r.bungalow_id ?? null) ?? 0) + 1);
    return m;
  }, [currentRecords]);

  useEffect(() => {
    if (bungalowActual && !bungalows.some((b) => b.id === bungalowActual && b.lugar_id === lugarId)) {
      setBungalowActual(null);
    }
  }, [lugarId, bungalows]);

  // Cambia el bungalow de un acampante (lista en curso o lista en estadía)
  const cambiarBungalow = async (recordId: string, bungalowId: string | null) => {
    const { error } = await supabase
      .from("scanned_records")
      .update({ bungalow_id: bungalowId })
      .eq("id", recordId);
    if (error) {
      toast.error("No se pudo cambiar el bungalow: " + error.message);
      return;
    }
    setCurrentRecords((prev) =>
      prev.map((r) => (r.id === recordId ? { ...r, bungalow_id: bungalowId } : r))
    );
    setSavedLists((prev) =>
      prev.map((l) => ({
        ...l,
        scanned_records: (l.scanned_records || []).map((r: Record) =>
          r.id === recordId ? { ...r, bungalow_id: bungalowId } : r
        ),
      }))
    );
  };

  // Lista abierta en la BD: cada lectura se guarda en ella al instante y los
  // demás equipos con la misma cuenta la reciben por Realtime.
  const [openList, setOpenList] = useState<OpenList | null>(null);
  const openListRef = useRef<OpenList | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");

  // Lista de invitados de la lista abierta (Excel/CSV/PDF)
  const [padron, setPadron] = useState<Padron | null>(null);
  const padronRef = useRef<Map<string, string> | null>(null);
  const padronMap = useMemo(
    () =>
      padron
        ? new Map(padron.personas.filter((p) => p.dni).map((p) => [p.dni, p.nombre]))
        : null,
    [padron]
  );
  padronRef.current = padronMap;
  // Lista completa (también las personas sin DNI, que se validan por nombre)
  const padronDatosRef = useRef<Padron | null>(null);
  padronDatosRef.current = padron;
  const padronSet = useMemo(
    () => (padronMap ? new Set(padronMap.keys()) : null),
    [padronMap]
  );
  const [padronLoading, setPadronLoading] = useState(false);
  const padronInputRef = useRef<HTMLInputElement | null>(null);

  // Aviso "primero sube la lista" antes de la primera lectura
  const [askPadron, setAskPadron] = useState(false);
  const pendingCodeRef = useRef<{ code: string; at: number } | null>(null);
  // Se eligió seguir sin lista de invitados (hasta finalizar la lista)
  const sinPadronRef = useRef(false);

  // Lector
  const [scanValue, setScanValue] = useState("");
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lastRead, setLastRead] = useState<LastRead | null>(null);
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const [titleFocused, setTitleFocused] = useState(false);
  const titleFocusedRef = useRef(false);
  const listTitleRef = useRef("");
  listTitleRef.current = listTitle;

  // Cambia con cada lectura para repetir la animación del letrero
  const [readSeq, setReadSeq] = useState(0);
  const recordsRef = useRef<Record[]>([]);
  recordsRef.current = currentRecords;

  // Cola: si se leen varios códigos seguidos se procesan en orden
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  // ✅ Anti-dup REAL (no permitir duplicados en la lista)
  const seenDnisRef = useRef<Set<string>>(new Set());
  // DNIs que este equipo está procesando, para distinguir sus lecturas de
  // las que llegan por Realtime desde otro equipo
  const pendingDnisRef = useRef<Set<string>>(new Set());
  // Evita avisar "se cerró en otro equipo" cuando la cerró este mismo
  const closingRef = useRef(false);

  // Beep (/public/beep.wav)
  const beepRef = useRef<HTMLAudioElement | null>(null);

  // ====== Sync Set con currentRecords (por si se cambia estado) ======
  useEffect(() => {
    const s = new Set<string>(pendingDnisRef.current);
    for (const r of currentRecords) s.add(r.dni_number);
    seenDnisRef.current = s;
  }, [currentRecords]);

  useEffect(() => {
    if (session) loadSavedLists();
  }, [showSavedLists, session]);

  const loadSavedLists = async () => {
    const { data, error } = await supabase
      .from("scan_lists")
      .select(`*, scanned_records (*)`)
      .not("closed_at", "is", null)
      .order("created_at", { ascending: false })
      .order("scanned_at", { referencedTable: "scanned_records", ascending: true });

    if (error) {
      console.error(error);
      toast.error("No se pudieron cargar las listas guardadas: " + error.message);
      return;
    }
    setSavedLists(data || []);
  };

  const applyOpenList = (list: OpenList | null) => {
    openListRef.current = list;
    setOpenList(list);
    if (!titleFocusedRef.current) setListTitle(list?.title ?? "");
    if (list) {
      centroIdRef.current = list.centro_id;
      setCentroId(list.centro_id);
      lugarIdRef.current = list.lugar_id;
      setLugarId(list.lugar_id);
      const h = { modalidad: list.modalidad, fecha_inicio: list.fecha_inicio, fecha_fin: list.fecha_fin };
      horarioRef.current = h;
      setHorario(h);
    }
  };

  const resetOpenList = () => {
    applyOpenList(null);
    centroIdRef.current = null;
    setCentroId(null);
    lugarIdRef.current = null;
    setLugarId(null);
    horarioRef.current = SIN_HORARIO;
    setHorario(SIN_HORARIO);
    setPadron(null);
    setCurrentRecords([]);
    setLastRead(null);
    setLastAddedId(null);
    seenDnisRef.current = new Set(pendingDnisRef.current);
    sinPadronRef.current = false;
  };

  // Trae la lista abierta y sus registros (al entrar, al reconectar y al
  // volver a la pestaña, por si se perdió algún evento en el camino)
  const loadOpenList = async () => {
    const { data, error } = await supabase
      .from("scan_lists")
      .select(`*, scanned_records (*)`)
      .is("closed_at", null)
      .eq("user_id", userId!)
      .order("created_at", { ascending: false })
      .order("scanned_at", { referencedTable: "scanned_records", ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(error);
      toast.error("No se pudo cargar la lista en curso: " + error.message);
      return;
    }
    if (!data) {
      if (openListRef.current) resetOpenList();
      return;
    }
    applyOpenList(toOpenList(data));
    setPadron(toPadron(data));
    setCurrentRecords((data.scanned_records || []).map(toRecord));
  };

  // El padrón no se toma del evento de Realtime: Postgres omite los JSONB
  // grandes que no cambiaron, así que se vuelve a pedir.
  const loadPadron = async (listId: string) => {
    const { data, error } = await supabase
      .from("scan_lists")
      .select("padron, padron_archivo")
      .eq("id", listId)
      .maybeSingle();
    if (error) {
      console.error(error);
      return;
    }
    if (openListRef.current?.id === listId) setPadron(toPadron(data));
  };

  // DNI que no está en la lista: se busca por nombre y apellidos entre las
  // personas del Excel que no traían DNI. Si coincide, se acepta y su DNI se
  // guarda en la lista. Devuelve los DNI que quedaron validados.
  const validarPorNombre = async (pares: { dni: string; nombre: string }[]) => {
    const list = openListRef.current;
    const actual = padronDatosRef.current;
    if (!list || !actual || !pares.length) return new Set<string>();

    // Se parte del padrón más reciente (otro equipo pudo asignar DNIs)
    const { data } = await supabase
      .from("scan_lists")
      .select("padron, padron_archivo")
      .eq("id", list.id)
      .maybeSingle();
    const base = toPadron(data) ?? actual;

    const asignados = new Map<PersonaPadron, string>();
    const validados = new Set<string>();
    for (const { dni, nombre } of pares) {
      if (base.personas.some((p) => p.dni === dni)) {
        validados.add(dni);
        continue;
      }
      const libres = base.personas.filter((p) => !p.dni && !asignados.has(p));
      const match = buscarPorNombre(libres, nombre);
      if (match) {
        asignados.set(match, dni);
        validados.add(dni);
      }
    }
    if (!asignados.size) {
      if (base !== actual) setPadron(base);
      return validados;
    }

    const next: Padron = { ...base, personas: conDnis(base.personas, asignados) };
    const { error } = await supabase
      .from("scan_lists")
      .update({ padron: next.personas })
      .eq("id", list.id);
    if (error) {
      console.error(error);
      toast.error("No se pudo guardar el DNI en la lista: " + error.message);
    }
    // Se fija ya para que las siguientes lecturas lo vean
    padronDatosRef.current = next;
    padronRef.current = new Map(next.personas.filter((p) => p.dni).map((p) => [p.dni, p.nombre]));
    setPadron(next);
    return validados;
  };

  const addRecord = (rec: Record) =>
    setCurrentRecords((prev) =>
      prev.some((r) => r.id === rec.id || r.dni_number === rec.dni_number)
        ? prev
        : [...prev, rec]
    );

  // Crea la lista abierta con la primera lectura
  const ensureOpenList = async (): Promise<OpenList> => {
    if (openListRef.current) return openListRef.current;

    const title = listTitleRef.current.trim() || defaultTitle();
    const { data, error } = await supabase
      .from("scan_lists")
      .insert({
        title,
        user_id: userId!,
        centro_id: centroIdRef.current,
        lugar_id: lugarIdRef.current,
        ...horarioRef.current,
        ...calcularHorario(horarioRef.current),
      })
      .select()
      .single();

    if (error) {
      // 23505: otro equipo abrió una lista justo antes; se usa esa
      if (error.code === "23505") {
        const { data: existing } = await supabase
          .from("scan_lists")
          .select()
          .is("closed_at", null)
          .eq("user_id", userId!)
          .maybeSingle();
        if (existing) {
          const list = toOpenList(existing);
          applyOpenList(list);
          return list;
        }
      }
      throw error;
    }

    const list = toOpenList(data);
    applyOpenList(list);
    return list;
  };

  // ================== Realtime ==================
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`registro-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "scanned_records",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (row.scan_list_id !== openListRef.current?.id) {
            // Lista que este equipo aún no conoce (recién abierta en otro)
            loadOpenList();
            return;
          }
          const rec = toRecord(row);
          addRecord(rec);

          // Lectura hecha en otro equipo: mostrarla como última lectura
          if (!pendingDnisRef.current.has(rec.dni_number)) {
            setLastRead({
              raw: rec.dni_number,
              dni: rec.dni_number,
              nombre: rec.full_name,
              fuente: rec.fuente ?? null,
              estado:
                padronRef.current && !padronRef.current.has(rec.dni_number) ? "fuera" : "ok",
            });
            setLastAddedId(rec.id);
            bumpRead();
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "scanned_records",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const rec = toRecord(payload.new);
          setCurrentRecords((prev) => prev.map((r) => (r.id === rec.id ? { ...r, ...rec } : r)));
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "scanned_records" },
        (payload) => {
          const id = (payload.old as any)?.id;
          if (id) setCurrentRecords((prev) => prev.filter((r) => r.id !== id));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scan_lists",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const current = openListRef.current;
          if (payload.eventType === "DELETE") {
            if ((payload.old as any)?.id === current?.id) resetOpenList();
            loadSavedLists();
            return;
          }

          const row = payload.new as any;
          if (!row.closed_at) {
            if (!current || current.id === row.id) {
              if (!current) setCurrentRecords([]);
              applyOpenList(toOpenList(row));
              loadPadron(row.id);
            }
            return;
          }

          if (row.id === current?.id) {
            resetOpenList();
            if (!closingRef.current) {
              toast.success(`"${row.title}" se guardó desde otro equipo`);
            }
          }
          loadSavedLists();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setLiveStatus("live");
          loadOpenList();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLiveStatus("offline");
        }
      });

    // El celular suspende la conexión en segundo plano: al volver, ponerse al día
    const onVisible = () => {
      if (document.visibilityState === "visible") loadOpenList();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const focusScan = () => {
    if (!isTouch) scanInputRef.current?.focus();
  };

  const bumpRead = () => setReadSeq((n) => n + 1);

  const showDup = (raw: string, dni: string) => {
    const prev = recordsRef.current.find((r) => r.dni_number === dni);
    setLastRead({
      raw,
      dni,
      nombre: prev?.full_name ?? "",
      fuente: prev?.fuente ?? null,
      estado: "dup",
    });
    bumpRead();
    toast.warning(`DNI ya registrado en esta lista: ${dni}`);
  };

  // ================== Beep ==================
  const playBeep = async () => {
    try {
      if (!beepRef.current) {
        beepRef.current = new Audio("/beep.wav");
        beepRef.current.preload = "auto";
      }
      beepRef.current.volume = 1;
      beepRef.current.currentTime = 0;
      await beepRef.current.play();
    } catch {}
  };

  // ================== Código leído: anti-dup + BD/API + guarda ==================
  const processCode = async (raw: string) => {
    const dni = extractDniFromBarcode(raw);
    console.log("Lectura:", JSON.stringify(raw), "-> DNI:", dni);

    if (!dni) {
      setLastRead({ raw, dni: "", nombre: "", fuente: null, estado: "error" });
      bumpRead();
      toast.error(`Código no reconocido: ${raw}`);
      return;
    }

    if (seenDnisRef.current.has(dni)) {
      showDup(raw, dni);
      return;
    }

    // “reserva” el dni para evitar duplicado mientras consulta
    seenDnisRef.current.add(dni);
    pendingDnisRef.current.add(dni);
    setLookupLoading(true);
    setLastRead({ raw, dni, nombre: "", fuente: null, estado: "ok" });

    try {
      const result = await lookupDni(dni);

      if ("error" in result) {
        // permite reintentar
        seenDnisRef.current.delete(dni);
        setLastRead({ raw, dni, nombre: "", fuente: null, estado: "error" });
        bumpRead();
        toast.error(`${dni}: ${result.error}. No se agregará a la lista.`);
        return;
      }

      const nombre = result.persona.nombre_completo;
      const { fuente } = result;
      const list = await ensureOpenList();

      const { data: row, error } = await supabase
        .from("scanned_records")
        .insert({
          scan_list_id: list.id,
          dni_number: dni,
          full_name: nombre,
          scanned_at: new Date().toISOString(),
          user_id: userId!,
          fuente,
          bungalow_id: bungalowActualRef.current,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          // ya lo registró otro equipo en esta misma lista
          showDup(raw, dni);
          return;
        }
        throw error;
      }

      await playBeep();
      let porNombre = false;
      if (padronRef.current && !padronRef.current.has(dni)) {
        porNombre = (await validarPorNombre([{ dni, nombre }])).has(dni);
      }
      const fuera = !!padronRef.current && !padronRef.current.has(dni) && !porNombre;
      setLastRead({ raw, dni, nombre, fuente, estado: fuera ? "fuera" : "ok" });
      setLastAddedId(row.id);
      addRecord(toRecord(row));
      bumpRead();

      if (fuera) toast.error(`No está en la lista: ${nombre}`);
      else if (porNombre) toast.success(`Validado por nombre: ${nombre}. Su DNI quedó guardado en la lista.`);
      else toast.success(`Agregado: ${nombre}`);

      // Llega un día antes de la fecha del campamento
      const ini = horarioRef.current.fecha_inicio;
      if (ini && hoyYmd() < ini) {
        toast.warning(
          `Llega antes de su fecha de ingreso (${format(new Date(ini + "T12:00"), "dd/MM")}). Revisa la fecha de la lista.`
        );
      }
    } catch (e: any) {
      console.error(e);
      seenDnisRef.current.delete(dni);
      setLastRead({ raw, dni, nombre: "", fuente: null, estado: "error" });
      bumpRead();
      toast.error("No se pudo registrar el DNI: " + (e?.message ?? ""));
    } finally {
      pendingDnisRef.current.delete(dni);
      setLookupLoading(false);
    }
  };

  const runCode = (code: string) => {
    queueRef.current = queueRef.current.then(() => processCode(code));
  };

  const enqueueCode = (raw: string) => {
    const code = raw.trim();
    if (!code) return;

    // Antes de la primera lectura se pide el destino de la lista (centro y lugar)
    if (faltaDestino() && recordsRef.current.length === 0) {
      pendingCodeRef.current = { code, at: Date.now() };
      setAskCentro(centroIdRef.current);
      setAskLugar(true);
      return;
    }

    // Antes de la primera lectura se pide la lista de invitados (o confirmar
    // que se sigue sin ella). La lectura queda en espera, no se pierde.
    if (!padronRef.current && !sinPadronRef.current && recordsRef.current.length === 0) {
      pendingCodeRef.current = { code, at: Date.now() };
      setAskPadron(true);
      return;
    }
    runCode(code);
  };

  const flushPendingCode = () => {
    const pending = pendingCodeRef.current;
    pendingCodeRef.current = null;
    // Si pasó mucho tiempo (se canceló la subida y se volvió después),
    // esa lectura ya no corresponde a la persona que está en la puerta
    if (pending && Date.now() - pending.at < 2 * 60 * 1000) runCode(pending.code);
  };

  // Destino de la lista: si ya existe se guarda al instante (los otros equipos
  // lo reciben); si no, se usa al crearla con la primera lectura
  const cambiarDestino = async (cId: string | null, lId: string | null) => {
    const antes = { c: centroIdRef.current, l: lugarIdRef.current };
    centroIdRef.current = cId;
    setCentroId(cId);
    lugarIdRef.current = lId;
    setLugarId(lId);
    const list = openListRef.current;
    if (!list) return;
    const { error } = await supabase
      .from("scan_lists")
      .update({ centro_id: cId, lugar_id: lId })
      .eq("id", list.id);
    if (error) {
      centroIdRef.current = antes.c;
      setCentroId(antes.c);
      lugarIdRef.current = antes.l;
      setLugarId(antes.l);
      toast.error("No se pudo cambiar el destino: " + error.message);
      return;
    }
    openListRef.current = { ...list, centro_id: cId, lugar_id: lId };
  };

  // Horario: si la lista ya existe se guarda al instante
  const cambiarHorario = async (cambios: Partial<Horario>) => {
    const antes = horarioRef.current;
    const h = { ...antes, ...cambios };
    if (h.modalidad === "full_day") h.fecha_fin = h.fecha_inicio;
    horarioRef.current = h;
    setHorario(h);
    const list = openListRef.current;
    if (!list) return;
    const { error } = await supabase
      .from("scan_lists")
      .update({ ...h, ...calcularHorario(h) })
      .eq("id", list.id);
    if (error) {
      horarioRef.current = antes;
      setHorario(antes);
      toast.error("No se pudo guardar el horario: " + error.message);
      return;
    }
    openListRef.current = { ...list, ...h };
  };

  // Al cambiar de centro se quita el lugar si no es de ese centro
  const cambiarCentro = (cId: string) => {
    const lugar = lugares.find((l) => l.id === lugarIdRef.current);
    cambiarDestino(cId, lugar?.centro_id === cId ? lugar.id : null);
  };

  const cambiarLugar = (lId: string) => cambiarDestino(centroIdRef.current, lId);

  // Paso 1 del aviso: el centro. Si tiene lugares se pasa al paso 2.
  const elegirCentroEnAviso = (cId: string) => {
    if (lugaresDe(cId).length > 0) setAskCentro(cId);
    else elegirDestinoYSeguir(cId, null);
  };

  const elegirDestinoYSeguir = async (cId: string, lId: string | null) => {
    setAskLugar(false);
    await cambiarDestino(cId, lId);
    // Sigue el flujo normal con la lectura en espera (puede pedir el padrón)
    const pending = pendingCodeRef.current;
    pendingCodeRef.current = null;
    if (pending && Date.now() - pending.at < 2 * 60 * 1000) enqueueCode(pending.code);
    else focusScan();
  };

  const continueSinPadron = () => {
    sinPadronRef.current = true;
    setAskPadron(false);
    flushPendingCode();
    focusScan();
  };

  const uploadFromAsk = () => {
    setAskPadron(false);
    padronInputRef.current?.click();
  };

  // Lector alámbrico o inalámbrico (ambos funcionan como teclado)
  useBarcodeScanner(enqueueCode, {
    enabled: !!session && view === "registro" && !askPadron && !askLugar && !finalizarOpen,
  });

  // Mantiene el foco en el campo del lector
  useEffect(() => {
    if (session && view === "registro") focusScan();
  }, [session, view]);

  const handleScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    enqueueCode(scanValue);
    setScanValue("");
    scanInputRef.current?.focus();
  };

  const handleRemoveRecord = async (id: string) => {
    const rec = currentRecords.find((r) => r.id === id);
    const { error } = await supabase.from("scanned_records").delete().eq("id", id);
    if (error) {
      toast.error("No se pudo quitar: " + error.message);
      return;
    }
    setCurrentRecords((prev) => prev.filter((r) => r.id !== id));
    if (rec) toast(`Quitado: ${rec.full_name}`);
    focusScan();
  };

  // El título se guarda al salir del campo, y los otros equipos lo reciben
  const saveTitle = async () => {
    const title = listTitle.trim();
    const list = openListRef.current;
    if (!list || !title || title === list.title) return;
    const { error } = await supabase.from("scan_lists").update({ title }).eq("id", list.id);
    if (error) toast.error("No se pudo guardar el título: " + error.message);
    else openListRef.current = { ...list, title };
  };

  // ================== Finalizar lista ==================
  const handleSaveList = () => {
    if (!listTitle.trim()) {
      toast.error("Ingresa un título para la lista");
      return;
    }
    const list = openListRef.current;
    if (!list || currentRecords.length === 0) {
      toast.error("No hay registros para guardar");
      return;
    }
    setFinalizarOpen(true);
  };

  // Con estadía: la lista sigue activa en la puerta de su lugar hasta que se
  // termine la estadía. Sin estadía: queda finalizada (evento de un día).
  const cerrarLista = async (conEstadia: boolean) => {
    const list = openListRef.current;
    if (!list) return;
    if (conEstadia && (!centroIdRef.current || faltaDestino())) {
      toast.error("Elige el centro y el lugar de destino para controlar la estadía");
      return;
    }
    if (conEstadia && horarioRef.current.modalidad === "estadia" && !horarioRef.current.fecha_fin) {
      toast.error("Falta la fecha de salida de la estadía (debajo del título)");
      setFinalizarOpen(false);
      return;
    }
    setFinalizarOpen(false);
    setLoading(true);
    closingRef.current = true;
    try {
      const ahora = new Date().toISOString();
      const { error } = await supabase
        .from("scan_lists")
        .update({
          title: listTitle.trim(),
          closed_at: ahora,
          estadia_fin_at: conEstadia ? null : ahora,
        })
        .eq("id", list.id);

      if (error) throw error;

      toast.success(
        conEstadia
          ? `Llegada cerrada. "${listTitle.trim()}" está en estadía en ${nombreDestino(centroIdRef.current, lugarIdRef.current)}`
          : "Lista finalizada"
      );
      resetOpenList();
      setListTitle("");
      await loadSavedLists();
    } catch (e: any) {
      console.error(e);
      toast.error("Error al guardar: " + (e?.message ?? ""));
    } finally {
      // deja pasar el evento de Realtime de este mismo cierre
      window.setTimeout(() => (closingRef.current = false), 3000);
      setLoading(false);
      focusScan();
    }
  };

  // ================== Lista de invitados ==================
  const savePadron = async (next: Padron | null) => {
    const list = await ensureOpenList();
    const { error } = await supabase
      .from("scan_lists")
      .update({ padron: next?.personas ?? null, padron_archivo: next?.archivo ?? null })
      .eq("id", list.id);
    if (error) throw error;
    setPadron(next);
  };

  const handlePadronFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setPadronLoading(true);
    try {
      const parsed = await parsePadronFile(file);
      if (parsed.personas.length === 0) {
        toast.error(`No se encontraron DNI ni nombres en "${file.name}"`);
        return;
      }
      // Los ya registrados que no están por DNI se buscan por nombre entre los
      // que no traen DNI en el Excel, y se les guarda el DNI
      const dnisExcel = new Set(parsed.personas.map((p) => p.dni).filter(Boolean));
      const asignados = new Map<PersonaPadron, string>();
      for (const r of recordsRef.current) {
        if (dnisExcel.has(r.dni_number)) continue;
        const libres = parsed.personas.filter((p) => !p.dni && !asignados.has(p));
        const match = buscarPorNombre(libres, r.full_name ?? "");
        if (match) asignados.set(match, r.dni_number);
      }
      if (asignados.size) parsed.personas = conDnis(parsed.personas, asignados);
      // Cabecera del Excel: el título es la institución y el horario sale de
      // "Fecha Campamento" (dos fechas = estadía, una = full day). Se toman
      // siempre del archivo, aunque la lista ya exista.
      const tomados: string[] = [];
      if (parsed.organizacion) {
        setListTitle(parsed.organizacion);
        listTitleRef.current = parsed.organizacion;
        tomados.push(`título "${parsed.organizacion}"`);
      }
      if (parsed.fechas) {
        const { inicio, fin } = parsed.fechas;
        const modalidad: Modalidad = fin && fin !== inicio ? "estadia" : "full_day";
        await cambiarHorario({ modalidad, fecha_inicio: inicio, fecha_fin: fin ?? inicio });
        tomados.push(
          `${HORARIO[modalidad].nombre.toLowerCase()} del ${format(new Date(inicio + "T12:00"), "dd/MM/yyyy")}` +
            (fin && fin !== inicio ? ` al ${format(new Date(fin + "T12:00"), "dd/MM/yyyy")}` : "")
        );
      }
      await savePadron(parsed);
      // Si la lista ya existía, se guarda el título del Excel
      const abierta = openListRef.current;
      if (parsed.organizacion && abierta && abierta.title !== parsed.organizacion) {
        const { error } = await supabase
          .from("scan_lists")
          .update({ title: parsed.organizacion })
          .eq("id", abierta.id);
        if (error) toast.error("No se pudo guardar el título: " + error.message);
        else openListRef.current = { ...abierta, title: parsed.organizacion };
      }
      if (tomados.length) toast(`Del Excel: ${tomados.join(" y ")}.`);
      // padronRef se actualiza en el próximo render; se fija ya para que la
      // lectura en espera se valide contra la lista recién subida
      padronRef.current = new Map(
        parsed.personas.filter((p) => p.dni).map((p) => [p.dni, p.nombre])
      );
      padronDatosRef.current = parsed;
      const sinNombre = parsed.personas.filter((p) => !p.nombre).length;
      const sinDni = parsed.personas.filter((p) => !p.dni).length;
      toast.success(
        `Lista cargada: ${parsed.personas.length} personas` +
          (sinNombre ? ` (${sinNombre} sin nombre)` : "") +
          (sinDni ? `. ${sinDni} sin DNI: se validarán por nombre y apellidos al escanear` : "") +
          (asignados.size ? `. ${asignados.size} ya registrados se validaron por nombre` : "")
      );
      flushPendingCode();
    } catch (err: any) {
      console.error(err);
      toast.error("No se pudo leer la lista: " + (err?.message ?? ""));
    } finally {
      setPadronLoading(false);
      focusScan();
    }
  };

  const handleRemovePadron = async () => {
    if (!window.confirm("¿Quitar la lista de invitados? Los registros no se borran.")) return;
    try {
      await savePadron(null);
      toast("Lista de invitados quitada");
    } catch (err: any) {
      toast.error("No se pudo quitar la lista: " + (err?.message ?? ""));
    } finally {
      focusScan();
    }
  };

  // Fin de la estadía: la lista deja de contar en la puerta
  const terminarEstadia = async (list: any) => {
    const { data: fuera } = list.centro_id
      ? await supabase.rpc("estado_puerta", { p_centro_id: list.centro_id })
      : { data: null };
    const pendientes = ((fuera as any)?.fuera ?? []).filter((p: any) => p.lista_id === list.id);
    const aviso = pendientes.length
      ? `\n\nAtención: ${pendientes.length} ${
          pendientes.length === 1 ? "acampante sigue" : "acampantes siguen"
        } fuera: ${pendientes.map((p: any) => p.nombre).join(", ")}.`
      : "";
    if (!window.confirm(`¿Terminar la estadía de "${list.title}"?${aviso}`)) return;
    const { error } = await supabase
      .from("scan_lists")
      .update({ estadia_fin_at: new Date().toISOString() })
      .eq("id", list.id);
    if (error) {
      toast.error("No se pudo terminar la estadía: " + error.message);
      return;
    }
    toast.success(`Estadía terminada: ${list.title}`);
    loadSavedLists();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Sesión cerrada");
  };

  const stats = useMemo(
    () => ({
      total: currentRecords.length,
      bd: currentRecords.filter((r) => r.fuente === "bd").length,
      api: currentRecords.filter((r) => r.fuente === "api").length,
    }),
    [currentRecords]
  );

  const padronStats = useMemo(() => {
    if (!padronSet || !padron) return null;
    const enLista = currentRecords.filter((r) => padronSet.has(r.dni_number)).length;
    // El total incluye a los que aún no tienen DNI (solo nombre en el Excel)
    const total = padronSet.size + padron.personas.filter((p) => !p.dni).length;
    return {
      enLista,
      fuera: currentRecords.length - enLista,
      faltan: total - enLista,
      total,
    };
  }, [currentRecords, padronSet, padron]);

  const filteredLists = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    const porLugar =
      centroFiltro === "todos"
        ? savedLists
        : savedLists.filter((l) =>
            centroFiltro === "ninguno" ? !l.centro_id : l.centro_id === centroFiltro
          );
    // Primero las que están en estadía
    const ordenadas = [...porLugar].sort(
      (a, b) => Number(etapaLista(b) === "estadia") - Number(etapaLista(a) === "estadia")
    );
    if (!q) return ordenadas;
    return ordenadas.filter(
      (l) =>
        l.title?.toLowerCase().includes(q) ||
        (l.scanned_records || []).some(
          (r: Record) =>
            r.dni_number.includes(q) || r.full_name.toLowerCase().includes(q)
        )
    );
  }, [savedLists, listSearch, centroFiltro]);

  const scannerStatus = lookupLoading
    ? { text: "Consultando…", dot: "bg-warning", pulse: true }
    : titleFocused
    ? { text: "En pausa mientras editas el título", dot: "bg-muted-foreground/50", pulse: false }
    : { text: "Listo para escanear", dot: "bg-success", pulse: true };

  const tabs = [
    { key: "registro" as const, label: "Registro", icon: ScanBarcode },
    { key: "puerta" as const, label: "Puerta", icon: DoorOpen, alerta: vencidosPuerta },
    { key: "listas" as const, label: "Listas", icon: ClipboardList, count: savedLists.length },
    ...(isAdmin ? [{ key: "usuarios" as const, label: "Usuarios", icon: ShieldCheck }] : []),
  ];

  const email: string = session.user?.email ?? "";
  const llegada = padronStats
    ? Math.round((padronStats.enLista / Math.max(padronStats.total, 1)) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      {/* ================== Barra superior ================== */}
      <header className="sticky top-0 z-30 bg-primary text-primary-foreground">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <div className="flex items-center gap-2">
            <Tent className="h-5 w-5" strokeWidth={2.25} />
            <span className="font-sign hidden text-lg font-bold sm:inline">Acampantes</span>
          </div>

          <nav className="mx-auto flex h-full items-stretch gap-1 text-sm sm:gap-2">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                aria-current={view === t.key ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-1.5 px-3 font-medium transition-colors",
                  "after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t-full after:transition-colors",
                  view === t.key
                    ? "text-primary-foreground after:bg-primary-foreground"
                    : "text-primary-foreground/60 after:bg-transparent hover:text-primary-foreground"
                )}
              >
                <t.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{t.label}</span>
                {t.count !== undefined && t.count > 0 && (
                  <span className="text-xs tabular-nums opacity-60">{t.count}</span>
                )}
                {!!t.alerta && (
                  <span
                    className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-xs font-bold tabular-nums text-white"
                    title={`${t.alerta} fuera de hora`}
                  >
                    {t.alerta}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-foreground/15 text-sm font-semibold uppercase transition hover:bg-primary-foreground/25"
                aria-label="Cuenta"
              >
                {email.charAt(0) || "?"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm font-medium">{email}</p>
                <p className="text-xs text-muted-foreground">
                  {isAdmin ? "Administrador" : "Usuario"}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {isAdmin && (
                <DropdownMenuItem onSelect={() => setLugaresOpen(true)}>
                  <MapPin className="mr-2 h-4 w-4" />
                  Centros y lugares
                </DropdownMenuItem>
              )}
              {onCambiarModulo && (
                <DropdownMenuItem onSelect={onCambiarModulo}>
                  <Clock className="mr-2 h-4 w-4" />
                  Ir a Asistencia del personal
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <AlertDialog
        open={askPadron}
        onOpenChange={(open) => {
          setAskPadron(open);
          if (!open) focusScan();
        }}
      >
        <AlertDialogContent className="max-w-md rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-sign text-2xl font-bold">
              Primero sube la lista de invitados
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              Sin el Excel o PDF no se puede verificar si cada persona está en la lista.
              El DNI que escaneaste se registrará al continuar o apenas termine de
              subirse el archivo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" className="h-11 rounded-md" onClick={continueSinPadron}>
              Continuar sin archivo
            </Button>
            <Button className="h-11 rounded-md" onClick={uploadFromAsk} autoFocus>
              <FileUp className="mr-2 h-4 w-4" />
              Subir archivo
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ================== ¿A dónde va la lista? (centro y lugar) ================== */}
      <AlertDialog
        open={askLugar}
        onOpenChange={(open) => {
          setAskLugar(open);
          if (!open) {
            pendingCodeRef.current = null;
            focusScan();
          }
        }}
      >
        <AlertDialogContent className="max-w-md rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-sign text-2xl font-bold">
              {askCentro ? `¿En qué lugar de ${nombreDestino(askCentro, null)}?` : "¿A qué centro va esta lista?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {askCentro
                ? "Elige el alojamiento del grupo. El DNI que escaneaste se registrará al elegirlo."
                : "El centro define en qué puerta se controlan las salidas y los regresos. Luego eliges el lugar."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid max-h-[50vh] gap-2 overflow-y-auto">
            {askCentro
              ? lugaresDe(askCentro).map((l) => (
                  <Button
                    key={l.id}
                    variant="outline"
                    className="h-12 justify-start rounded-md text-base"
                    onClick={() => elegirDestinoYSeguir(askCentro, l.id)}
                  >
                    <MapPin className="mr-2 h-4 w-4 text-primary" />
                    {l.nombre}
                  </Button>
                ))
              : centrosActivos.map((c) => (
                  <Button
                    key={c.id}
                    variant="outline"
                    className="h-12 justify-start rounded-md text-base"
                    onClick={() => elegirCentroEnAviso(c.id)}
                  >
                    <Building2 className="mr-2 h-4 w-4 text-primary" />
                    {c.nombre}
                  </Button>
                ))}
          </div>
          {askCentro && (
            <Button variant="ghost" className="justify-start" onClick={() => setAskCentro(null)}>
              ← Cambiar de centro
            </Button>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* ================== Cerrar la llegada ================== */}
      <AlertDialog open={finalizarOpen} onOpenChange={setFinalizarOpen}>
        <AlertDialogContent className="max-w-md rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-sign text-2xl font-bold">
              Cerrar la llegada
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {destinoCompleto
                ? `Si el grupo se queda en ${nombreDestino(centroId, lugarId)}, pásalo a estadía para controlar sus salidas y regresos en la Puerta.`
                : "Esta lista no tiene centro y lugar de destino, así que no se pueden controlar salidas. Elígelos debajo del título para habilitar la estadía."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Button
              className="h-auto justify-start rounded-md px-4 py-3 text-left"
              onClick={() => cerrarLista(true)}
              disabled={!destinoCompleto}
              autoFocus
            >
              <DoorOpen className="mr-3 h-5 w-5 shrink-0" />
              <span>
                <span className="block font-semibold">Pasar a estadía</span>
                <span className="block text-sm font-normal opacity-80">
                  Sigue activa en la Puerta hasta terminar la estadía
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto justify-start rounded-md px-4 py-3 text-left"
              onClick={() => cerrarLista(false)}
            >
              <Flag className="mr-3 h-5 w-5 shrink-0" />
              <span>
                <span className="block font-semibold">Finalizar sin estadía</span>
                <span className="block text-sm font-normal text-muted-foreground">
                  Evento de un día: la lista pasa directo a finalizadas
                </span>
              </span>
            </Button>
            <Button variant="ghost" onClick={() => setFinalizarOpen(false)}>
              Cancelar
            </Button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {isAdmin && (
        <CentrosDialog
          open={lugaresOpen}
          onOpenChange={setLugaresOpen}
          centros={centros}
          lugares={lugares}
          bungalows={bungalows}
          onCambio={recargarLugares}
        />
      )}

      <main className="mx-auto max-w-6xl px-4 py-5 sm:py-8">
        {/* La puerta sigue montada en otras pestañas para avisar a la hora límite */}
        <div className={view === "puerta" ? undefined : "hidden"}>
          <Puerta
            active={view === "puerta" && !lugaresOpen}
            isAdmin={isAdmin}
            centros={centros}
            onAdministrar={() => setLugaresOpen(true)}
            onVencidos={setVencidosPuerta}
          />
        </div>

        {view === "puerta" ? null : view === "usuarios" && isAdmin ? (
          <AdminUsers currentUserId={userId!} />
        ) : view === "registro" ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
            {/* ================== Columna lector ================== */}
            <div className="min-w-0 space-y-5 lg:sticky lg:top-20 lg:self-start">
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="relative flex h-2 w-2">
                    {scannerStatus.pulse && (
                      <span
                        className={cn(
                          "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
                          scannerStatus.dot
                        )}
                      />
                    )}
                    <span className={cn("relative inline-flex h-2 w-2 rounded-full", scannerStatus.dot)} />
                  </span>
                  {scannerStatus.text}
                </div>

                <form onSubmit={handleScanSubmit} className="relative">
                  <Label htmlFor="scan" className="sr-only">
                    DNI
                  </Label>
                  <ScanBarcode className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="scan"
                    ref={scanInputRef}
                    placeholder="Escanea o escribe el DNI"
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
              </div>

              {bungalowsLista.length > 0 && (
                <section aria-label="Bungalow actual" className="rounded-lg border bg-card p-3">
                  <Label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <BedDouble className="h-4 w-4" />
                    Bungalow actual: cada DNI que escanees va aquí
                  </Label>
                  <Select
                    value={bungalowActual ?? "ninguno"}
                    onValueChange={(v) => {
                      setBungalowActual(v === "ninguno" ? null : v);
                      window.setTimeout(focusScan, 0);
                    }}
                  >
                    <SelectTrigger
                      className={cn(
                        "mt-1.5 h-11 border-2 text-base font-semibold",
                        bungalowActual ? "border-primary" : "border-dashed text-muted-foreground"
                      )}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ninguno">Sin bungalow (asignar después)</SelectItem>
                      {bungalowsLista.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    {bungalowsLista.map((b) => (
                      <span key={b.id} className="rounded-full bg-muted px-2 py-0.5">
                        {b.nombre}: <span className="font-semibold tabular-nums">{ocupacion.get(b.id) ?? 0}</span>
                      </span>
                    ))}
                    {(ocupacion.get(null) ?? 0) > 0 && (
                      <span className="rounded-full border border-dashed px-2 py-0.5 text-muted-foreground">
                        Sin bungalow: <span className="font-semibold tabular-nums">{ocupacion.get(null)}</span>
                      </span>
                    )}
                  </div>
                </section>
              )}

              <VerdictBoard
                key={readSeq}
                read={lastRead}
                loading={lookupLoading}
                hasPadron={!!padronMap}
                animate={readSeq > 0}
              />

              {/* Lista de invitados: barra de llegada */}
              <section aria-label="Lista de invitados">
                <input
                  ref={padronInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt,.pdf"
                  className="hidden"
                  onChange={handlePadronFile}
                />
                {padron && padronStats ? (
                  <div className="rounded-lg border bg-card p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-sign text-3xl font-bold tabular-nums leading-none">
                        {padronStats.enLista}
                        <span className="text-xl font-semibold text-muted-foreground">
                          {" "}
                          de {padronStats.total}
                        </span>
                      </p>
                      <p className="text-sm text-muted-foreground">invitados llegaron</p>
                    </div>

                    <div
                      className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-valuenow={padronStats.enLista}
                      aria-valuemin={0}
                      aria-valuemax={padronStats.total}
                      aria-label="Invitados que llegaron"
                    >
                      <div
                        className="h-full rounded-full bg-success transition-[width] duration-500"
                        style={{ width: `${llegada}%` }}
                      />
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                      <span className="flex items-center gap-1.5">
                        <CircleX className="h-4 w-4 text-destructive" />
                        <span className="font-semibold tabular-nums">{padronStats.fuera}</span>
                        fuera de lista
                      </span>
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Users className="h-4 w-4" />
                        <span className="font-semibold tabular-nums text-foreground">
                          {padronStats.faltan}
                        </span>
                        por llegar
                      </span>
                    </div>

                    <div className="mt-4 flex items-center gap-1 border-t pt-3">
                      <FileUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <p
                        className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
                        title={padron.archivo}
                      >
                        {padron.archivo || "Lista cargada"}
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2.5"
                        onClick={() => padronInputRef.current?.click()}
                        disabled={padronLoading}
                      >
                        {padronLoading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        Reemplazar
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={handleRemovePadron}
                        disabled={padronLoading}
                        title="Quitar lista de invitados"
                        aria-label="Quitar lista de invitados"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => padronInputRef.current?.click()}
                    disabled={padronLoading}
                    className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-input px-4 py-3.5 text-left transition-colors hover:border-primary/40 hover:bg-card disabled:opacity-60"
                  >
                    {padronLoading ? (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <FileUp className="h-5 w-5 shrink-0 text-primary" />
                    )}
                    <span>
                      <span className="block text-sm font-semibold">Cargar lista de invitados</span>
                      <span className="block text-sm text-muted-foreground">
                        Excel, CSV o PDF con DNI. Cada lectura se compara con ella.
                      </span>
                    </span>
                  </button>
                )}
              </section>

              <p className="hidden text-sm leading-relaxed text-muted-foreground lg:block">
                Funciona con lector alámbrico, inalámbrico o escribiendo el DNI. Cada
                lectura se guarda al instante y aparece en tus otros equipos.
              </p>
            </div>

            {/* ================== Libro de ingreso ================== */}
            <section className="min-w-0 rounded-lg border bg-card">
              <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <Label htmlFor="title" className="sr-only">
                    Título de la lista
                  </Label>
                  <input
                    id="title"
                    placeholder={`Ingreso ${format(new Date(), "dd/MM/yyyy")}`}
                    value={listTitle}
                    onChange={(e) => setListTitle(e.target.value)}
                    onFocus={() => {
                      titleFocusedRef.current = true;
                      setTitleFocused(true);
                    }}
                    onBlur={() => {
                      titleFocusedRef.current = false;
                      setTitleFocused(false);
                      saveTitle();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (isTouch) e.currentTarget.blur();
                        else scanInputRef.current?.focus();
                      }
                    }}
                    className="font-sign w-full rounded-sm bg-transparent text-2xl font-bold outline-none placeholder:text-muted-foreground/50"
                    title="Título de la lista (clic para editar)"
                  />
                  {centrosActivos.length > 0 || centroId ? (
                    <div className="mt-1 flex flex-wrap items-center gap-x-4">
                      <Select value={centroId ?? undefined} onValueChange={cambiarCentro}>
                        <SelectTrigger
                          className="h-8 w-auto max-w-full gap-1.5 border-0 bg-transparent px-0 text-sm font-medium shadow-none focus:ring-0 focus:ring-offset-0 [&>span]:truncate"
                          aria-label="Centro de destino"
                        >
                          <Building2 className={cn("h-4 w-4 shrink-0", centroId ? "text-primary" : "text-muted-foreground")} />
                          <SelectValue placeholder="Elegir centro" />
                        </SelectTrigger>
                        <SelectContent>
                          {centros
                            .filter((c) => c.activo || c.id === centroId)
                            .map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.nombre}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {centroId && (lugaresDe(centroId).length > 0 || lugarId) && (
                        <Select value={lugarId ?? undefined} onValueChange={cambiarLugar}>
                          <SelectTrigger
                            className="h-8 w-auto max-w-full gap-1.5 border-0 bg-transparent px-0 text-sm font-medium shadow-none focus:ring-0 focus:ring-offset-0 [&>span]:truncate"
                            aria-label="Lugar de destino"
                          >
                            <MapPin className={cn("h-4 w-4 shrink-0", lugarId ? "text-primary" : "text-destructive")} />
                            <SelectValue placeholder="Elegir lugar" />
                          </SelectTrigger>
                          <SelectContent>
                            {lugares
                              .filter((l) => l.centro_id === centroId && (l.activo || l.id === lugarId))
                              .map((l) => (
                                <SelectItem key={l.id} value={l.id}>
                                  {l.nombre}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ) : (
                    isAdmin && (
                      <button
                        type="button"
                        onClick={() => setLugaresOpen(true)}
                        className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                      >
                        <Settings2 className="h-4 w-4" />
                        Crear centros y lugares
                      </button>
                    )
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <CalendarDays
                      className={cn("h-4 w-4 shrink-0", horario.modalidad ? "text-primary" : "text-muted-foreground")}
                    />
                    <select
                      value={horario.modalidad ?? ""}
                      onChange={(e) =>
                        cambiarHorario({
                          modalidad: (e.target.value || null) as Modalidad | null,
                          fecha_inicio: horario.fecha_inicio ?? hoyYmd(),
                        })
                      }
                      className="h-8 rounded-md bg-transparent pr-1 font-medium outline-none focus:ring-2 focus:ring-ring"
                      aria-label="Modalidad"
                    >
                      <option value="">Sin horario</option>
                      <option value="estadia">Estadía (17:00 → 15:00)</option>
                      <option value="full_day">Full day (09:00 → 17:00)</option>
                    </select>
                    {horario.modalidad && (
                      <>
                        <input
                          type="date"
                          value={horario.fecha_inicio ?? ""}
                          onChange={(e) => {
                            const ini = e.target.value || null;
                            cambiarHorario({
                              fecha_inicio: ini,
                              // La salida no puede ser antes del ingreso
                              fecha_fin:
                                horario.fecha_fin && ini && horario.fecha_fin < ini ? ini : horario.fecha_fin,
                            });
                          }}
                          className="h-8 rounded-md border bg-card px-1.5 text-sm"
                          aria-label={horario.modalidad === "estadia" ? "Fecha de ingreso" : "Fecha"}
                        />
                        {horario.modalidad === "estadia" && (
                          <>
                            <span className="text-muted-foreground">al</span>
                            <input
                              type="date"
                              value={horario.fecha_fin ?? ""}
                              min={horario.fecha_inicio ?? undefined}
                              onChange={(e) => cambiarHorario({ fecha_fin: e.target.value || null })}
                              className={cn(
                                "h-8 rounded-md border bg-card px-1.5 text-sm",
                                !horario.fecha_fin && "border-destructive"
                              )}
                              aria-label="Fecha de salida"
                            />
                          </>
                        )}
                      </>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5" title="Registrados">
                      <Users className="h-4 w-4 text-success" />
                      <span className="font-semibold tabular-nums text-foreground">{stats.total}</span>
                      {stats.total === 1 ? "registrado" : "registrados"}
                    </span>
                    <span className="flex items-center gap-1.5" title="Datos de la base de acampantes">
                      <Database className="h-4 w-4" />
                      <span className="font-semibold tabular-nums text-foreground">{stats.bd}</span>
                      base
                    </span>
                    <span className="flex items-center gap-1.5" title="Datos obtenidos del API">
                      <Globe className="h-4 w-4 text-accent" />
                      <span className="font-semibold tabular-nums text-foreground">{stats.api}</span>
                      API
                    </span>
                    <span
                      className="flex items-center gap-1.5"
                      title={
                        liveStatus === "live"
                          ? "Sincronizado en tiempo real con tus otros equipos"
                          : "Sin conexión en tiempo real; reintentando…"
                      }
                    >
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          liveStatus === "live" && "bg-success",
                          liveStatus === "connecting" && "animate-pulse bg-warning",
                          liveStatus === "offline" && "bg-destructive"
                        )}
                      />
                      {liveStatus === "live"
                        ? "En vivo"
                        : liveStatus === "connecting"
                        ? "Conectando…"
                        : "Sin conexión"}
                    </span>
                  </div>
                </div>
                <Button
                  onClick={handleSaveList}
                  disabled={loading || !openList || currentRecords.length === 0}
                  title="Cierra la llegada: pasa la lista a estadía o la finaliza"
                  className="h-10 rounded-md px-4"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  Cerrar llegada
                </Button>
              </div>
              <div className="max-h-[calc(100vh-12rem)] overflow-y-auto px-2 py-1 sm:px-3">
                <RecordsList
                  records={currentRecords}
                  newestFirst
                  highlightId={lastAddedId}
                  onRemove={handleRemoveRecord}
                  padron={padronSet}
                  bungalows={bungalowsLista}
                  onBungalowChange={cambiarBungalow}
                />
              </div>
            </section>
          </div>
        ) : (
          /* ================== Listas guardadas ================== */
          <div className="mx-auto max-w-3xl space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="font-sign text-3xl font-bold">Listas</h1>
                <p className="text-sm text-muted-foreground">
                  {savedLists.length === 0
                    ? "Aquí aparecen las listas al cerrar la llegada"
                    : `${savedLists.length} ${savedLists.length === 1 ? "lista" : "listas"}` +
                      (() => {
                        const n = savedLists.filter((l) => etapaLista(l) === "estadia").length;
                        return n ? ` · ${n} en estadía` : "";
                      })()}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
              {centros.length > 0 && (
                <Select value={centroFiltro} onValueChange={setCentroFiltro}>
                  <SelectTrigger
                    className="h-10 rounded-md border-2 bg-card sm:w-48"
                    aria-label="Filtrar por centro"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los centros</SelectItem>
                    {centros.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nombre}
                      </SelectItem>
                    ))}
                    <SelectItem value="ninguno">Sin centro</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <div className="relative sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar título, nombre o DNI"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  className="rounded-md border-2 bg-card pl-9 focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
              </div>
            </div>

            {filteredLists.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed py-16 text-center text-sm text-muted-foreground">
                {savedLists.length === 0
                  ? "Todavía no hay listas. Usa “Cerrar llegada” en Registro."
                  : "Ninguna lista coincide con la búsqueda"}
              </div>
            ) : (
              <div className="divide-y overflow-hidden rounded-lg border bg-card">
                {filteredLists.map((list) => {
                  const count = list.scanned_records?.length ?? 0;
                  const dnis = padronDnis(list);
                  const enLista = dnis
                    ? (list.scanned_records || []).filter((r: Record) => dnis.has(r.dni_number)).length
                    : 0;
                  const etapa = etapaLista(list);
                  const centroLista = centros.find((c) => c.id === list.centro_id) ?? null;
                  const destino = nombreDestino(list.centro_id, list.lugar_id);
                  const checkoutPasado = !!list.checkout_at && new Date(list.checkout_at) <= new Date();
                  const bungalowsDeLista = bungalowsDe(
                    list.lugar_id,
                    (list.scanned_records || []).map((r: Record) => r.bungalow_id)
                  );
                  const bungalowDeLista = new Map<string, string>(
                    (list.scanned_records || [])
                      .map((r: Record) => [
                        r.dni_number,
                        bungalows.find((b) => b.id === r.bungalow_id)?.nombre,
                      ])
                      .filter((x: [string, string | undefined]) => !!x[1])
                  );
                  // Tuvo estadía si no se finalizó en el mismo momento que se cerró la llegada
                  const tuvoEstadia =
                    etapa === "estadia" ||
                    (!!list.estadia_fin_at && list.estadia_fin_at !== list.closed_at);
                  return (
                    <Collapsible key={list.id}>
                      <CollapsibleTrigger className="group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 sm:px-5">
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2">
                            <span className="font-sign truncate text-lg font-bold">{list.title}</span>
                            {etapa === "estadia" &&
                              (checkoutPasado ? (
                                <span className="shrink-0 rounded-full bg-warning/20 px-2 py-0.5 text-xs font-semibold">
                                  Check-out pasado
                                </span>
                              ) : (
                                <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
                                  En estadía
                                </span>
                              ))}
                          </p>
                          {list.modalidad && (
                            <p className="truncate text-sm text-muted-foreground">
                              <CalendarDays className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                              {textoHorario(list)}
                            </p>
                          )}
                          <p className="truncate text-sm text-muted-foreground">
                            {destino && (
                              <>
                                <MapPin className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />
                                {destino} ·{" "}
                              </>
                            )}
                            {format(new Date(list.created_at), "d 'de' MMMM yyyy, HH:mm", {
                              locale: es,
                            })}
                            {list.estadia_fin_at && tuvoEstadia && (
                              <> → {format(new Date(list.estadia_fin_at), "d 'de' MMMM, HH:mm", { locale: es })}</>
                            )}
                          </p>
                        </div>
                        {dnis && (
                          <span
                            className="flex items-center gap-1 text-sm tabular-nums text-success"
                            title="Invitados que llegaron"
                          >
                            <CircleCheck className="h-4 w-4" />
                            {enLista}/{dnis.size + (toPadron(list)?.personas.filter((p) => !p.dni).length ?? 0)}
                          </span>
                        )}
                        <span
                          className="flex items-center gap-1 text-sm tabular-nums text-muted-foreground"
                          title="Registrados"
                        >
                          <Users className="h-4 w-4" />
                          {count}
                        </span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="border-t bg-background/60 px-2 py-1 sm:px-3">
                          {etapa === "estadia" && (
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-1 py-3">
                              <p className="text-sm text-muted-foreground">
                                {checkoutPasado
                                  ? "Ya pasó el check-out: quien sale no puede volver a entrar. Termina la estadía cuando todos se hayan ido."
                                  : "Las salidas y regresos se registran en la pestaña Puerta."}
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={() => terminarEstadia(list)}
                              >
                                <Flag className="mr-1.5 h-3.5 w-3.5" />
                                Terminar estadía
                              </Button>
                            </div>
                          )}
                          {tuvoEstadia && (
                            <div className="border-b">
                              <MovimientosLista
                                listaId={list.id}
                                titulo={list.title}
                                centro={centroLista}
                                lugar={nombreDestino(null, list.lugar_id)}
                                bungalowDe={bungalowDeLista}
                              />
                            </div>
                          )}
                          <RecordsList
                            records={list.scanned_records || []}
                            emptyText="Esta lista no tiene registros"
                            padron={dnis}
                            bungalows={bungalowsDeLista}
                            onBungalowChange={etapa === "finalizada" ? undefined : cambiarBungalow}
                          />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

// ================== Letrero de veredicto ==================
// Lo primero que se mira tras cada lectura: se pinta entero según el resultado.
const VerdictBoard = ({
  read,
  loading,
  hasPadron,
  animate,
}: {
  read: LastRead | null;
  loading: boolean;
  hasPadron: boolean;
  animate: boolean;
}) => {
  if (loading) {
    return (
      <div className="flex min-h-[168px] flex-col justify-center rounded-xl border-2 border-dashed border-input px-5 py-5">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Buscando datos
        </p>
        <p className="dni mt-2 text-3xl font-semibold text-muted-foreground">{read?.dni}</p>
      </div>
    );
  }

  if (!read) {
    return (
      <div className="flex min-h-[168px] flex-col justify-center rounded-xl border-2 border-dashed border-input px-5 py-5">
        <p className="font-sign text-2xl font-bold text-muted-foreground">
          Esperando la primera lectura
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {hasPadron
            ? "Verás aquí si cada persona está en la lista de invitados."
            : "Verás aquí el nombre de cada persona que registres."}
        </p>
      </div>
    );
  }

  const tone = {
    ok: hasPadron
      ? { cls: "bg-success text-white", icon: CircleCheck, label: "En la lista" }
      : { cls: "bg-primary text-primary-foreground", icon: Check, label: "Registrado" },
    fuera: { cls: "bg-destructive text-white", icon: CircleX, label: "No está en la lista" },
    dup: { cls: "bg-warning text-foreground", icon: Users, label: "Ya estaba registrado" },
    error: {
      cls: "border-2 border-destructive bg-card text-destructive",
      icon: CircleX,
      label: read.dni ? "No se agregó" : "Código no reconocido",
    },
  }[read.estado];

  const nombre =
    read.estado === "error"
      ? read.dni
        ? "Sin datos en la base ni en el API"
        : "Vuelve a escanear el documento"
      : read.nombre || "Sin nombre";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "min-h-[168px] rounded-xl px-5 py-5",
        tone.cls,
        animate && "animate-stamp"
      )}
    >
      <p className="flex items-center gap-2 text-base font-semibold">
        <tone.icon className="h-6 w-6" strokeWidth={2.5} />
        {tone.label}
      </p>
      <p
        className={cn(
          "font-sign mt-3 break-words font-extrabold leading-[0.95]",
          read.estado === "error" ? "text-2xl" : "text-4xl sm:text-5xl"
        )}
      >
        {nombre}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="dni text-xl font-medium opacity-80">{read.dni || read.raw}</span>
        {read.fuente && read.estado !== "error" && (
          <span className="text-sm opacity-70">
            {read.fuente === "bd" ? "Desde la base" : "Desde el API"}
          </span>
        )}
      </div>
    </div>
  );
};

export default Eventos;
