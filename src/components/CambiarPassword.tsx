import { useState } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, Loader2, LogOut } from "lucide-react";

const MIN = 8;

// Se muestra la primera vez que alguien entra con la contraseña que le dio el
// administrador (o después de que el administrador se la restablezca).
// No deja usar la app hasta que la cambie.
export const CambiarPassword = ({
  email,
  onListo,
}: {
  email: string;
  onListo: () => void;
}) => {
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN) {
      toast.error(`La contraseña debe tener al menos ${MIN} caracteres`);
      return;
    }
    if (password !== confirmar) {
      toast.error("Las contraseñas no coinciden");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      const msg = /different from the old/i.test(error.message)
        ? "La nueva contraseña debe ser distinta a la que te dieron"
        : /weak|least/i.test(error.message)
        ? "La contraseña es muy débil. Usa una más larga o con números y símbolos."
        : error.message;
      toast.error(msg);
      setLoading(false);
      return;
    }

    const { error: rpcError } = await supabase.rpc("confirmar_cambio_password");
    setLoading(false);
    if (rpcError) {
      console.error(rpcError);
      toast.error("La contraseña se cambió, pero no se pudo confirmar. Intenta de nuevo.");
      return;
    }
    toast.success("Contraseña actualizada");
    onListo();
  };

  const inputClass =
    "h-12 rounded-md border-2 bg-card text-base focus-visible:border-primary focus-visible:ring-0 focus-visible:ring-offset-0";

  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-4 py-10 sm:items-center">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5">
        <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <KeyRound className="h-6 w-6" />
        </span>
        <div>
          <h1 className="font-sign text-3xl font-bold">Cambia tu contraseña</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Por seguridad, elige una contraseña nueva que solo tú conozcas antes de continuar.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{email}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="nueva-password">Nueva contraseña</Label>
          <Input
            id="nueva-password"
            type="password"
            autoComplete="new-password"
            placeholder={`Mínimo ${MIN} caracteres`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={MIN}
            className={inputClass}
            required
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmar-password">Repite la contraseña</Label>
          <Input
            id="confirmar-password"
            type="password"
            autoComplete="new-password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            minLength={MIN}
            className={inputClass}
            required
          />
        </div>

        <Button type="submit" className="h-12 w-full rounded-md text-base" disabled={loading}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar y continuar
        </Button>

        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </button>
      </form>
    </div>
  );
};
