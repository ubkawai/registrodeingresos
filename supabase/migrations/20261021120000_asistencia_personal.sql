-- Asistencia del personal (entrada / refrigerio / salida).
-- Pensado para cumplir el D.S. 004-2006-TR (mod. D.S. 011-2006-TR):
--   * datos del empleador (razón social, RUC) y del trabajador (nombre, DNI)
--   * fecha, hora y minuto de ingreso, salida e inicio/fin de refrigerio
--   * sobretiempo (permanencia después del horario de salida)
--   * soporte digital que no permita adulteración ni pérdida: las marcas no se
--     editan ni se borran; las correcciones se hacen anulando (con motivo) y
--     registrando una marca manual (con motivo), quedando ambas a la vista.
--   * conservación por 5 años.
-- La hora de cada marca la pone el servidor (now()), no el equipo.

-- ================== Roles ==================
-- rrhh: gestiona trabajadores, turnos, reportes y correcciones
-- kiosko: cuenta del equipo fijo en la puerta; solo puede marcar
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'usuario', 'rrhh', 'kiosko'));

CREATE OR REPLACE FUNCTION public.mi_rol()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.es_rrhh()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce(public.mi_rol() IN ('admin', 'rrhh'), false);
$$;

-- ================== Empleador (una sola fila) ==================
CREATE TABLE public.empleador (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  razon_social TEXT NOT NULL DEFAULT '',
  ruc TEXT NOT NULL DEFAULT '' CHECK (ruc = '' OR ruc ~ '^[0-9]{11}$'),
  -- Minutos de tolerancia al ingreso (se exhiben junto al horario)
  tolerancia_min INTEGER NOT NULL DEFAULT 0 CHECK (tolerancia_min BETWEEN 0 AND 60),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
INSERT INTO public.empleador DEFAULT VALUES;

ALTER TABLE public.empleador ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados ven el empleador"
ON public.empleador FOR SELECT TO authenticated USING (true);

CREATE POLICY "RR.HH. actualiza el empleador"
ON public.empleador FOR UPDATE TO authenticated
USING (public.es_rrhh()) WITH CHECK (public.es_rrhh());

-- ================== Turnos ==================
-- Si hora_fin <= hora_inicio el turno cruza la medianoche (ej. 22:00 - 06:00)
CREATE TABLE public.turnos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fin TIME NOT NULL,
  refrigerio_min INTEGER NOT NULL DEFAULT 45 CHECK (refrigerio_min BETWEEN 0 AND 180),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.turnos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados ven los turnos"
ON public.turnos FOR SELECT TO authenticated USING (true);

CREATE POLICY "RR.HH. crea turnos"
ON public.turnos FOR INSERT TO authenticated WITH CHECK (public.es_rrhh());

CREATE POLICY "RR.HH. actualiza turnos"
ON public.turnos FOR UPDATE TO authenticated
USING (public.es_rrhh()) WITH CHECK (public.es_rrhh());

-- Solo se pueden borrar turnos sin uso (la FK lo impide si ya tienen jornadas)
CREATE POLICY "RR.HH. elimina turnos"
ON public.turnos FOR DELETE TO authenticated USING (public.es_rrhh());

INSERT INTO public.turnos (nombre, hora_inicio, hora_fin, refrigerio_min) VALUES
  ('Mañana',                     '06:00', '14:00', 45),
  ('Tarde',                      '14:00', '22:00', 45),
  ('Noche (vigilancia)',         '22:00', '06:00', 45),
  ('Mantenimiento y limpieza',   '08:00', '17:00', 60),
  ('Vigilancia 12 horas',        '10:00', '22:00', 60),
  ('Administrativo',             '06:00', '22:00', 60);

-- ================== Trabajadores ==================
CREATE TABLE public.trabajadores (
  dni TEXT PRIMARY KEY CHECK (dni ~ '^[0-9]{8}$'),
  nombre_completo TEXT NOT NULL CHECK (length(trim(nombre_completo)) > 0),
  cargo TEXT,
  area TEXT,
  turno_id UUID REFERENCES public.turnos(id),
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_trabajadores_turno ON public.trabajadores(turno_id);

ALTER TABLE public.trabajadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "RR.HH. ve trabajadores"
ON public.trabajadores FOR SELECT TO authenticated USING (public.es_rrhh());

CREATE POLICY "RR.HH. crea trabajadores"
ON public.trabajadores FOR INSERT TO authenticated WITH CHECK (public.es_rrhh());

CREATE POLICY "RR.HH. actualiza trabajadores"
ON public.trabajadores FOR UPDATE TO authenticated
USING (public.es_rrhh()) WITH CHECK (public.es_rrhh());

-- Solo se pueden borrar trabajadores sin marcas (la FK lo impide si las tienen)
CREATE POLICY "RR.HH. elimina trabajadores"
ON public.trabajadores FOR DELETE TO authenticated USING (public.es_rrhh());

CREATE TRIGGER trabajadores_updated_at
BEFORE UPDATE ON public.trabajadores
FOR EACH ROW EXECUTE FUNCTION public.acampantes_set_updated_at();

-- ================== Jornadas ==================
-- Una jornada empieza con una entrada. Guarda una copia del horario vigente
-- en ese momento, para que cambiar un turno no altere reportes pasados.
CREATE TABLE public.jornadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dni TEXT NOT NULL REFERENCES public.trabajadores(dni),
  fecha DATE NOT NULL, -- día (hora de Lima) en que empieza el turno
  turno_id UUID REFERENCES public.turnos(id),
  turno_nombre TEXT,
  programada_inicio TIMESTAMP WITH TIME ZONE,
  programada_fin TIMESTAMP WITH TIME ZONE,
  refrigerio_min INTEGER NOT NULL DEFAULT 0,
  tolerancia_min INTEGER NOT NULL DEFAULT 0,
  entrada_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_jornadas_fecha ON public.jornadas(fecha);
CREATE INDEX idx_jornadas_dni_entrada ON public.jornadas(dni, entrada_at DESC);

ALTER TABLE public.jornadas ENABLE ROW LEVEL SECURITY;

-- Sin políticas de escritura: solo se crean desde las funciones de abajo
CREATE POLICY "RR.HH. ve jornadas"
ON public.jornadas FOR SELECT TO authenticated USING (public.es_rrhh());

-- ================== Marcas ==================
CREATE TABLE public.marcas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jornada_id UUID NOT NULL REFERENCES public.jornadas(id),
  dni TEXT NOT NULL REFERENCES public.trabajadores(dni),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'inicio_refrigerio', 'fin_refrigerio', 'salida')),
  marcado_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  origen TEXT NOT NULL DEFAULT 'lector' CHECK (origen IN ('lector', 'manual')),
  motivo TEXT,
  registrado_por UUID NOT NULL REFERENCES auth.users,
  anulada_at TIMESTAMP WITH TIME ZONE,
  anulada_por UUID REFERENCES auth.users,
  anulada_motivo TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CHECK (origen = 'lector' OR length(trim(coalesce(motivo, ''))) >= 5)
);

