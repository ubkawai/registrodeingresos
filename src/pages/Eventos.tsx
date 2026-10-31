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
import { RecordsList } from "@/components/RecordsList";
import { AdminUsers } from "@/components/AdminUsers";
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
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { useBarcodeScanner } from "@/hooks/use-barcode-scanner";
import { extractDniFromBarcode, lookupDni } from "@/lib/dni";
import { parsePadronFile, type Padron, type PersonaPadron } from "@/lib/padron";

type Fuente = "bd" | "api";

interface Record {
  id: string;
  dni_number: string;
  full_name: string;
  scanned_at: string;
  fuente?: Fuente;
}

type OpenList = { id: string; title: string };

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
});

const toPadron = (row: any): Padron | null =>
  Array.isArray(row?.padron)
    ? { personas: row.padron as PersonaPadron[], archivo: row.padron_archivo ?? "" }
    : null;

const padronDnis = (row: any): Set<string> | null => {
  const p = toPadron(row);
  return p ? new Set(p.personas.map((x) => x.dni)) : null;
};

const defaultTitle = () => `Ingreso ${format(new Date(), "dd/MM/yyyy HH:mm")}`;

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
  const [view, setView] = useState<"registro" | "listas" | "usuarios">("registro");
  const showSavedLists = view === "listas";
  const isAdmin = role === "admin";
  const [listSearch, setListSearch] = useState("");

  // Lista abierta en la BD: cada lectura se guarda en ella al instante y los
  // demás equipos con la misma cuenta la reciben por Realtime.
  const [openList, setOpenList] = useState<OpenList | null>(null);
  const openListRef = useRef<OpenList | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("connecting");

  // Lista de invitados de la lista abierta (Excel/CSV/PDF)
  const [padron, setPadron] = useState<Padron | null>(null);
  const padronRef = useRef<Map<string, string> | null>(null);
  const padronMap = useMemo(
    () => (padron ? new Map(padron.personas.map((p) => [p.dni, p.nombre])) : null),
    [padron]
  );
  padronRef.current = padronMap;
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
  };

  const resetOpenList = () => {
    applyOpenList(null);
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
    applyOpenList({ id: data.id, title: data.title });
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
      .insert({ title, user_id: userId! })
      .select()
      .single();

    if (error) {
      // 23505: otro equipo abrió una lista justo antes; se usa esa
      if (error.code === "23505") {
        const { data: existing } = await supabase
          .from("scan_lists")
          .select()
          .is("closed_at", null)
          .maybeSingle();
        if (existing) {
          const list = { id: existing.id, title: existing.title };
          applyOpenList(list);
          return list;
        }
      }
      throw error;
    }

    const list = { id: data.id, title: data.title };
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
              applyOpenList({ id: row.id, title: row.title });
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
      const fuera = !!padronRef.current && !padronRef.current.has(dni);
      setLastRead({ raw, dni, nombre, fuente, estado: fuera ? "fuera" : "ok" });
      setLastAddedId(row.id);
      addRecord(toRecord(row));
      bumpRead();

      if (fuera) toast.error(`No está en la lista: ${nombre}`);
      else toast.success(`Agregado: ${nombre}`);
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
    enabled: !!session && view === "registro" && !askPadron,
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
  const handleSaveList = async () => {
    if (!listTitle.trim()) {
      toast.error("Ingresa un título para la lista");
      return;
    }
    const list = openListRef.current;
    if (!list || currentRecords.length === 0) {
      toast.error("No hay registros para guardar");
      return;
    }

    setLoading(true);
    closingRef.current = true;
    try {
      const { error } = await supabase
        .from("scan_lists")
        .update({ title: listTitle.trim(), closed_at: new Date().toISOString() })
        .eq("id", list.id);

      if (error) throw error;

      toast.success("Lista guardada");
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
        toast.error(`No se encontraron DNI en "${file.name}"`);
        return;
      }
      await savePadron(parsed);
      // padronRef se actualiza en el próximo render; se fija ya para que la
      // lectura en espera se valide contra la lista recién subida
      padronRef.current = new Map(parsed.personas.map((p) => [p.dni, p.nombre]));
      const sinNombre = parsed.personas.filter((p) => !p.nombre).length;
      toast.success(
        `Lista cargada: ${parsed.personas.length} personas` +
          (sinNombre ? ` (${sinNombre} sin nombre)` : "")
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
    if (!padronSet) return null;
    const enLista = currentRecords.filter((r) => padronSet.has(r.dni_number)).length;
    return {
      enLista,
      fuera: currentRecords.length - enLista,
      faltan: padronSet.size - enLista,
      total: padronSet.size,
    };
  }, [currentRecords, padronSet]);

  const filteredLists = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    if (!q) return savedLists;
    return savedLists.filter(
      (l) =>
        l.title?.toLowerCase().includes(q) ||
        (l.scanned_records || []).some(
          (r: Record) =>
            r.dni_number.includes(q) || r.full_name.toLowerCase().includes(q)
        )
    );
  }, [savedLists, listSearch]);

  const scannerStatus = lookupLoading
    ? { text: "Consultando…", dot: "bg-warning", pulse: true }
    : titleFocused
    ? { text: "En pausa mientras editas el título", dot: "bg-muted-foreground/50", pulse: false }
    : { text: "Listo para escanear", dot: "bg-success", pulse: true };

  const tabs = [
    { key: "registro" as const, label: "Registro", icon: ScanBarcode },
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

      <main className="mx-auto max-w-6xl px-4 py-5 sm:py-8">
        {view === "usuarios" && isAdmin ? (
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
                  title="Cierra la lista y la pasa a Listas"
                  className="h-10 rounded-md px-4"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  Finalizar lista
                </Button>
              </div>
              <div className="max-h-[calc(100vh-12rem)] overflow-y-auto px-2 py-1 sm:px-3">
                <RecordsList
                  records={currentRecords}
                  newestFirst
                  highlightId={lastAddedId}
                  onRemove={handleRemoveRecord}
                  padron={padronSet}
                />
              </div>
            </section>
          </div>
        ) : (
          /* ================== Listas guardadas ================== */
          <div className="mx-auto max-w-3xl space-y-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="font-sign text-3xl font-bold">Listas finalizadas</h1>
                <p className="text-sm text-muted-foreground">
                  {savedLists.length === 0
                    ? "Aquí aparecen las listas al finalizarlas"
                    : `${savedLists.length} ${savedLists.length === 1 ? "lista" : "listas"}`}
                </p>
              </div>
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

            {filteredLists.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed py-16 text-center text-sm text-muted-foreground">
                {savedLists.length === 0
                  ? "Todavía no hay listas finalizadas. Usa “Finalizar lista” en Registro."
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
                  return (
                    <Collapsible key={list.id}>
                      <CollapsibleTrigger className="group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 sm:px-5">
                        <div className="min-w-0 flex-1">
                          <p className="font-sign truncate text-lg font-bold">{list.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(list.created_at), "d 'de' MMMM yyyy, HH:mm", {
                              locale: es,
                            })}
                          </p>
                        </div>
                        {dnis && (
                          <span
                            className="flex items-center gap-1 text-sm tabular-nums text-success"
                            title="Invitados que llegaron"
                          >
                            <CircleCheck className="h-4 w-4" />
                            {enLista}/{dnis.size}
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
                          <RecordsList
                            records={list.scanned_records || []}
                            emptyText="Esta lista no tiene registros"
                            padron={dnis}
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
