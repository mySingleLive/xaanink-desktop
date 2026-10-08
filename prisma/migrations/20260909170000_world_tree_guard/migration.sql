-- 先执行 scripts/audit-world-tree.ts。保留全部 legacy 异常，仅守卫新建/改名/移动。
-- 不在存量重复上建立会失败的唯一键；按小说的事务 advisory lock 覆盖 NULL 根级语义。
BEGIN;
CREATE FUNCTION world_normalized_name(value text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT btrim(value, U&' \0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
CREATE INDEX "World_normalized_sibling_lookup" ON "World" ("novelId", "parentId", world_normalized_name(name));
CREATE FUNCTION guard_world_tree() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cursor_id text; cursor_novel text; seen text[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."novelId" IS DISTINCT FROM OLD."novelId" THEN RAISE EXCEPTION 'WORLD_SCOPE_IMMUTABLE'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name AND NEW."parentId" IS NOT DISTINCT FROM OLD."parentId" THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('world-tree:' || NEW."novelId", 0));
  NEW.name := world_normalized_name(NEW.name);
  IF NEW.name IS NULL OR length(NEW.name) = 0 OR length(NEW.name) > 100 OR lower(NEW.name) IN ('null', 'undefined', '[object object]') THEN RAISE EXCEPTION 'WORLD_INVALID_NAME'; END IF;
  IF EXISTS (SELECT 1 FROM "World" w WHERE w."novelId" = NEW."novelId" AND w."parentId" IS NOT DISTINCT FROM NEW."parentId" AND world_normalized_name(w.name) = NEW.name AND w.id <> NEW.id) THEN RAISE EXCEPTION 'WORLD_NAME_CONFLICT'; END IF;
  cursor_id := NEW."parentId"; seen := ARRAY[NEW.id];
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = ANY(seen) THEN RAISE EXCEPTION 'WORLD_CYCLE'; END IF;
    seen := array_append(seen, cursor_id);
    SELECT w."novelId", w."parentId" INTO cursor_novel, cursor_id FROM "World" w WHERE w.id = cursor_id;
    IF NOT FOUND OR cursor_novel <> NEW."novelId" THEN RAISE EXCEPTION 'WORLD_INVALID_PARENT'; END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER "World_tree_guard" BEFORE INSERT OR UPDATE ON "World" FOR EACH ROW EXECUTE FUNCTION guard_world_tree();
COMMIT;
