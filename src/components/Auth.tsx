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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-foreground text-background">
            <Tent className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Registro de Acampantes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inicia sesión para continuar
          </p>
        </div>

        <form onSubmit={handleSignIn} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="signin-email" className="text-xs text-muted-foreground">
              Correo electrónico
            </Label>
            <Input
              id="signin-email"
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 rounded-xl"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signin-password" className="text-xs text-muted-foreground">
              Contraseña
            </Label>
            <Input
              id="signin-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-xl"
              required
            />
          </div>
          <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Iniciar sesión
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          ¿No tienes cuenta? Pídela al administrador.
        </p>
      </div>
    </div>
  );
};