CREATE INDEX idx_marcas_jornada ON public.marcas(jornada_id);
CREATE INDEX idx_marcas_dni_fecha ON public.marcas(dni, marcado_at DESC);

ALTER TABLE public.marcas ENABLE ROW LEVEL SECURITY;

-- Sin políticas de escritura: solo se crean/anulan desde las funciones de abajo
CREATE POLICY "RR.HH. ve marcas"
ON public.marcas FOR SELECT TO authenticated USING (public.es_rrhh());

-- ================== Inalterabilidad ==================
-- Ni siquiera con la clave de servicio se pueden editar o borrar marcas
-- dentro del plazo de conservación. Solo se permite anularlas una vez.
CREATE OR REPLACE FUNCTION public.marcas_proteger()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.marcado_at > now() - interval '5 years' THEN
      RAISE EXCEPTION 'Las marcas de asistencia se conservan 5 años y no se pueden borrar';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.anulada_at IS NOT NULL
     OR (NEW.jornada_id, NEW.dni, NEW.tipo, NEW.marcado_at, NEW.origen, NEW.motivo,
         NEW.registrado_por, NEW.created_at)
        IS DISTINCT FROM
        (OLD.jornada_id, OLD.dni, OLD.tipo, OLD.marcado_at, OLD.origen, OLD.motivo,
         OLD.registrado_por, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Las marcas no se modifican: anúlala y registra una nueva';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER marcas_proteger
BEFORE UPDATE OR DELETE ON public.marcas
FOR EACH ROW EXECUTE FUNCTION public.marcas_proteger();

CREATE OR REPLACE FUNCTION public.jornadas_proteger()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.entrada_at > now() - interval '5 years' THEN
      RAISE EXCEPTION 'Las jornadas se conservan 5 años y no se pueden borrar';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Las jornadas no se modifican';
END;
$$;

CREATE TRIGGER jornadas_proteger
BEFORE UPDATE OR DELETE ON public.jornadas
FOR EACH ROW EXECUTE FUNCTION public.jornadas_proteger();

-- ================== Funciones auxiliares ==================
-- Ocurrencia de la hora de inicio del turno (hora de Lima) más cercana a p_t.
-- Así una entrada a las 21:50 o a las 22:20 cae en el turno de las 22:00 de
-- ese día, y una a las 00:30 en el que empezó la noche anterior.
CREATE OR REPLACE FUNCTION public.inicio_turno_cercano(p_t TIMESTAMPTZ, p_inicio TIME)
RETURNS TIMESTAMPTZ
LANGUAGE sql STABLE SET search_path = public
AS $$
  SELECT s
  FROM (
    SELECT ((((p_t AT TIME ZONE 'America/Lima')::date + d) + p_inicio)
            AT TIME ZONE 'America/Lima') AS s
    FROM unnest(ARRAY[-1, 0, 1]) AS d
  ) x
  ORDER BY abs(extract(epoch FROM s - p_t))
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.duracion_turno(p_inicio TIME, p_fin TIME)
RETURNS INTERVAL
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE WHEN p_fin > p_inicio THEN p_fin - p_inicio
              ELSE (p_fin - p_inicio) + interval '24 hours' END;
$$;

-- Crea la jornada que empieza con una entrada en p_t
CREATE OR REPLACE FUNCTION public.crear_jornada(p_dni TEXT, p_t TIMESTAMPTZ)
RETURNS public.jornadas
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_turno public.turnos%ROWTYPE;
  v_tol INTEGER;
  v_inicio TIMESTAMPTZ;
  v_j public.jornadas%ROWTYPE;
BEGIN
  SELECT t.* INTO v_turno
  FROM public.trabajadores w JOIN public.turnos t ON t.id = w.turno_id
  WHERE w.dni = p_dni;

  SELECT tolerancia_min INTO v_tol FROM public.empleador LIMIT 1;

  IF v_turno.id IS NOT NULL THEN
    v_inicio := public.inicio_turno_cercano(p_t, v_turno.hora_inicio);
  END IF;

  INSERT INTO public.jornadas (
    dni, fecha, turno_id, turno_nombre, programada_inicio, programada_fin,
    refrigerio_min, tolerancia_min, entrada_at
  ) VALUES (
    p_dni,
    (coalesce(v_inicio, p_t) AT TIME ZONE 'America/Lima')::date,
    v_turno.id,
    v_turno.nombre,
    v_inicio,
    v_inicio + public.duracion_turno(v_turno.hora_inicio, v_turno.hora_fin),
    coalesce(v_turno.refrigerio_min, 0),
    coalesce(v_tol, 0),
    p_t
  )
  RETURNING * INTO v_j;

  RETURN v_j;
END;
$$;

-- Resumen que se devuelve a la pantalla de marcado
CREATE OR REPLACE FUNCTION public.resumen_marca(p_marca public.marcas)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'id', p_marca.id,
    'tipo', p_marca.tipo,
    'marcado_at', p_marca.marcado_at,
    'dni', w.dni,
    'nombre', w.nombre_completo,
    'turno', j.turno_nombre,
    'programada_inicio', j.programada_inicio,
    'programada_fin', j.programada_fin,
    'tardanza_min', CASE
      WHEN p_marca.tipo = 'entrada' AND j.programada_inicio IS NOT NULL
           AND p_marca.marcado_at > j.programada_inicio + make_interval(mins => j.tolerancia_min)
      THEN floor(extract(epoch FROM p_marca.marcado_at - j.programada_inicio) / 60)::int
      ELSE 0 END,
    'marcas', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('tipo', m.tipo, 'marcado_at', m.marcado_at)
                                ORDER BY m.marcado_at), '[]'::jsonb)
      FROM public.marcas m
      WHERE m.jornada_id = j.id AND m.anulada_at IS NULL
    )
  )
  FROM public.jornadas j JOIN public.trabajadores w ON w.dni = j.dni
  WHERE j.id = p_marca.jornada_id;
