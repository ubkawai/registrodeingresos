-- Eventos: lugar de destino de cada lista, estadía y control de puerta
-- (salidas y reingresos de los acampantes durante su estadía).
--
-- Ciclo de una lista:
--   Llegada     closed_at IS NULL                              (se registra la llegada)
--   En estadía  closed_at IS NOT NULL AND estadia_fin_at IS NULL
--   Finalizada  estadia_fin_at IS NOT NULL
-- En Llegada y En estadía la lista cuenta en la puerta de su lugar.

-- ================== Lugares ==================
CREATE TABLE public.lugares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  -- Hora a la que deben haber regresado los que salieron (aviso en la puerta)
  hora_limite TIME NOT NULL DEFAULT '23:00',
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX lugares_nombre_unique ON public.lugares (lower(nombre));

ALTER TABLE public.lugares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados ven los lugares"
ON public.lugares FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin crea lugares"
ON public.lugares FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "Admin actualiza lugares"
ON public.lugares FOR UPDATE TO authenticated USING (public.is_admin());

CREATE POLICY "Admin elimina lugares"
ON public.lugares FOR DELETE TO authenticated USING (public.is_admin());

-- ================== Listas: lugar y estadía ==================
ALTER TABLE public.scan_lists
  ADD COLUMN lugar_id UUID REFERENCES public.lugares(id) ON DELETE SET NULL,
  ADD COLUMN estadia_fin_at TIMESTAMPTZ;

-- Las listas ya guardadas quedan finalizadas (no aparecen en la puerta)
UPDATE public.scan_lists SET estadia_fin_at = closed_at WHERE closed_at IS NOT NULL;

CREATE INDEX idx_scan_lists_lugar_activas
ON public.scan_lists (lugar_id) WHERE estadia_fin_at IS NULL;

-- ================== Movimientos ==================
CREATE TABLE public.movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_list_id UUID NOT NULL REFERENCES public.scan_lists(id) ON DELETE CASCADE,
  dni_number TEXT NOT NULL,
  full_name TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('salida', 'reingreso')),
  motivo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID REFERENCES auth.users DEFAULT auth.uid()
);

CREATE INDEX idx_movimientos_lista_dni ON public.movimientos (scan_list_id, dni_number, created_at DESC);

ALTER TABLE public.movimientos ENABLE ROW LEVEL SECURITY;

-- Se crean solo con registrar_movimiento(); se leen y se les pone motivo
-- desde Eventos (usuario y admin)
CREATE POLICY "Eventos ve movimientos"
ON public.movimientos FOR SELECT TO authenticated
USING (coalesce(public.mi_rol() IN ('admin', 'usuario'), false));

CREATE POLICY "Eventos pone motivo a movimientos"
ON public.movimientos FOR UPDATE TO authenticated
USING (coalesce(public.mi_rol() IN ('admin', 'usuario'), false));

CREATE POLICY "Admin elimina movimientos"
ON public.movimientos FOR DELETE TO authenticated USING (public.is_admin());

ALTER PUBLICATION supabase_realtime ADD TABLE public.movimientos;

