-- Roles múltiples: un usuario puede tener varios roles a la vez, por ejemplo
-- el encargado de la puerta con "usuario" (ingreso de acampantes) y "kiosko"
-- (marcado de asistencia de los trabajadores).
--
-- profiles.roles es la lista de roles. profiles.role queda como rol principal
-- (lo sigue usando la Edge Function admin-users al crear y cambiar el rol) y
-- se mantiene sincronizado con un trigger.

ALTER TABLE public.profiles
  ADD COLUMN roles TEXT[] NOT NULL DEFAULT '{}'
  CHECK (roles <@ ARRAY['admin', 'usuario', 'rrhh', 'kiosko']::TEXT[]);

UPDATE public.profiles SET roles = ARRAY[role];

-- Rol principal: el de más permisos de la lista
CREATE OR REPLACE FUNCTION public.rol_principal(p_roles TEXT[])
RETURNS TEXT
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN 'admin' = ANY(p_roles) THEN 'admin'
    WHEN 'rrhh' = ANY(p_roles) THEN 'rrhh'
    WHEN 'usuario' = ANY(p_roles) THEN 'usuario'
    WHEN 'kiosko' = ANY(p_roles) THEN 'kiosko'
    ELSE 'usuario'
  END;
$$;

CREATE OR REPLACE FUNCTION public.sincronizar_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF coalesce(cardinality(NEW.roles), 0) = 0 THEN
      NEW.roles := ARRAY[NEW.role];
    END IF;
  ELSIF NEW.roles IS DISTINCT FROM OLD.roles THEN
    -- Se cambiaron los roles (pantalla Usuarios): el principal se recalcula
    IF coalesce(cardinality(NEW.roles), 0) = 0 THEN
      RAISE EXCEPTION 'El usuario debe tener al menos un rol';
    END IF;
  ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Se cambió solo el rol (Edge Function): queda como único rol
    NEW.roles := ARRAY[NEW.role];
  END IF;
  NEW.role := public.rol_principal(NEW.roles);
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_sincronizar_roles
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sincronizar_roles();

-- El administrador cambia los roles desde la pantalla Usuarios
CREATE POLICY "Admin actualiza perfiles"
ON public.profiles FOR UPDATE TO authenticated
USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ================== Comprobación de roles ==================
-- ¿El usuario actual tiene alguno de estos roles?
CREATE OR REPLACE FUNCTION public.tiene_rol(VARIADIC p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND roles && p_roles);
$$;

GRANT EXECUTE ON FUNCTION public.tiene_rol(TEXT[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.tiene_rol('admin');
$$;

CREATE OR REPLACE FUNCTION public.es_rrhh()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.tiene_rol('admin', 'rrhh');
$$;

-- Movimientos de la puerta (Eventos)
DROP POLICY "Eventos ve movimientos" ON public.movimientos;
CREATE POLICY "Eventos ve movimientos"
ON public.movimientos FOR SELECT TO authenticated
USING (public.tiene_rol('admin', 'usuario'));

DROP POLICY "Eventos pone motivo a movimientos" ON public.movimientos;
CREATE POLICY "Eventos pone motivo a movimientos"
ON public.movimientos FOR UPDATE TO authenticated
USING (public.tiene_rol('admin', 'usuario'));

-- Las funciones que comprobaban un solo rol pasan a comprobar la lista.
-- Se reemplaza solo esa condición dentro de su definición actual.
DO $$
DECLARE
  v_def TEXT;
  v_nueva TEXT;
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('marcar_asistencia',
       $q$public.mi_rol() IN ('admin', 'rrhh', 'kiosko')$q$,
       $q$public.tiene_rol('admin', 'rrhh', 'kiosko')$q$),
      ('registrar_movimiento',
       $q$public.mi_rol() IN ('admin', 'usuario')$q$,
       $q$public.tiene_rol('admin', 'usuario')$q$),
      ('estado_puerta',
       $q$public.mi_rol() IN ('admin', 'usuario')$q$,
       $q$public.tiene_rol('admin', 'usuario')$q$)
    ) AS t(nombre, antes, despues)
  LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.nombre;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'No existe la función %', r.nombre;
    END IF;
    v_nueva := replace(v_def, r.antes, r.despues);
    IF v_nueva = v_def THEN
      RAISE EXCEPTION 'No se encontró la comprobación de rol en %', r.nombre;
    END IF;
    EXECUTE v_nueva;
  END LOOP;
END;
$$;
