import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Ban,
  CheckCircle2,
  FileUp,
  Loader2,
  MoreVertical,
  Pencil,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { lookupDni } from "@/lib/dni";
import { parsePadronFile, type PersonaPadron } from "@/lib/padron";
import { turnoHorario, type Trabajador, type Turno } from "@/lib/asistencia";

const SIN_TURNO = "sin-turno";
const MENSUAL = "horario-mensual";

// Valor del selector de turno -> columnas del trabajador
const turnoFila = (v: string) => ({
  turno_id: v === SIN_TURNO || v === MENSUAL ? null : v,
  horario_mensual: v === MENSUAL,
});

export const Trabajadores = ({ turnos }: { turnos: Turno[] }) => {
  const [lista, setLista] = useState<Trabajador[]>([]);
  const [loading, setLoading] = useState(true);
  const [buscar, setBuscar] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [editando, setEditando] = useState<Trabajador | "nuevo" | null>(null);
  const [importando, setImportando] = useState<PersonaPadron[] | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const turnoPorId = useMemo(() => new Map(turnos.map((t) => [t.id, t])), [turnos]);

  const load = async () => {
    const { data, error } = await supabase
      .from("trabajadores")
      .select("*")
      .order("nombre_completo", { ascending: true });
    setLoading(false);
    if (error) toast.error("No se pudieron cargar los trabajadores: " + error.message);
    else setLista(data ?? []);
  };

  useEffect(() => {
    load();
  }, []);

  const filtrados = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return lista.filter(
      (w) =>
        (verInactivos || w.activo) &&
        (!q ||
          w.dni.includes(q) ||
          w.nombre_completo.toLowerCase().includes(q) ||
          w.cargo?.toLowerCase().includes(q) ||
          w.area?.toLowerCase().includes(q))
    );
  }, [lista, buscar, verInactivos]);

  const toggleActivo = async (w: Trabajador) => {
    const { error } = await supabase
      .from("trabajadores")
      .update({ activo: !w.activo })
      .eq("dni", w.dni);
    if (error) toast.error(error.message);
    else {
      toast.success(w.activo ? `${w.nombre_completo} desactivado` : `${w.nombre_completo} activado`);
      load();
    }
  };

  const eliminar = async (w: Trabajador) => {
    if (!window.confirm(`¿Eliminar a ${w.nombre_completo}? Solo es posible si nunca marcó.`)) return;
    const { error } = await supabase.from("trabajadores").delete().eq("dni", w.dni);
    if (error) {
      toast.error(
        error.code === "23503"
          ? "Tiene marcas de asistencia (se conservan 5 años). Desactívalo en su lugar."
          : error.message
      );
      return;
    }
    toast.success("Trabajador eliminado");
    load();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLeyendo(true);
    try {
      const { personas } = await parsePadronFile(file);
      if (!personas.length) {
        toast.error(`No se encontraron DNI en "${file.name}"`);
        return;
      }
      setImportando(personas);
    } catch (err: any) {
      toast.error("No se pudo leer el archivo: " + (err?.message ?? ""));
    } finally {
      setLeyendo(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-sign text-3xl font-bold">Trabajadores</h1>
          <p className="text-sm text-muted-foreground">
            Solo los DNI registrados aquí pueden marcar asistencia
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv,.txt,.pdf"
            className="hidden"
            onChange={handleFile}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={leyendo}>
            {leyendo ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="mr-2 h-4 w-4" />
            )}
            Importar Excel
          </Button>
          <Button onClick={() => setEditando("nuevo")}>
            <UserPlus className="mr-2 h-4 w-4" />
            Agregar
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre, DNI, cargo o área"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={verInactivos}
            onChange={(e) => setVerInactivos(e.target.checked)}
          />
          Mostrar inactivos
        </label>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Cargando…
          </div>
        ) : filtrados.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {lista.length === 0
              ? "Aún no hay trabajadores. Agrégalos uno por uno o importa un Excel con DNI y nombre."
              : "Ningún trabajador coincide"}
          </p>
        ) : (
          <ul className="divide-y">
            {filtrados.map((w) => {
              const t = w.turno_id ? turnoPorId.get(w.turno_id) : undefined;
              return (
                <li key={w.dni} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate font-semibold",
                        !w.activo && "text-muted-foreground line-through"
                      )}
                    >
                      {w.nombre_completo}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span className="dni">{w.dni}</span>
                      {(w.cargo || w.area) && (
                        <span>· {[w.cargo, w.area].filter(Boolean).join(" · ")}</span>
                      )}
                    </p>
                  </div>
                  <div className="hidden text-right text-sm sm:block">
                    {w.horario_mensual ? (
                      <Badge variant="outline">Horario mensual</Badge>
                    ) : t ? (
                      <>
                        <p className="font-medium">{t.nombre}</p>
                        <p className="tabular-nums text-muted-foreground">{turnoHorario(t)}</p>
                      </>
                    ) : (
                      <Badge variant="outline" className="border-warning/40 text-warning">
                        Sin turno
                      </Badge>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Acciones para ${w.nombre_completo}`}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditando(w)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => toggleActivo(w)}>
                        {w.activo ? (
                          <Ban className="mr-2 h-4 w-4" />
                        ) : (
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                        )}
                        {w.activo ? "Desactivar (cese)" : "Activar"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onSelect={() => eliminar(w)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Eliminar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <TrabajadorDialog
        trabajador={editando}
        turnos={turnos}
        onClose={() => setEditando(null)}
        onSaved={() => {
          setEditando(null);
          load();
        }}
      />

      <ImportarDialog
        personas={importando}
        turnos={turnos}
        existentes={new Set(lista.map((w) => w.dni))}
        onClose={() => setImportando(null)}
        onDone={() => {
          setImportando(null);
          load();
        }}
      />
    </div>
  );
};

const TurnoSelect = ({
  turnos,
  value,
  onChange,
}: {
  turnos: Turno[];
  value: string;
  onChange: (v: string) => void;
}) => (
  <Select value={value} onValueChange={onChange}>
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value={SIN_TURNO}>Sin turno</SelectItem>
      <SelectItem value={MENSUAL}>Rotativo (horario mensual)</SelectItem>
      {turnos
        .filter((t) => t.activo || t.id === value)
        .map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.nombre} · {turnoHorario(t)}
          </SelectItem>
        ))}
    </SelectContent>
  </Select>
);

const TrabajadorDialog = ({
  trabajador,
  turnos,
  onClose,
  onSaved,
}: {
  trabajador: Trabajador | "nuevo" | null;
  turnos: Turno[];
  onClose: () => void;
  onSaved: () => void;
}) => {
  const nuevo = trabajador === "nuevo";
  const [dni, setDni] = useState("");
  const [nombre, setNombre] = useState("");
  const [cargo, setCargo] = useState("");
  const [area, setArea] = useState("");
  const [turnoId, setTurnoId] = useState(SIN_TURNO);
  const [buscando, setBuscando] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!trabajador) return;
    const w = trabajador === "nuevo" ? null : trabajador;
    setDni(w?.dni ?? "");
    setNombre(w?.nombre_completo ?? "");
    setCargo(w?.cargo ?? "");
    setArea(w?.area ?? "");
    setTurnoId(w?.horario_mensual ? MENSUAL : (w?.turno_id ?? SIN_TURNO));
  }, [trabajador]);

  const buscarNombre = async () => {
    if (!/^\d{8}$/.test(dni)) {
      toast.error("El DNI debe tener 8 dígitos");
      return;
    }
    setBuscando(true);
    const res = await lookupDni(dni);
    setBuscando(false);
    if (res.ok) setNombre(res.persona.nombre_completo);
    else toast.error("No se encontró el nombre; escríbelo a mano");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{8}$/.test(dni)) {
      toast.error("El DNI debe tener 8 dígitos");
      return;
    }
    setSaving(true);
    const fila = {
      nombre_completo: nombre.trim(),
      cargo: cargo.trim() || null,
      area: area.trim() || null,
      ...turnoFila(turnoId),
    };
    const { error } = nuevo
      ? await supabase.from("trabajadores").insert({ dni, ...fila })
      : await supabase.from("trabajadores").update(fila).eq("dni", dni);
    setSaving(false);
    if (error) {
      toast.error(error.code === "23505" ? "Ya existe un trabajador con ese DNI" : error.message);
      return;
    }
    toast.success(nuevo ? "Trabajador agregado" : "Cambios guardados");
    onSaved();
  };

  return (
    <Dialog open={!!trabajador} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{nuevo ? "Agregar trabajador" : "Editar trabajador"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="w-dni">DNI</Label>
            <div className="flex gap-2">
              <Input
                id="w-dni"
                value={dni}
                onChange={(e) => setDni(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                disabled={!nuevo}
                required
                autoFocus={nuevo}
                className="dni"
              />
              {nuevo && (
                <Button type="button" variant="outline" onClick={buscarNombre} disabled={buscando}>
                  {buscando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Buscar nombre
                </Button>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="w-nombre">Apellidos y nombres</Label>
            <Input id="w-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="w-cargo">Cargo</Label>
              <Input id="w-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ej. Vigilante" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="w-area">Área</Label>
              <Input id="w-area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ej. Seguridad" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Turno</Label>
            <TurnoSelect turnos={turnos} value={turnoId} onChange={setTurnoId} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const ImportarDialog = ({
  personas,
  turnos,
  existentes,
  onClose,
  onDone,
}: {
  personas: PersonaPadron[] | null;
  turnos: Turno[];
  existentes: Set<string>;
  onClose: () => void;
  onDone: () => void;
}) => {
  const [turnoId, setTurnoId] = useState(SIN_TURNO);
  const [saving, setSaving] = useState(false);

  const nuevos = (personas ?? []).filter((p) => !existentes.has(p.dni) && p.nombre);
  const sinNombre = (personas ?? []).filter((p) => !existentes.has(p.dni) && !p.nombre).length;
  const repetidos = (personas ?? []).filter((p) => existentes.has(p.dni)).length;

  const submit = async () => {
    setSaving(true);
    const { error } = await supabase.from("trabajadores").upsert(
      nuevos.map((p) => ({
        dni: p.dni,
        nombre_completo: p.nombre,
        ...turnoFila(turnoId),
      })),
      { onConflict: "dni", ignoreDuplicates: true }
    );
    setSaving(false);
    if (error) {
      toast.error("No se pudo importar: " + error.message);
      return;
    }
    toast.success(`${nuevos.length} trabajadores agregados`);
    onDone();
  };

  return (
    <Dialog open={!!personas} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Importar trabajadores</DialogTitle>
          <DialogDescription>
            Se agregarán {nuevos.length} trabajadores nuevos.
            {repetidos > 0 && ` ${repetidos} ya estaban registrados y no se modifican.`}
            {sinNombre > 0 && ` ${sinNombre} se omiten por no tener nombre.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Turno para todos (luego se puede cambiar a cada uno)</Label>
          <TurnoSelect turnos={turnos} value={turnoId} onChange={setTurnoId} />
        </div>
        <ul className="max-h-60 divide-y overflow-y-auto rounded-md border text-sm">
          {nuevos.slice(0, 200).map((p) => (
            <li key={p.dni} className="flex gap-3 px-3 py-1.5">
              <span className="dni text-muted-foreground">{p.dni}</span>
              <span className="truncate">{p.nombre}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={saving || nuevos.length === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Importar {nuevos.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
