import { useEffect, useState } from "react";
import { supabase } from "@/integrations/client";
import { Auth } from "@/components/Auth";
import Eventos from "@/pages/Eventos";
import Asistencia from "@/pages/Asistencia";
import { Clock, Loader2, LogOut, Tent } from "lucide-react";

// Después de iniciar sesión se elige el módulo según el rol:
//   usuario -> Eventos (ingreso de invitados y acampantes)
//   rrhh    -> Asistencia del personal
//   kiosko  -> Asistencia, solo la pantalla de marcado
//   admin   -> elige (se recuerda en este equipo)
type Modulo = "eventos" | "asistencia";

const MODULO_KEY = "modulo";

const leerModulo = (): Modulo | null => {
  try {
    const v = localStorage.getItem(MODULO_KEY);
    return v === "eventos" || v === "asistencia" ? v : null;
  } catch {
    return null;
  }
};

const guardarModulo = (m: Modulo | null) => {
  try {
    if (m) localStorage.setItem(MODULO_KEY, m);
    else localStorage.removeItem(MODULO_KEY);
  } catch {}
};

const Index = () => {
  const [session, setSession] = useState<any>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const userId: string | undefined = session?.user?.id;
  const [role, setRole] = useState<string | null>(null);
  const [modulo, setModulo] = useState<Modulo | null>(leerModulo);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setSessionLoaded(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) {
      setRole(null);
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

  const elegir = (m: Modulo | null) => {
    guardarModulo(m);
    setModulo(m);
  };

  if (!sessionLoaded) return <Cargando />;
  if (!session) return <Auth />;
  if (!role) return <Cargando />;

  if (role === "usuario") return <Eventos session={session} role={role} />;
  if (role === "rrhh" || role === "kiosko") return <Asistencia session={session} role={role} />;

  // Administrador
  if (modulo === "eventos") {
    return <Eventos session={session} role={role} onCambiarModulo={() => elegir("asistencia")} />;
  }
  if (modulo === "asistencia") {
    return <Asistencia session={session} role={role} onCambiarModulo={() => elegir("eventos")} />;
  }
  return <SelectorModulo email={session.user?.email ?? ""} onElegir={elegir} />;
};

const Cargando = () => (
  <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
    <Loader2 className="h-6 w-6 animate-spin" />
  </div>
);

const SelectorModulo = ({
  email,
  onElegir,
}: {
  email: string;
  onElegir: (m: Modulo) => void;
}) => {
  const opciones = [
    {
      key: "eventos" as const,
      icon: Tent,
      titulo: "Eventos",
      texto: "Ingreso de invitados y acampantes, con listas y padrón.",
    },
    {
      key: "asistencia" as const,
      icon: Clock,
      titulo: "Asistencia del personal",
      texto: "Entrada, refrigerio y salida de los trabajadores del centro.",
    },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10">
        <p className="text-sm text-muted-foreground">{email}</p>
        <h1 className="font-sign mt-1 text-4xl font-bold">¿Qué vas a registrar?</h1>
        <p className="mt-2 text-muted-foreground">
          Se recordará en este equipo. Puedes cambiarlo desde el menú de tu cuenta.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {opciones.map((o) => (
            <button
              key={o.key}
              onClick={() => onElegir(o.key)}
              className="group flex flex-col items-start rounded-xl border-2 bg-card p-6 text-left transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <o.icon className="h-6 w-6" />
              </span>
              <span className="font-sign mt-4 text-2xl font-bold">{o.titulo}</span>
              <span className="mt-1 text-sm text-muted-foreground">{o.texto}</span>
            </button>
          ))}
        </div>

        <button
          onClick={() => supabase.auth.signOut()}
          className="mt-8 flex items-center gap-2 self-start text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
};

export default Index;
