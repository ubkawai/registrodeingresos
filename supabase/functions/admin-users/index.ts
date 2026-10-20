// Edge Function: administración de cuentas. Solo la puede usar un usuario con
// rol 'admin' en public.profiles. Usa la clave de servicio, que nunca llega
// al navegador.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Errores de negocio con 200 para que el cliente pueda leer el mensaje
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  // ¿Quién llama y es admin?
  const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
  const { data: { user: caller } } = await admin.auth.getUser(token);
  if (!caller) return reply({ error: "Sesión no válida" }, 401);

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", caller.id)
    .maybeSingle();
  if (callerProfile?.role !== "admin") {
    return reply({ error: "Solo el administrador puede gestionar cuentas" }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Solicitud inválida" });
  }
  const { action, id } = body ?? {};
  const isSelf = id && id === caller.id;

  try {
    switch (action) {
      case "list": {
        const [{ data: profiles, error: pErr }, { data: authData, error: aErr }] =
          await Promise.all([
            admin.from("profiles").select("*").order("created_at", { ascending: true }),
            admin.auth.admin.listUsers({ perPage: 1000 }),
          ]);
        if (pErr) throw pErr;
        if (aErr) throw aErr;

        const byId = new Map(authData.users.map((u) => [u.id, u]));
        const users = (profiles ?? []).map((p) => {
          const u: any = byId.get(p.id);
          return {
            id: p.id,
            email: p.email,
            role: p.role,
            created_at: p.created_at,
            last_sign_in_at: u?.last_sign_in_at ?? null,
            active: !(u?.banned_until && new Date(u.banned_until) > new Date()),
          };
        });
        return reply({ users });
      }

      case "create": {
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        const role = body.role === "admin" ? "admin" : "usuario";
        if (!email.includes("@")) return reply({ error: "Correo no válido" });
        if (password.length < 6) {
          return reply({ error: "La contraseña debe tener al menos 6 caracteres" });
        }

        const { data, error } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error) {
          const msg = /already|registered|exists/i.test(error.message)
            ? "Ya existe una cuenta con ese correo"
            : error.message;
          return reply({ error: msg });
        }

        // El trigger crea el perfil como 'usuario'
        const { error: upErr } = await admin
          .from("profiles")
          .upsert({ id: data.user.id, email, role });
        if (upErr) throw upErr;
        return reply({ ok: true });
      }

      case "set_password": {
        const password = String(body.password ?? "");
        if (password.length < 6) {
          return reply({ error: "La contraseña debe tener al menos 6 caracteres" });
        }
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) throw error;
        return reply({ ok: true });
      }

      case "set_role": {
        if (isSelf) return reply({ error: "No puedes cambiar tu propio rol" });
        const role = body.role === "admin" ? "admin" : "usuario";
        const { error } = await admin.from("profiles").update({ role }).eq("id", id);
        if (error) throw error;
        return reply({ ok: true });
      }

      case "set_active": {
        if (isSelf) return reply({ error: "No puedes desactivar tu propia cuenta" });
        const { error } = await admin.auth.admin.updateUserById(id, {
          ban_duration: body.active ? "none" : "876000h",
        });
        if (error) throw error;
        return reply({ ok: true });
      }

      case "delete": {
        if (isSelf) return reply({ error: "No puedes eliminar tu propia cuenta" });
        // Las listas de asistencia no se borran: se pide desactivar en su lugar
        const { count } = await admin
          .from("scan_lists")
          .select("id", { count: "exact", head: true })
          .eq("user_id", id);
        if (count) {
          return reply({
            error: `Esta cuenta tiene ${count} ${count === 1 ? "lista" : "listas"}. Desactívala en lugar de eliminarla.`,
          });
        }
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw error;
        return reply({ ok: true });
      }

      default:
        return reply({ error: "Acción desconocida" });
    }
  } catch (e) {
    console.error(e);
    return reply({ error: (e as Error)?.message ?? "Error inesperado" });
  }
});
