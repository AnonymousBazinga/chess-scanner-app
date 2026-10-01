// Loads ./.env before anything reads process.env. Imported first by index.ts.
try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the real environment.
}
