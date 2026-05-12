-- Execute este bloco somente se a coluna privacy_terms_accepted ja tiver sido criada.
-- Seguro para repetir: nao altera auth.users, nao remove profiles e nao afeta FKs.

alter table public.profiles
  drop column if exists privacy_terms_accepted;
