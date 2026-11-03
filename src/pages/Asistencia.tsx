import { useEffect, useState } from "react";
import { supabase } from "@/integrations/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AdminUsers } from "@/components/AdminUsers";
import { Marcador } from "@/components/asistencia/Marcador";
import { HoyEnVivo } from "@/components/asistencia/HoyEnVivo";
import { Reportes } from "@/components/asistencia/Reportes";
import { Trabajadores } from "@/components/asistencia/Trabajadores";
import { Configuracion } from "@/components/asistencia/Configuracion";
import { Horarios } from "@/components/asistencia/Horarios";
import { toast } from "sonner";
import {
  Clock,
  ScanBarcode,
  Activity,
  FileSpreadsheet,
  Users,
  Settings,
  ShieldCheck,
  CalendarDays,
  LogOut,
  Tent,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ROL_LABEL, type Empleador, type Turno } from "@/lib/asistencia";

type Vista =
  | "marcar"
  | "hoy"
  | "reportes"
  | "trabajadores"
  | "horarios"
  | "configuracion"
  | "usuarios";

type AsistenciaProps = {
  session: any;
  role: string;
  onCambiarModulo?: () => void;
};

const Asistencia = ({ session, role, onCambiarModulo }: AsistenciaProps) => {
  const userId: string = session.user.id;
  const email: string = session.user?.email ?? "";
  const isAdmin = role === "admin";
  const esKiosko = role === "kiosko";

  const [view, setView] = useState<Vista>(esKiosko ? "marcar" : "hoy");
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [empleador, setEmpleador] = useState<Empleador | null>(null);

  const loadTurnos = async () => {
    const { data, error } = await supabase
      .from("turnos")
      .select("*")
      .order("hora_inicio", { ascending: true });
    if (error) toast.error("No se pudieron cargar los turnos: " + error.message);
    else setTurnos(data ?? []);
  };

  const loadEmpleador = async () => {
    const { data, error } = await supabase.from("empleador").select("*").maybeSingle();
    if (error) console.error(error);
    setEmpleador(data ?? null);
  };

  useEffect(() => {
    if (esKiosko) return;
    loadTurnos();
    loadEmpleador();
  }, [esKiosko]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Sesión cerrada");
  };

  const tabs = esKiosko
    ? []
    : [
        { key: "hoy" as const, label: "Hoy", icon: Activity },
        { key: "marcar" as const, label: "Marcar", icon: ScanBarcode },
        { key: "reportes" as const, label: "Reportes", icon: FileSpreadsheet },
        { key: "trabajadores" as const, label: "Trabajadores", icon: Users },
        { key: "horarios" as const, label: "Horario mensual", icon: CalendarDays },
        { key: "configuracion" as const, label: "Turnos", icon: Settings },
        ...(isAdmin ? [{ key: "usuarios" as const, label: "Usuarios", icon: ShieldCheck }] : []),
      ];

  const faltaEmpleador = !esKiosko && empleador && (!empleador.razon_social || !empleador.ruc);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-primary text-primary-foreground print:hidden">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5" strokeWidth={2.25} />
            <span className="font-sign hidden text-lg font-bold sm:inline">Asistencia</span>
          </div>

          <nav className="mx-auto flex h-full items-stretch gap-0.5 overflow-x-auto text-sm sm:gap-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                aria-current={view === t.key ? "page" : undefined}
                title={t.label}
                className={cn(
                  "relative flex shrink-0 items-center gap-1.5 px-2.5 font-medium transition-colors",
                  "after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:rounded-t-full after:transition-colors",
                  view === t.key
                    ? "text-primary-foreground after:bg-primary-foreground"
                    : "text-primary-foreground/60 after:bg-transparent hover:text-primary-foreground"
                )}
              >
                <t.icon className="h-4 w-4" />
                <span className="hidden md:inline">{t.label}</span>
              </button>
            ))}
          </nav>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15 text-sm font-semibold uppercase transition hover:bg-primary-foreground/25"
                aria-label="Cuenta"
              >
                {email.charAt(0) || "?"}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm font-medium">{email}</p>
                <p className="text-xs text-muted-foreground">{ROL_LABEL[role] ?? role}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {onCambiarModulo && (
                <DropdownMenuItem onSelect={onCambiarModulo}>
                  <Tent className="mr-2 h-4 w-4" />
                  Ir a Eventos
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

      {faltaEmpleador && view !== "configuracion" && (
        <div className="border-b border-warning/40 bg-warning/15 print:hidden">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
            <span>
              Falta la razón social o el RUC del empleador; la norma exige que figuren en el registro.
            </span>
            <button
              className="font-semibold underline underline-offset-2"
              onClick={() => setView("configuracion")}
            >
              Completar
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-5 sm:py-8">
        {view === "marcar" ? (
          <Marcador />
        ) : view === "hoy" ? (
          <HoyEnVivo turnos={turnos} />
        ) : view === "reportes" ? (
          <Reportes empleador={empleador} />
        ) : view === "trabajadores" ? (
          <Trabajadores turnos={turnos} />
        ) : view === "horarios" ? (
          <Horarios turnos={turnos} empleador={empleador} />
        ) : view === "configuracion" ? (
          <Configuracion
            turnos={turnos}
            empleador={empleador}
            onTurnosChange={loadTurnos}
            onEmpleadorChange={loadEmpleador}
          />
        ) : view === "usuarios" && isAdmin ? (
          <AdminUsers currentUserId={userId} />
        ) : null}
      </main>
    </div>
  );
};

export default Asistencia;
