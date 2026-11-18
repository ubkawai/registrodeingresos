import { useEffect, useState } from "react";
import { supabase } from "@/integrations/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  UserCog,
  Ban,
  CheckCircle2,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

type Role = "admin" | "usuario" | "rrhh" | "kiosko";

const ROLES: { value: Role; label: string; desc: string }[] = [
  { value: "usuario", label: "Eventos", desc: "Ingreso de acampantes, puerta y listas" },
  { value: "kiosko", label: "Kiosko de asistencia", desc: "Marca la asistencia de los trabajadores" },
  { value: "rrhh", label: "RR.HH.", desc: "Asistencia: trabajadores, reportes y correcciones" },
  { value: "admin", label: "Administrador", desc: "Todo, además gestiona cuentas" },
];

// Ordena los roles como en ROLES
const ordenar = (roles: Role[]) => ROLES.map((r) => r.value).filter((v) => roles.includes(v));

// Casillas para elegir uno o varios roles
const RolesPicker = ({
  value,
  onChange,
  idPrefix,
}: {
  value: Role[];
  onChange: (roles: Role[]) => void;
  idPrefix: string;
}) => (
  <div className="grid gap-2">
    {ROLES.map((r) => {
      const id = `${idPrefix}-${r.value}`;
      const marcado = value.includes(r.value);
      return (
        <label
          key={r.value}
          htmlFor={id}
          className={cn(
            "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
            marcado ? "border-primary bg-primary/5" : "hover:bg-muted/50"
          )}
        >
          <Checkbox
            id={id}
            checked={marcado}
            onCheckedChange={(v) =>
              onChange(v ? ordenar([...value, r.value]) : value.filter((x) => x !== r.value))
            }
            className="mt-0.5"
          />
          <span>
            <span className="block text-sm font-medium">{r.label}</span>
            <span className="block text-xs text-muted-foreground">{r.desc}</span>
          </span>
        </label>
      );
    })}
  </div>
);

const roleLabel = (r: Role) => ROLES.find((x) => x.value === r)?.label ?? r;

interface AppUser {
  id: string;
  email: string;
  role: Role;
  roles: Role[];
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
  const [roles, setRoles] = useState<Role[]>(["usuario"]);
  const [rolesUser, setRolesUser] = useState<AppUser | null>(null);
  const [rolesEdit, setRolesEdit] = useState<Role[]>([]);
  const [creating, setCreating] = useState(false);

  const [pwdUser, setPwdUser] = useState<AppUser | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [deleteUser, setDeleteUser] = useState<AppUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoadingList(true);
    try {
      const data = await callAdmin({ action: "list" });
      // Los roles se leen de profiles (la Edge Function solo trae el principal)
      const { data: perfiles } = await supabase.from("profiles").select("id, roles");
      const rolesDe = new Map((perfiles ?? []).map((p) => [p.id, p.roles as Role[]]));
      setUsers(
        (data.users ?? []).map((u: AppUser) => ({
          ...u,
          roles: rolesDe.get(u.id)?.length ? ordenar(rolesDe.get(u.id)!) : [u.role],
        }))
      );
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
    if (roles.length === 0) {
      toast.error("Elige al menos un rol");
      return;
    }
    setCreating(true);
    try {
      await callAdmin({ action: "create", email, password, role: roles[0] });
      if (roles.length > 1) {
        const { error } = await supabase
          .from("profiles")
          .update({ roles })
          .eq("email", email.trim().toLowerCase());
        if (error) toast.error("La cuenta se creó, pero no se guardaron todos los roles: " + error.message);
      }
      toast.success(`Cuenta creada: ${email}`);
      setEmail("");
      setPassword("");
      setRoles(["usuario"]);
      await loadUsers();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreating(false);
    }
  };

  const guardarRoles = async () => {
    const u = rolesUser;
    if (!u) return;
    if (rolesEdit.length === 0) {
      toast.error("Elige al menos un rol");
      return;
    }
    setBusyId(u.id);
    const { error } = await supabase.from("profiles").update({ roles: rolesEdit }).eq("id", u.id);
    setBusyId(null);
    if (error) {
      toast.error("No se pudieron guardar los roles: " + error.message);
      return;
    }
    toast.success(`Roles de ${u.email}: ${rolesEdit.map(roleLabel).join(" + ")}`);
    setRolesUser(null);
    await loadUsers();
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
        <h1 className="font-sign text-3xl font-bold">Usuarios</h1>
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
              <Label htmlFor="new-password">Contraseña temporal</Label>
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
              <p className="text-xs text-muted-foreground">
                Se le pedirá cambiarla la primera vez que inicie sesión.
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Roles (puede tener varios)</Label>
              <RolesPicker value={roles} onChange={setRoles} idPrefix="nuevo" />
            </div>
            <div className="flex items-end sm:col-span-2">
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
                        {u.roles.map((r) => (
                          <Badge
                            key={r}
                            variant="outline"
                            className={cn(
                              "px-1.5 py-0 text-[11px]",
                              r === "admin" && "border-primary/30 bg-primary/10 text-primary"
                            )}
                          >
                            {roleLabel(r)}
                          </Badge>
                        ))}
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
                                onSelect={() => {
                                  setRolesEdit(u.roles);
                                  setRolesUser(u);
                                }}
                              >
                                <UserCog className="mr-2 h-4 w-4" />
                                Cambiar roles…
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
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

      {/* ================== Cambiar roles ================== */}
      <Dialog open={!!rolesUser} onOpenChange={(o) => !o && setRolesUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar roles</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {rolesUser?.email}. Con acceso a Eventos y a Asistencia, al entrar elige el módulo y
            puede cambiarlo desde el menú de su cuenta.
          </p>
          <RolesPicker value={rolesEdit} onChange={setRolesEdit} idPrefix="editar" />
          <DialogFooter>
            <Button onClick={guardarRoles} disabled={busyId === rolesUser?.id || rolesEdit.length === 0}>
              {busyId === rolesUser?.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <p className="text-xs text-muted-foreground">
                Deberá cambiarla al volver a iniciar sesión.
              </p>
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
