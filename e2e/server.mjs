// An isolated loopback-only QA backend. Never reads production credentials or uses a paid model.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const qaDirectory = mkdtempSync(path.join(tmpdir(), 'vf-browser-qa-'));
Object.assign(process.env, {
  VF_SKIP_ENV_FILES: '1',
  DB_PATH: path.join(qaDirectory, 'browser.db'), PORT: '18092', HOST: '127.0.0.1',
  LLM_PROVIDER: 'mock', OPENAI_API_KEY: '', GEMINI_API_KEY: '', EMBEDDINGS: 'local',
  DATA_MODE: 'live', GDELT_ENABLED: 'false', FEATURES: 'x1,x2,x3,x4,x5,x6,x7',
  FII_CSV_PATH: path.join(qaDirectory, 'unavailable-flows.csv'),
  ADMIN_USERNAME: 'qa-owner@example.test', ADMIN_PASSWORD: 'local-browser-only',
  CORS_ORIGINS: 'http://127.0.0.1:5192', VF_FAST: '1', LOG_LEVEL: 'silent', VITEST: 'true',
});
// Recorded source fixtures exercise Live mode without sending any requests to external services.
const fixtures = new URL('../server/test/fixtures/', import.meta.url);
globalThis.fetch = async (input) => {
  const url = String(input);
  if (url.startsWith('https://query1.finance.yahoo.com/')) return new Response(readFileSync(new URL('yahoo-chart.json', fixtures), 'utf8'), { status: 200 });
  if (url.startsWith('https://nsearchives.nseindia.com/')) return new Response(readFileSync(new URL('nse-rss.xml', fixtures), 'utf8'), { status: 200 });
  throw new Error('External requests are disabled in browser QA');
};
const { installLiveLoader } = await import('../server/dist/data/live/fetch.js');
installLiveLoader();
const { createApp } = await import('../server/dist/app.js');
const app = createApp();
const { getDb } = await import('../server/dist/db/db.js');
// Disposable operational fixtures; no paid attempts or production identities are used.
const db = getDb();
db.transaction(() => {
  for (let i=0; i<40; i++) {
    const visitor = `qa-visitor-${String(i).padStart(3, '0')}`, at = new Date(Date.UTC(2026,9,15,10,i)).toISOString();
    db.prepare('INSERT INTO api_usage_visitors VALUES(?,3,0,0,?,?)').run(visitor,at,at);
    db.prepare("INSERT INTO activity_events(visitor_id,method,path,status,duration_ms,created_at) VALUES(?,'POST','/api/qa/fixture',?,12,?)").run(visitor,i%4===0?429:200,at);
    db.prepare("INSERT INTO openai_attempts(visitor_id,model,status,input_tokens,output_tokens,reserved_usd,charged_usd,rates_json,created_at) VALUES(?,'qa-mock','succeeded',100,10,0,0,'{}',?)").run(visitor,at);
  }
})();
app.listen(18092, '127.0.0.1');
