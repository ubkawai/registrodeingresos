import { useEffect, useState } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  UserPlus,
  Loader2,
  MoreVertical,
  KeyRound,
  ShieldCheck,
  User,
  Ban,
  CheckCircle2,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

type Role = "admin" | "usuario";

interface AppUser {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  last_sign_in_at: string | null;
  active: boolean;
}

// Toda la gestión de cuentas pasa por la Edge Function admin-users
const callAdmin = async (body: { action: string; [k: string]: unknown }) => {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    // Respuestas 401/403 traen el motivo en el cuerpo
    let msg = error.message;
    try {
      const ctx = await (error as any).context?.json?.();
      if (ctx?.error) msg = ctx.error;
    } catch {}
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
};

export const AdminUsers = ({ currentUserId }: { currentUserId: string }) => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("usuario");
  const [creating, setCreating] = useState(false);

  const [pwdUser, setPwdUser] = useState<AppUser | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [deleteUser, setDeleteUser] = useState<AppUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoadingList(true);
    try {
      const data = await callAdmin({ action: "list" });
      setUsers(data.users ?? []);
    } catch (e: any) {
      toast.error("No se pudieron cargar las cuentas: " + e.message);
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const run = async (id: string, body: any, okMsg: string) => {
    setBusyId(id);
    try {
      await callAdmin(body);
      toast.success(okMsg);
      await loadUsers();
      return true;
    } catch (e: any) {
      toast.error(e.message);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await callAdmin({ action: "create", email, password, role });
      toast.success(`Cuenta creada: ${email}`);
      setEmail("");
      setPassword("");
      setRole("usuario");
      await loadUsers();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pwdUser) return;
    const ok = await run(
      pwdUser.id,
      { action: "set_password", id: pwdUser.id, password: newPwd },
      `Contraseña actualizada para ${pwdUser.email}`
    );
    if (ok) {
      setPwdUser(null);
      setNewPwd("");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usuarios</h1>
        <p className="text-sm text-muted-foreground">Solo el administrador puede crear cuentas</p>
      </div>

      {/* ================== Crear cuenta ================== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-5 w-5" />
            Crear cuenta
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-email">Correo electrónico</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="persona@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">Contraseña</Label>
              <Input
                id="new-password"
                type="text"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label>Rol</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="usuario">Usuario: registra y ve sus listas</SelectItem>
                  <SelectItem value="admin">Administrador: además gestiona cuentas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="mr-2 h-4 w-4" />
                )}
                Crear cuenta
              </Button>
            </div>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Entrega el correo y la contraseña a la persona. Puede ingresar de
            inmediato, sin confirmar su correo.
          </p>
        </CardContent>
      </Card>

      {/* ================== Lista de cuentas ================== */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b pb-4">
          <CardTitle className="text-base">
            Cuentas{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({users.length})
            </span>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={loadUsers} disabled={loadingList}>
            <RefreshCw className={cn("h-4 w-4", loadingList && "animate-spin")} />
          </Button>
        </CardHeader>
        <CardContent className="pt-2">
          {loadingList && users.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Cargando cuentas…
            </div>
          ) : (
            <ul className="divide-y">
              {users.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <li key={u.id} className="flex items-center gap-3 px-1 py-3">
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                        u.role === "admin"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground"
                      )}
                    >
                      {u.role === "admin" ? (
                        <ShieldCheck className="h-4 w-4" />
                      ) : (
                        <User className="h-4 w-4" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate font-semibold leading-tight",
                          !u.active && "text-muted-foreground line-through"
                        )}
                      >
                        {u.email}
                        {isSelf && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (tú)
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <Badge
                          variant="outline"
                          className={cn(
                            "px-1.5 py-0 text-[11px]",
                            u.role === "admin" && "border-primary/30 bg-primary/10 text-primary"
                          )}
                        >
                          {u.role === "admin" ? "Administrador" : "Usuario"}
                        </Badge>
                        {!u.active && (
                          <Badge
                            variant="outline"
                            className="border-destructive/30 bg-destructive/10 px-1.5 py-0 text-[11px] text-destructive"
                          >
                            Desactivada
                          </Badge>
                        )}
                        <span>
                          {u.last_sign_in_at
                            ? `Último ingreso ${format(new Date(u.last_sign_in_at), "d MMM yyyy, HH:mm", { locale: es })}`
                            : "Nunca ingresó"}
                        </span>
                      </p>
                    </div>

                    {busyId === u.id ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Acciones para ${u.email}`}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setPwdUser(u)}>
                            <KeyRound className="mr-2 h-4 w-4" />
                            Cambiar contraseña
                          </DropdownMenuItem>
                          {!isSelf && (
                            <>
                              <DropdownMenuItem
                                onSelect={() =>
                                  run(
                                    u.id,
                                    {
                                      action: "set_role",
                                      id: u.id,
                                      role: u.role === "admin" ? "usuario" : "admin",
                                    },
                                    u.role === "admin"
                                      ? `${u.email} ahora es usuario`
                                      : `${u.email} ahora es administrador`
                                  )
                                }
                              >
                                {u.role === "admin" ? (
                                  <User className="mr-2 h-4 w-4" />
                                ) : (
                                  <ShieldCheck className="mr-2 h-4 w-4" />
                                )}
                                {u.role === "admin" ? "Quitar administrador" : "Hacer administrador"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  run(
                                    u.id,
                                    { action: "set_active", id: u.id, active: !u.active },
                                    u.active ? `Cuenta desactivada: ${u.email}` : `Cuenta activada: ${u.email}`
                                  )
                                }
                              >
                                {u.active ? (
                                  <Ban className="mr-2 h-4 w-4" />
                                ) : (
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                {u.active ? "Desactivar" : "Activar"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => setDeleteUser(u)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Eliminar
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ================== Cambiar contraseña ================== */}
      <Dialog
        open={!!pwdUser}
        onOpenChange={(o) => {
          if (!o) {
            setPwdUser(null);
            setNewPwd("");
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleSetPassword} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Cambiar contraseña</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{pwdUser?.email}</p>
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">Nueva contraseña</Label>
              <Input
                id="reset-password"
                type="text"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                minLength={6}
                autoComplete="new-password"
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busyId === pwdUser?.id}>
                {busyId === pwdUser?.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================== Eliminar ================== */}
      <AlertDialog open={!!deleteUser} onOpenChange={(o) => !o && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar la cuenta?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará {deleteUser?.email}. Si la cuenta ya tiene listas
              guardadas no se podrá eliminar; en ese caso desactívala.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const u = deleteUser!;
                setDeleteUser(null);
                run(u.id, { action: "delete", id: u.id }, `Cuenta eliminada: ${u.email}`);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
