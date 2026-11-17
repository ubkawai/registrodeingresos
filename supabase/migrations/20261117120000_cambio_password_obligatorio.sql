-- Cambio de contraseña obligatorio en el primer inicio de sesión.
-- La Edge Function admin-users marca la cuenta al crearla (y cuando el
-- administrador restablece la contraseña de otra persona). Las cuentas que ya
-- existían quedan en false.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- profiles no tiene políticas de escritura: el propio usuario solo puede
-- quitar su marca con esta función, después de cambiar su contraseña.
CREATE OR REPLACE FUNCTION public.confirmar_cambio_password()
RETURNS VOID
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.profiles SET must_change_password = false WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.confirmar_cambio_password() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_cambio_password() TO authenticated;
