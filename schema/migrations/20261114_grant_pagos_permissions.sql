-- Permisos de la tabla pagos: el docente lee sus pagos (RLS filtra por docente_id)
-- y el backend (service_role) los registra desde el webhook.
GRANT SELECT ON pagos TO authenticated;
GRANT ALL ON pagos TO service_role;
