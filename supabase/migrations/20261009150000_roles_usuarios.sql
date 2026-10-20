-- Roles: solo el administrador crea cuentas (desde la pantalla "Usuarios",
-- a través de la Edge Function admin-users). El registro público se desactiva
-- en Authentication > Sign In / Providers > "Allow new users to sign up".

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'usuario' CHECK (role IN ('admin', 'usuario')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- Cada usuario ve su perfil; el admin ve todos. Los cambios solo los hace
-- la Edge Function (clave de servicio), por eso no hay políticas de escritura.
CREATE POLICY "Ver el propio perfil o todos si es admin"
ON public.profiles FOR SELECT
TO authenticated
USING (id = auth.uid() OR public.is_admin());

-- Superusuario inicial
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN lower(NEW.email) = 'harolte@hotmail.com' THEN 'admin' ELSE 'usuario' END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Perfiles para las cuentas que ya existían
INSERT INTO public.profiles (id, email, role)
SELECT
  id,
  email,
  CASE WHEN lower(email) = 'harolte@hotmail.com' THEN 'admin' ELSE 'usuario' END
FROM auth.users
ON CONFLICT (id) DO NOTHING;
