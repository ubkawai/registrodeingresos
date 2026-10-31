import { useState } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Tent, Loader2 } from "lucide-react";

// Las cuentas solo las crea el administrador desde la pantalla "Usuarios"
export const Auth = () => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const msg = /invalid login credentials/i.test(error.message)
        ? "Correo o contraseña incorrectos"
        : /banned/i.test(error.message)
        ? "Esta cuenta está desactivada. Consulta con el administrador."
        : error.message;
      toast.error(msg);
    } else {
      toast.success("Sesión iniciada exitosamente");
    }

    setLoading(false);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      {/* Letrero de entrada */}
      <div className="flex flex-col justify-between bg-primary px-6 py-6 text-primary-foreground lg:w-[44%] lg:px-12 lg:py-12">
        <Tent className="h-7 w-7" strokeWidth={2.25} />
        <div className="mt-8 lg:mt-0">
          <h1 className="font-sign text-5xl font-extrabold leading-[0.9] lg:text-7xl">
            Registro de Acampantes
          </h1>
          <p className="mt-4 max-w-xs text-base text-primary-foreground/75">
            Control de ingreso con lector de DNI y lista de invitados.
          </p>
        </div>
        <p className="hidden text-sm text-primary-foreground/60 lg:block">
          ¿No tienes cuenta? Pídela al administrador.
        </p>
      </div>

      <div className="flex flex-1 items-start justify-center px-6 py-8 lg:items-center lg:py-10">
        <form onSubmit={handleSignIn} className="w-full max-w-sm space-y-5">
          <div>
            <h2 className="font-sign text-3xl font-bold">Inicia sesión</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Usa la cuenta que te dio el administrador.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signin-email" className="text-sm font-medium">
              Correo electrónico
            </Label>
            <Input
              id="signin-email"
              type="email"
              autoComplete="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 rounded-md border-2 bg-card text-base focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signin-password" className="text-sm font-medium">
              Contraseña
            </Label>
            <Input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 rounded-md border-2 bg-card text-base focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0"
              required
            />
          </div>
          <Button type="submit" className="h-12 w-full rounded-md text-base" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Iniciar sesión
          </Button>
          <p className="text-center text-sm text-muted-foreground lg:hidden">
            ¿No tienes cuenta? Pídela al administrador.
          </p>
        </form>
      </div>
    </div>
  );
};
