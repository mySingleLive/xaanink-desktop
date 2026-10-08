import assert from "node:assert/strict"
import { test } from "node:test"
import { assertMigrationTransactionBoundary as check } from "../../desktop/service/database/sql-boundary"

test("ADAPTER-08: SQL transaction guard distinguishes top-level commands from comments and PL/pgSQL", () => {
  for (const sql of ["/* BEGIN; /* COMMIT; */ */ SELECT 'COMMIT;'; -- ROLLBACK;\n SELECT 1", "DO $body$ BEGIN RAISE NOTICE 'COMMIT;'; END $body$;", "CREATE TABLE \"COMMIT\" (\"ROLLBACK\" TEXT)", "SELECT E'escaped\\\' COMMIT;'; SELECT 1", "SELECT 'a\\'; SELECT 1"]) assert.doesNotThrow(() => check(sql))
  for (const sql of ["SELECT 1; COMMIT;", "/*comment*/ END;", "START /*x*/ TRANSACTION;", "PREPARE TRANSACTION 'x';", "SELECT 'a\\'; COMMIT; --'"]) assert.throws(() => check(sql), /transaction control/)
  for (const sql of ["SET standard_conforming_strings=off", "SET LOCAL backslash_quote=on", 'SET "standard_conforming_strings"=off']) assert.throws(() => check(sql), /literal parsing/)
  for (const identifier of ["a$tag$", "字段$tag$"]) assert.throws(() => check(`CREATE TABLE ${identifier}(id INT); COMMIT; DROP TABLE ${identifier}; SELECT * FROM nonexistent_table`), /transaction control/)
})