$$;

-- ================== Marcar (lector / kiosko) ==================
-- Decide sola el tipo de marca:
--   sin jornada abierta            -> entrada
--   en refrigerio                  -> fin de refrigerio
--   dentro y ya tomó refrigerio    -> salida
--   dentro y sin refrigerio aún    -> pide elegir (refrigerio o salida) y
--                                     sugiere una según la hora
-- Respuestas con ok=false: dni_invalido, no_registrado, inactivo, reciente,
-- elegir (trae 'opciones' y 'sugerida'), tipo_invalido.
CREATE OR REPLACE FUNCTION public.marcar_asistencia(p_dni TEXT, p_tipo TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ahora TIMESTAMPTZ := now();
  v_trab public.trabajadores%ROWTYPE;
  v_ultima public.marcas%ROWTYPE;
  v_jornada public.jornadas%ROWTYPE;
  v_marca public.marcas%ROWTYPE;
  v_tipo TEXT;
  v_opciones TEXT[];
  v_sugerida TEXT;
BEGIN
  IF coalesce(public.mi_rol() IN ('admin', 'rrhh', 'kiosko'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta cuenta no puede registrar asistencia' USING ERRCODE = '42501';
  END IF;

  IF p_dni IS NULL OR p_dni !~ '^[0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'dni_invalido', 'dni', p_dni);
  END IF;

  SELECT * INTO v_trab FROM public.trabajadores WHERE dni = p_dni;
  IF v_trab.dni IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'no_registrado', 'dni', p_dni);
  END IF;
  IF NOT v_trab.activo THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'inactivo', 'dni', p_dni,
                              'nombre', v_trab.nombre_completo);
  END IF;

  -- Dos equipos leyendo el mismo DNI a la vez no crean dos marcas
  PERFORM pg_advisory_xact_lock(hashtext('marca:' || p_dni));

  SELECT * INTO v_ultima
  FROM public.marcas
  WHERE dni = p_dni AND anulada_at IS NULL
  ORDER BY marcado_at DESC
  LIMIT 1;

  -- Doble lectura: se ignora si marcó hace menos de 2 minutos
  IF v_ultima.id IS NOT NULL AND v_ahora - v_ultima.marcado_at < interval '2 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'reciente', 'dni', p_dni,
                              'nombre', v_trab.nombre_completo, 'tipo', v_ultima.tipo,
                              'marcado_at', v_ultima.marcado_at);
  END IF;

  -- ¿Tiene una jornada abierta? Si olvidó marcar la salida, la jornada se
  -- da por abandonada 6 h después del fin del turno (16 h sin turno, y nunca
  -- más de 20 h desde la entrada) y la siguiente lectura es una nueva entrada.
  IF v_ultima.id IS NOT NULL AND v_ultima.tipo <> 'salida' THEN
    SELECT * INTO v_jornada FROM public.jornadas WHERE id = v_ultima.jornada_id;
    IF v_ahora > least(coalesce(v_jornada.programada_fin + interval '6 hours',
                                v_jornada.entrada_at + interval '16 hours'),
                       v_jornada.entrada_at + interval '20 hours') THEN
      v_jornada := NULL;
    END IF;
  END IF;

  IF v_jornada.id IS NULL THEN
    v_tipo := 'entrada';
  ELSIF v_ultima.tipo = 'inicio_refrigerio' THEN
    v_tipo := 'fin_refrigerio';
  ELSIF (v_jornada.turno_id IS NOT NULL AND v_jornada.refrigerio_min = 0) OR EXISTS (
    SELECT 1 FROM public.marcas
    WHERE jornada_id = v_jornada.id AND anulada_at IS NULL AND tipo = 'fin_refrigerio'
  ) THEN
    v_tipo := 'salida';
  ELSE
    v_opciones := ARRAY['inicio_refrigerio', 'salida'];
    v_sugerida := CASE
      WHEN v_jornada.programada_fin IS NULL
           OR v_ahora >= v_jornada.programada_fin - interval '1 hour' THEN 'salida'
      ELSE 'inicio_refrigerio' END;

    IF p_tipo IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'elegir', 'dni', p_dni,
                                'nombre', v_trab.nombre_completo,
                                'opciones', to_jsonb(v_opciones), 'sugerida', v_sugerida);
    END IF;
    IF NOT (p_tipo = ANY (v_opciones)) THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'tipo_invalido', 'dni', p_dni);
    END IF;
    v_tipo := p_tipo;
  END IF;

  IF p_tipo IS NOT NULL AND p_tipo <> v_tipo THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'tipo_invalido', 'dni', p_dni);
  END IF;

  IF v_tipo = 'entrada' THEN
    v_jornada := public.crear_jornada(p_dni, v_ahora);
  END IF;

  INSERT INTO public.marcas (jornada_id, dni, tipo, marcado_at, origen, registrado_por)
  VALUES (v_jornada.id, p_dni, v_tipo, v_ahora, 'lector', auth.uid())
  RETURNING * INTO v_marca;

  RETURN public.resumen_marca(v_marca);
