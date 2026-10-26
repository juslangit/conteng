-- Conteng: a shared doodle board. Lives in the Sky AI Brain project (decided 2026-10-26).
-- The app only holds the publishable key, so the table has RLS on and no policies:
-- every read and write goes through the functions below, which need the room code.
-- Knowing the room code is the only "login" — keep it long and random.

create table if not exists public.conteng_strokes (
  id         uuid primary key,
  room       text not null check (length(room) between 12 and 64),
  author     text not null check (length(author) between 1 and 40),
  stroke     jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists conteng_strokes_room_idx on public.conteng_strokes (room, created_at);
alter table public.conteng_strokes enable row level security;
revoke all on public.conteng_strokes from anon, authenticated;

-- Every stroke on the board, oldest first.
create or replace function public.conteng_load(p_room text)
returns table (id uuid, author text, stroke jsonb)
language sql stable security definer set search_path = public as $$
  select s.id, s.author, s.stroke from conteng_strokes s
  where s.room = p_room and length(p_room) >= 12
  order by s.created_at, s.id
  limit 5000;
$$;

-- Save one finished stroke. Capped so one room cannot fill the database.
create or replace function public.conteng_add(p_room text, p_id uuid, p_author text, p_stroke jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(p_room) < 12 then raise exception 'room code too short'; end if;
  if jsonb_typeof(p_stroke->'points') <> 'array' or jsonb_array_length(p_stroke->'points') > 4000 then
    raise exception 'bad stroke';
  end if;
  if (select count(*) from conteng_strokes where room = p_room) >= 5000 then
    raise exception 'board is full, clear it first';
  end if;
  insert into conteng_strokes (id, room, author, stroke) values (p_id, p_room, p_author, p_stroke)
  on conflict (id) do nothing;
end;
$$;

-- Undo removes one stroke by id.
create or replace function public.conteng_remove(p_room text, p_id uuid)
returns void
language sql security definer set search_path = public as $$
  delete from conteng_strokes where room = p_room and id = p_id;
$$;

-- Clear wipes the board for everyone in the room.
create or replace function public.conteng_clear(p_room text)
returns void
language sql security definer set search_path = public as $$
  delete from conteng_strokes where room = p_room and length(p_room) >= 12;
$$;

revoke all on function public.conteng_load(text), public.conteng_add(text, uuid, text, jsonb),
  public.conteng_remove(text, uuid), public.conteng_clear(text) from public;
grant execute on function public.conteng_load(text), public.conteng_add(text, uuid, text, jsonb),
  public.conteng_remove(text, uuid), public.conteng_clear(text) to anon, authenticated;
