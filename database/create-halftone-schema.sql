-- Execute este script uma vez no banco usado pela plataforma.
-- O nome entre aspas preserva a capitalizacao "Halftone".
CREATE SCHEMA IF NOT EXISTS "Halftone" AUTHORIZATION hdpontes;

GRANT USAGE, CREATE ON SCHEMA "Halftone" TO hdpontes;