END;
$$;

-- ================== Correcciones (RR.HH.) ==================
-- Marca manual: para olvidos (ej. no marcó la salida). Queda como 'manual',
-- con motivo y con quién la registró.
CREATE OR REPLACE FUNCTION public.registrar_marca_manual(
  p_dni TEXT, p_tipo TEXT, p_marcado_at TIMESTAMPTZ, p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_jornada public.jornadas%ROWTYPE;
  v_marca public.marcas%ROWTYPE;
BEGIN
  IF NOT public.es_rrhh() THEN
    RAISE EXCEPTION 'Solo RR.HH. o el administrador pueden corregir marcas' USING ERRCODE = '42501';
  END IF;
  IF length(trim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Indica el motivo de la corrección (mínimo 5 caracteres)';
  END IF;
  IF p_tipo NOT IN ('entrada', 'inicio_refrigerio', 'fin_refrigerio', 'salida') THEN
    RAISE EXCEPTION 'Tipo de marca no válido';
  END IF;
  IF p_marcado_at IS NULL OR p_marcado_at > now() THEN
    RAISE EXCEPTION 'La hora de la marca no puede ser futura';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trabajadores WHERE dni = p_dni) THEN
    RAISE EXCEPTION 'El DNI % no está registrado como trabajador', p_dni;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('marca:' || p_dni));

  IF p_tipo = 'entrada' THEN
    v_jornada := public.crear_jornada(p_dni, p_marcado_at);
  ELSE
    -- La jornada que empezó antes de esa hora
    SELECT * INTO v_jornada
    FROM public.jornadas
    WHERE dni = p_dni
      AND entrada_at <= p_marcado_at
      AND p_marcado_at <= coalesce(programada_fin + interval '12 hours',
                                   entrada_at + interval '24 hours')
    ORDER BY entrada_at DESC
    LIMIT 1;

    IF v_jornada.id IS NULL THEN
      RAISE EXCEPTION 'No hay una entrada antes de esa hora. Registra primero la entrada.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.marcas
      WHERE jornada_id = v_jornada.id AND tipo = p_tipo AND anulada_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Esa jornada ya tiene esa marca. Anúlala antes de registrar otra.';
    END IF;
  END IF;

  INSERT INTO public.marcas (jornada_id, dni, tipo, marcado_at, origen, motivo, registrado_por)
  VALUES (v_jornada.id, p_dni, p_tipo, p_marcado_at, 'manual', trim(p_motivo), auth.uid())
  RETURNING * INTO v_marca;

  RETURN public.resumen_marca(v_marca);
