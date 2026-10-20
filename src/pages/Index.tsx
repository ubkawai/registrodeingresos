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
import { RecordsList } from "@/components/RecordsList";
import { Auth } from "@/components/Auth";
import { AdminUsers } from "@/components/AdminUsers";
import { toast } from "sonner";
import {
  ScanBarcode,
  Check,
  ArrowRight,
  LogOut,
  Tent,
  ClipboardList,
  Database,
  Globe,
  Search,
  Users,
  ChevronDown,
  Loader2,
  ShieldCheck,
  CircleCheck,
  CircleX,
  FileUp,
  Trash2,
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

type LastRead = {
  raw: string;
  dni: string;
  nombre: string;
  fuente: Fuente | null;
};

type Flash = "ok" | "fuera" | "dup" | "error" | null;

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

const Index = () => {
  const [session, setSession] = useState<any>(null);
  const userId: string | undefined = session?.user?.id;
  const [currentRecords, setCurrentRecords] = useState<Record[]>([]);
  const [listTitle, setListTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedLists, setSavedLists] = useState<any[]>([]);
  const [view, setView] = useState<"registro" | "listas" | "usuarios">("registro");
  const showSavedLists = view === "listas";
  const [role, setRole] = useState<string | null>(null);
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

  // Destello del panel del lector según el resultado
  const [flash, setFlash] = useState<Flash>(null);
  const flashTimerRef = useRef<number | null>(null);

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
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => setSession(session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadSavedLists();
  }, [showSavedLists, session]);

  // Rol de la cuenta: 'admin' ve además la pantalla "Usuarios"
  useEffect(() => {
    if (!userId) {
      setRole(null);
      setView("registro");
      return;
    }
    supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error(error);
        setRole(data?.role ?? "usuario");
      });
  }, [userId]);

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
            });
            setLastAddedId(rec.id);
            showFlash(
              padronRef.current && !padronRef.current.has(rec.dni_number) ? "fuera" : "ok"
            );
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

  const showFlash = (f: Flash) => {
    setFlash(f);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 900);
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
      setLastRead({ raw, dni: "", nombre: "", fuente: null });
      showFlash("error");
      toast.error(`Código no reconocido: ${raw}`);
      return;
    }

    if (seenDnisRef.current.has(dni)) {
      showFlash("dup");
      toast.warning(`DNI ya registrado en esta lista: ${dni}`);
      return;
    }

    // “reserva” el dni para evitar duplicado mientras consulta
    seenDnisRef.current.add(dni);
    pendingDnisRef.current.add(dni);
    setLookupLoading(true);
    setLastRead({ raw, dni, nombre: "", fuente: null });

    try {
      const result = await lookupDni(dni);

      if ("error" in result) {
        // permite reintentar
        seenDnisRef.current.delete(dni);
        setLastRead({ raw, dni, nombre: "No disponible", fuente: null });
        showFlash("error");
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
          showFlash("dup");
          toast.warning(`DNI ya registrado en esta lista: ${dni}`);
          return;
        }
        throw error;
      }

      await playBeep();
      setLastRead({ raw, dni, nombre, fuente });
      setLastAddedId(row.id);
      addRecord(toRecord(row));

      if (padronRef.current && !padronRef.current.has(dni)) {
        showFlash("fuera");
        toast.error(`No está en la lista: ${nombre}`);
      } else {
        showFlash("ok");
        toast.success(`Agregado: ${nombre}`);
      }
    } catch (e: any) {
      console.error(e);
      seenDnisRef.current.delete(dni);
      showFlash("error");
      toast.error("No se pudo registrar el DNI: " + (e?.message ?? ""));
    } finally {
      pendingDnisRef.current.delete(dni);
      setLookupLoading(false);
    }
  };

  const enqueueCode = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    queueRef.current = queueRef.current.then(() => processCode(code));
  };

  // Lector alámbrico o inalámbrico (ambos funcionan como teclado)
  useBarcodeScanner(enqueueCode, {
    enabled: !!session && view === "registro",
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
      const sinNombre = parsed.personas.filter((p) => !p.nombre).length;
      toast.success(
        `Lista cargada: ${parsed.personas.length} personas` +
          (sinNombre ? ` (${sinNombre} sin nombre)` : "")
      );
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

  if (!session) return <Auth />;

  const scannerStatus = lookupLoading
    ? { text: "Consultando…", dot: "bg-warning", pulse: true }
    : titleFocused
    ? { text: "En pausa", dot: "bg-muted-foreground/50", pulse: false }
    : { text: "Listo para escanear", dot: "bg-success", pulse: true };

  const tabs = [
    { key: "registro" as const, label: "Registro", icon: ScanBarcode },
    { key: "listas" as const, label: "Listas", icon: ClipboardList, count: savedLists.length },
    ...(isAdmin ? [{ key: "usuarios" as const, label: "Usuarios", icon: ShieldCheck }] : []),
  ];

  const email: string = session.user?.email ?? "";

  return (
    <div className="min-h-screen bg-background">
      {/* ================== Barra superior ================== */}
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-foreground text-background">
              <Tent className="h-4 w-4" />
            </div>
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">
              Acampantes
            </span>
          </div>

          <nav className="mx-auto flex items-center gap-1 text-sm">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors",
                  view === t.key
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <t.icon className="h-4 w-4" />
                <span className="hidden sm:inline">{t.label}</span>
                {t.count !== undefined && t.count > 0 && (
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      view === t.key ? "text-background/60" : "text-muted-foreground/70"
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase transition hover:ring-2 hover:ring-border"
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
              <DropdownMenuItem onSelect={handleSignOut}>
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-10">
        {view === "usuarios" && isAdmin ? (
          <AdminUsers currentUserId={userId!} />
        ) : view === "registro" ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-8">
            {/* ================== Columna lector ================== */}
            <div className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
              <section
                className={cn(
                  "rounded-2xl border bg-card p-5 ring-2 ring-transparent transition-all duration-300 sm:p-6",
                  flash === "ok" && "border-success/40 ring-success/20",
                  flash === "dup" && "border-warning/40 ring-warning/20",
                  (flash === "error" || flash === "fuera") &&
                    "border-destructive/40 ring-destructive/20"
                )}
              >
                <div className="mb-4 flex items-center gap-2 text-xs font-medium text-muted-foreground">
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
                  <ScanBarcode className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="scan"
                    ref={scanInputRef}
                    placeholder="Escanea o escribe el DNI"
                    value={scanValue}
                    onChange={(e) => setScanValue(e.target.value)}
                    autoComplete="off"
                    inputMode="numeric"
                    className="h-14 rounded-xl border-0 bg-muted pl-12 pr-14 font-mono text-base tracking-wider focus-visible:ring-2 focus-visible:ring-foreground/10 focus-visible:ring-offset-0 sm:text-lg"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    className="absolute right-2 top-1/2 h-10 w-10 -translate-y-1/2 rounded-lg"
                    disabled={!scanValue.trim()}
                    aria-label="Buscar"
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </form>

                {/* Última lectura */}
                <div className="mt-6 min-h-[112px] border-t pt-5">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Última lectura
                  </p>
                  {lookupLoading ? (
                    <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Consultando {lastRead?.dni}…
                    </div>
                  ) : lastRead ? (
                    <div>
                      <p
                        className={cn(
                          "text-2xl font-semibold leading-tight tracking-tight",
                          !lastRead.fuente && "text-destructive"
                        )}
                      >
                        {lastRead.nombre || "Código no reconocido"}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-lg tracking-wider text-muted-foreground">
                          {lastRead.dni || lastRead.raw}
                        </span>
                        {lastRead.fuente && <SourceTag fuente={lastRead.fuente} />}
                      </div>
                      {padronMap && lastRead.fuente && (
                        padronMap.has(lastRead.dni) ? (
                          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-sm font-medium text-success">
                            <CircleCheck className="h-4 w-4" />
                            En la lista
                          </p>
                        ) : (
                          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-3 py-1 text-sm font-medium text-destructive">
                            <CircleX className="h-4 w-4" />
                            No está en la lista
                          </p>
                        )
                      )}
                    </div>
                  ) : (
                    <p className="py-3 text-sm text-muted-foreground">
                      Esperando la primera lectura
                    </p>
                  )}
                </div>
              </section>

              {/* Contadores */}
              <div className="grid grid-cols-3 divide-x rounded-2xl border bg-card">
                {[
                  { label: "Registrados", value: stats.total, icon: Users, cls: "bg-success/10 text-success" },
                  { label: "Base", value: stats.bd, icon: Database, cls: "bg-muted text-foreground/70" },
                  { label: "API", value: stats.api, icon: Globe, cls: "bg-accent/10 text-accent" },
                ].map((s) => (
                  <div key={s.label} className="px-4 py-3.5">
                    <div className={cn("mb-2 flex h-7 w-7 items-center justify-center rounded-lg", s.cls)}>
                      <s.icon className="h-3.5 w-3.5" />
                    </div>
                    <p className="text-2xl font-semibold tabular-nums tracking-tight">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Lista de invitados */}
              <section className="rounded-2xl border bg-card p-4">
                <input
                  ref={padronInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt,.pdf"
                  className="hidden"
                  onChange={handlePadronFile}
                />
                {padron && padronStats ? (
                  <>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Lista de invitados
                        </p>
                        <p className="truncate text-sm font-medium" title={padron.archivo}>
                          {padron.archivo || "Lista cargada"}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => padronInputRef.current?.click()}
                        disabled={padronLoading}
                        title="Reemplazar lista"
                        aria-label="Reemplazar lista"
                      >
                        {padronLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileUp className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={handleRemovePadron}
                        disabled={padronLoading}
                        title="Quitar lista"
                        aria-label="Quitar lista"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-success/10 px-2 py-2 text-success">
                        <p className="text-xl font-semibold tabular-nums">
                          {padronStats.enLista}
                          <span className="text-sm font-normal opacity-70">/{padronStats.total}</span>
                        </p>
                        <p className="text-xs">En lista</p>
                      </div>
                      <div className="rounded-xl bg-destructive/10 px-2 py-2 text-destructive">
                        <p className="text-xl font-semibold tabular-nums">{padronStats.fuera}</p>
                        <p className="text-xs">Fuera de lista</p>
                      </div>
                      <div className="rounded-xl bg-muted px-2 py-2">
                        <p className="text-xl font-semibold tabular-nums">{padronStats.faltan}</p>
                        <p className="text-xs text-muted-foreground">Faltan</p>
                      </div>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => padronInputRef.current?.click()}
                    disabled={padronLoading}
                    className="flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
                  >
                    {padronLoading ? (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
                    ) : (
                      <FileUp className="h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                    <span>
                      <span className="block text-sm font-medium">Cargar lista de invitados</span>
                      <span className="block text-xs text-muted-foreground">
                        Excel, CSV o PDF con los DNI · cada lectura se valida contra ella
                      </span>
                    </span>
                  </button>
                )}
              </section>

              <p className="px-1 text-xs leading-relaxed text-muted-foreground">
                Funciona con lector alámbrico o inalámbrico. Cada lectura se
                guarda al instante y se ve en vivo en tus otros equipos.
              </p>
            </div>

            {/* ================== Columna lista actual ================== */}
            <section className="min-w-0 rounded-2xl border bg-card">
              <div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:p-6">
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
                    className="w-full rounded-md bg-transparent text-lg font-semibold tracking-tight outline-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
                    title="Título de la lista (clic para editar)"
                  />
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {currentRecords.length}{" "}
                      {currentRecords.length === 1 ? "persona" : "personas"}
                    </span>
                    <span aria-hidden>·</span>
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
                          "h-1.5 w-1.5 rounded-full",
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
                  className="rounded-full px-5"
                >
                  {loading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  Finalizar lista
                </Button>
              </div>
              <div className="max-h-[calc(100vh-14rem)] overflow-y-auto px-3 py-2 sm:px-4">
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
          <div className="mx-auto max-w-3xl space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">Listas</h1>
                <p className="text-sm text-muted-foreground">
                  {savedLists.length} {savedLists.length === 1 ? "lista finalizada" : "listas finalizadas"}
                </p>
              </div>
              <div className="relative sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Buscar título, nombre o DNI"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  className="rounded-full border-0 bg-muted pl-9 focus-visible:ring-2 focus-visible:ring-foreground/10 focus-visible:ring-offset-0"
                />
              </div>
            </div>

            {filteredLists.length === 0 ? (
              <div className="rounded-2xl border border-dashed py-16 text-center text-sm text-muted-foreground">
                {savedLists.length === 0
                  ? "Aún no hay listas finalizadas"
                  : "Ninguna lista coincide con la búsqueda"}
              </div>
            ) : (
              <div className="divide-y overflow-hidden rounded-2xl border bg-card">
                {filteredLists.map((list) => {
                  const count = list.scanned_records?.length ?? 0;
                  const dnis = padronDnis(list);
                  const enLista = dnis
                    ? (list.scanned_records || []).filter((r: Record) => dnis.has(r.dni_number)).length
                    : 0;
                  return (
                    <Collapsible key={list.id}>
                      <CollapsibleTrigger className="group flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-muted/50">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{list.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(list.created_at), "d 'de' MMMM yyyy, HH:mm", {
                              locale: es,
                            })}
                          </p>
                        </div>
                        {dnis && (
                          <span
                            className="flex items-center gap-1 text-xs tabular-nums text-success"
                            title="Presentes de la lista de invitados"
                          >
                            <CircleCheck className="h-3.5 w-3.5" />
                            {enLista}/{dnis.size}
                          </span>
                        )}
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {count}
                        </span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="border-t bg-muted/30 px-3 py-1 sm:px-4">
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

const SourceTag = ({ fuente }: { fuente: Fuente }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
      fuente === "bd" ? "bg-muted text-foreground/70" : "bg-accent/10 text-accent"
    )}
  >
    {fuente === "bd" ? <Database className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
    {fuente === "bd" ? "Base" : "API"}
  </span>
);

export default Index;