-- ================== Marcado en la puerta ==================
-- Busca al acampante en las listas activas del lugar (puede haber varias a la
-- vez) y alterna: si estaba dentro registra la salida, si estaba fuera el
-- reingreso. Funciona con cualquier cuenta de Eventos, aunque la lista la
-- haya creado otra cuenta.
CREATE OR REPLACE FUNCTION public.registrar_movimiento(
  p_lugar_id UUID,
  p_dni TEXT,
  p_motivo TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_nombre TEXT;
  v_lista_id UUID;
  v_lista TEXT;
  v_otro_lugar TEXT;
  v_ultimo public.movimientos%ROWTYPE;
  v_mov public.movimientos%ROWTYPE;
  v_tipo TEXT;
BEGIN
  IF coalesce(public.mi_rol() IN ('admin', 'usuario'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta cuenta no puede registrar movimientos' USING ERRCODE = '42501';
  END IF;

  IF p_dni IS NULL OR p_dni !~ '^[0-9]{8}$' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'dni_invalido', 'dni', p_dni);
  END IF;

  -- Lista activa del lugar donde está registrado (la de llegada más reciente)
  SELECT r.full_name, l.id, l.title
  INTO v_nombre, v_lista_id, v_lista
  FROM public.scanned_records r
  JOIN public.scan_lists l ON l.id = r.scan_list_id
  WHERE r.dni_number = p_dni
    AND l.lugar_id = p_lugar_id
    AND l.estadia_fin_at IS NULL
  ORDER BY r.scanned_at DESC
  LIMIT 1;

  IF v_lista_id IS NULL THEN
    -- ¿Está en una lista activa de otro lugar?
    SELECT r.full_name, l.title, g.nombre
    INTO v_nombre, v_lista, v_otro_lugar
    FROM public.scanned_records r
    JOIN public.scan_lists l ON l.id = r.scan_list_id
    LEFT JOIN public.lugares g ON g.id = l.lugar_id
    WHERE r.dni_number = p_dni AND l.estadia_fin_at IS NULL
    ORDER BY r.scanned_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'ok', false,
      'motivo', 'no_pertenece',
      'dni', p_dni,
      'nombre', v_nombre,
      'otro_lugar', v_otro_lugar,
      'lista', v_lista
    );
  END IF;

  -- Dos equipos leyendo el mismo DNI a la vez no crean dos movimientos
  PERFORM pg_advisory_xact_lock(hashtext('mov:' || v_lista_id::text || p_dni));

  SELECT * INTO v_ultimo
  FROM public.movimientos
  WHERE scan_list_id = v_lista_id AND dni_number = p_dni
  ORDER BY created_at DESC
  LIMIT 1;

  -- Doble lectura del lector: se ignora si marcó hace menos de 15 segundos
  IF v_ultimo.id IS NOT NULL AND v_ultimo.created_at > now() - interval '15 seconds' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'motivo', 'repetido',
      'dni', p_dni,
      'nombre', v_nombre,
      'lista', v_lista,
      'tipo', v_ultimo.tipo,
      'id', v_ultimo.id
    );
  END IF;

  v_tipo := CASE WHEN v_ultimo.tipo = 'salida' THEN 'reingreso' ELSE 'salida' END;

  INSERT INTO public.movimientos (scan_list_id, dni_number, full_name, tipo, motivo)
  VALUES (v_lista_id, p_dni, v_nombre, v_tipo, nullif(trim(p_motivo), ''))
  RETURNING * INTO v_mov;

  RETURN jsonb_build_object(
    'ok', true,
    'id', v_mov.id,
    'tipo', v_tipo,
    'dni', p_dni,
    'nombre', v_nombre,
    'lista', v_lista,
    'lista_id', v_lista_id,
    'created_at', v_mov.created_at,
    -- En un reingreso: a qué hora había salido
    'salida_at', CASE WHEN v_tipo = 'reingreso' THEN v_ultimo.created_at END,
    'salida_motivo', CASE WHEN v_tipo = 'reingreso' THEN v_ultimo.motivo END
  );
END;
$$;

-- ================== Estado de la puerta ==================
-- Listas activas del lugar con cuántos están dentro y fuera, y quiénes están
-- fuera ahora. Incluye las listas de todas las cuentas de Eventos.
CREATE OR REPLACE FUNCTION public.estado_puerta(p_lugar_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_res JSONB;
BEGIN
  IF coalesce(public.mi_rol() IN ('admin', 'usuario'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Esta cuenta no puede ver la puerta' USING ERRCODE = '42501';
  END IF;

  WITH listas AS (
    SELECT l.id, l.title, l.created_at, l.closed_at
    FROM public.scan_lists l
    WHERE l.lugar_id = p_lugar_id AND l.estadia_fin_at IS NULL
  ),
  personas AS (
    SELECT DISTINCT ON (r.scan_list_id, r.dni_number)
      r.scan_list_id, r.dni_number, r.full_name
    FROM public.scanned_records r
    JOIN listas ON listas.id = r.scan_list_id
    ORDER BY r.scan_list_id, r.dni_number, r.scanned_at
  ),
  ultimo AS (
    SELECT DISTINCT ON (m.scan_list_id, m.dni_number)
      m.scan_list_id, m.dni_number, m.tipo, m.created_at, m.motivo, m.id
    FROM public.movimientos m
    JOIN listas ON listas.id = m.scan_list_id
    ORDER BY m.scan_list_id, m.dni_number, m.created_at DESC
  ),
  estado AS (
    SELECT p.*, u.tipo, u.created_at AS mov_at, u.motivo, u.id AS mov_id,
           coalesce(u.tipo = 'salida', false) AS fuera
    FROM personas p
    LEFT JOIN ultimo u USING (scan_list_id, dni_number)
  )
  SELECT jsonb_build_object(
    'listas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'title', l.title,
        'created_at', l.created_at,
        'en_llegada', l.closed_at IS NULL,
        'total', (SELECT count(*) FROM estado e WHERE e.scan_list_id = l.id),
        'fuera', (SELECT count(*) FROM estado e WHERE e.scan_list_id = l.id AND e.fuera)
      ) ORDER BY l.created_at)
      FROM listas l
    ), '[]'::jsonb),
    'fuera', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.mov_id,
        'dni', e.dni_number,
        'nombre', e.full_name,
        'lista_id', e.scan_list_id,
        'lista', (SELECT title FROM listas WHERE listas.id = e.scan_list_id),
        'salida_at', e.mov_at,
        'motivo', e.motivo
      ) ORDER BY e.mov_at)
      FROM estado e WHERE e.fuera
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_movimiento(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estado_puerta(UUID) TO authenticated;