END;
$$;

-- Anular: la marca sigue existiendo y se muestra tachada con el motivo
CREATE OR REPLACE FUNCTION public.anular_marca(p_id UUID, p_motivo TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.es_rrhh() THEN
    RAISE EXCEPTION 'Solo RR.HH. o el administrador pueden anular marcas' USING ERRCODE = '42501';
  END IF;
  IF length(trim(coalesce(p_motivo, ''))) < 5 THEN
    RAISE EXCEPTION 'Indica el motivo de la anulación (mínimo 5 caracteres)';
  END IF;

  UPDATE public.marcas
  SET anulada_at = now(), anulada_por = auth.uid(), anulada_motivo = trim(p_motivo)
  WHERE id = p_id AND anulada_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La marca no existe o ya estaba anulada';
  END IF;
END;
$$;

-- Las funciones internas no se llaman desde la app
REVOKE EXECUTE ON FUNCTION public.crear_jornada(TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resumen_marca(public.marcas) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.marcar_asistencia(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.registrar_marca_manual(TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.anular_marca(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_asistencia(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_marca_manual(TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_marca(UUID, TEXT) TO authenticated;

-- "Hoy en vivo" se actualiza con cada marca
ALTER PUBLICATION supabase_realtime ADD TABLE public.marcas;
