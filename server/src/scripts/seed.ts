import { seedDatabase } from "../db/db.js";

const counts = seedDatabase();
console.log(
  `${counts.tickers} tickers × ${counts.bars} bars, ${counts.sectors} sectors × ${counts.flowRows} flow rows, ${counts.docs} docs, ${counts.chunks} chunks, ${counts.profiles} profiles`,
);
process.exit(0);
