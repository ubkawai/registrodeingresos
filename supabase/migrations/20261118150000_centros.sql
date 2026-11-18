-- Centros: cada centro (ej. Kawai, Killay) tiene sus lugares o alojamientos
-- (Tambo II, Villa Girasoles, Casona, Casa A1…). La puerta y la hora límite
-- son del centro: se controla a todos sus acampantes, sea cual sea su lugar.

-- ================== Centros ==================
CREATE TABLE public.centros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  -- Hora a la que deben haber regresado los que salieron (aviso en la puerta)
  hora_limite TIME NOT NULL DEFAULT '23:00',
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX centros_nombre_unique ON public.centros (lower(nombre));

ALTER TABLE public.centros ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados ven los centros"
ON public.centros FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin crea centros"
ON public.centros FOR INSERT TO authenticated WITH CHECK (public.is_admin());

CREATE POLICY "Admin actualiza centros"
ON public.centros FOR UPDATE TO authenticated USING (public.is_admin());

CREATE POLICY "Admin elimina centros"
ON public.centros FOR DELETE TO authenticated USING (public.is_admin());

-- ================== Lugares dentro de un centro ==================
ALTER TABLE public.lugares
  ADD COLUMN centro_id UUID REFERENCES public.centros(id) ON DELETE CASCADE;

-- Los lugares que ya se hayan creado van a un centro provisional (renombrarlo
-- desde la app y mover o recrear sus lugares)
DO $$
DECLARE
  v_centro UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.lugares) THEN
    INSERT INTO public.centros (nombre, hora_limite)
    VALUES ('Centro principal', coalesce((SELECT min(hora_limite) FROM public.lugares), '23:00'))
    RETURNING id INTO v_centro;
    UPDATE public.lugares SET centro_id = v_centro;
  END IF;
END;
$$;

ALTER TABLE public.lugares ALTER COLUMN centro_id SET NOT NULL;
ALTER TABLE public.lugares DROP COLUMN hora_limite;

-- El nombre de un lugar no se repite dentro del mismo centro
DROP INDEX public.lugares_nombre_unique;
CREATE UNIQUE INDEX lugares_centro_nombre_unique ON public.lugares (centro_id, lower(nombre));

-- ================== Listas: centro ==================
ALTER TABLE public.scan_lists
  ADD COLUMN centro_id UUID REFERENCES public.centros(id) ON DELETE SET NULL;

UPDATE public.scan_lists l
SET centro_id = g.centro_id
FROM public.lugares g
WHERE g.id = l.lugar_id;

DROP INDEX IF EXISTS public.idx_scan_lists_lugar_activas;
CREATE INDEX idx_scan_lists_centro_activas
ON public.scan_lists (centro_id) WHERE estadia_fin_at IS NULL;

-- ================== Marcado en la puerta (por centro) ==================
DROP FUNCTION public.registrar_movimiento(UUID, TEXT, TEXT);
DROP FUNCTION public.estado_puerta(UUID);

-- Busca al acampante en las listas activas del centro (puede haber varias a la
-- vez) y alterna: si estaba dentro registra la salida, si estaba fuera el
-- reingreso. Funciona con cualquier cuenta de Eventos, aunque la lista la
-- haya creado otra cuenta.
CREATE FUNCTION public.registrar_movimiento(
  p_centro_id UUID,
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
  v_lugar TEXT;
  v_otro_centro TEXT;
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

  -- Lista activa del centro donde está registrado (la de llegada más reciente)
  SELECT r.full_name, l.id, l.title, g.nombre
  INTO v_nombre, v_lista_id, v_lista, v_lugar
  FROM public.scanned_records r
  JOIN public.scan_lists l ON l.id = r.scan_list_id
  LEFT JOIN public.lugares g ON g.id = l.lugar_id
  WHERE r.dni_number = p_dni
    AND l.centro_id = p_centro_id
    AND l.estadia_fin_at IS NULL
  ORDER BY r.scanned_at DESC
  LIMIT 1;

  IF v_lista_id IS NULL THEN
    -- ¿Está en una lista activa de otro centro?
    SELECT r.full_name, l.title, c.nombre
    INTO v_nombre, v_lista, v_otro_centro
    FROM public.scanned_records r
    JOIN public.scan_lists l ON l.id = r.scan_list_id
    LEFT JOIN public.centros c ON c.id = l.centro_id
    WHERE r.dni_number = p_dni AND l.estadia_fin_at IS NULL
    ORDER BY r.scanned_at DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'ok', false,
      'motivo', 'no_pertenece',
      'dni', p_dni,
      'nombre', v_nombre,
      'otro_centro', v_otro_centro,
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
      'lugar', v_lugar,
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
    'lugar', v_lugar,
    'created_at', v_mov.created_at,
    -- En un reingreso: a qué hora había salido
    'salida_at', CASE WHEN v_tipo = 'reingreso' THEN v_ultimo.created_at END,
    'salida_motivo', CASE WHEN v_tipo = 'reingreso' THEN v_ultimo.motivo END
  );
END;
$$;

-- Listas activas del centro con cuántos están dentro y fuera, y quiénes están
-- fuera ahora (con su lugar). Incluye las listas de todas las cuentas.
CREATE FUNCTION public.estado_puerta(p_centro_id UUID)
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
    SELECT l.id, l.title, l.created_at, l.closed_at, g.nombre AS lugar
    FROM public.scan_lists l
    LEFT JOIN public.lugares g ON g.id = l.lugar_id
    WHERE l.centro_id = p_centro_id AND l.estadia_fin_at IS NULL
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
        'lugar', l.lugar,
        'created_at', l.created_at,
        'en_llegada', l.closed_at IS NULL,
        'total', (SELECT count(*) FROM estado e WHERE e.scan_list_id = l.id),
        'fuera', (SELECT count(*) FROM estado e WHERE e.scan_list_id = l.id AND e.fuera)
      ) ORDER BY l.lugar NULLS LAST, l.created_at)
      FROM listas l
    ), '[]'::jsonb),
    'fuera', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.mov_id,
        'dni', e.dni_number,
        'nombre', e.full_name,
        'lista_id', e.scan_list_id,
        'lista', l.title,
        'lugar', l.lugar,
        'salida_at', e.mov_at,
        'motivo', e.motivo
      ) ORDER BY e.mov_at)
      FROM estado e JOIN listas l ON l.id = e.scan_list_id
      WHERE e.fuera
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_movimiento(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.estado_puerta(UUID) TO authenticated;
