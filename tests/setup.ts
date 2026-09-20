// Runs before every test file: point the app at a separate *test* database and refuse anything else.
// The tests use the local embedded Postgres (npm run db:start); nothing here belongs in .env.
const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:54329/daybook_test";
if (!/_test(\?|$)/.test(url)) throw new Error("The test database name must end in _test");
process.env.DATABASE_URL = url;
