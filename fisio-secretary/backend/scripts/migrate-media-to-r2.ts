/**
 * Migra os arquivos de mídia existentes do Supabase Storage pro Cloudflare R2.
 * Script avulso — não faz parte do app, roda uma vez via `npx ts-node scripts/migrate-media-to-r2.ts`.
 *
 * Idempotente: pula qualquer linha cuja `url` já aponte pro R2_PUBLIC_URL.
 * Não apaga nada do Supabase Storage — só copia e atualiza a `url` no banco.
 *
 * Precisa de todas as env vars (Supabase antigo + R2 novo) carregadas — usa o
 * SUPABASE_DATABASE_URL do .env apontado (defina ENV_FILE=.env pra produção
 * ou ENV_FILE=.env.development pra local, senão usa o .env padrão do dotenv).
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env' });

import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

async function main() {
  const dbUrl = process.env.SUPABASE_DATABASE_URL;
  if (!dbUrl) throw new Error('SUPABASE_DATABASE_URL não configurado');

  const supabase = createClient(
    process.env.SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  );
  const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'fisio-media';

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  });
  const r2Bucket = process.env.R2_BUCKET ?? '';
  const r2PublicUrl = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  if (!r2Bucket || !r2PublicUrl) throw new Error('R2_BUCKET / R2_PUBLIC_URL não configurados');

  const db = new Client({ connectionString: dbUrl });
  await db.connect();

  const { rows } = await db.query(
    `SELECT id, name, storage_path, mime_type, url FROM media_files WHERE url NOT LIKE $1 ORDER BY created_at`,
    [`${r2PublicUrl}%`],
  );

  console.log(`${rows.length} arquivo(s) pra migrar (já migrados são pulados automaticamente).`);

  let ok = 0;
  let fail = 0;

  for (const row of rows) {
    try {
      const { data, error } = await supabase.storage.from(supabaseBucket).download(row.storage_path);
      if (error || !data) throw new Error(error?.message || 'download vazio');

      const buffer = Buffer.from(await data.arrayBuffer());

      await s3.send(new PutObjectCommand({
        Bucket: r2Bucket,
        Key: row.storage_path,
        Body: buffer,
        ContentType: row.mime_type || 'application/octet-stream',
      }));

      const newUrl = `${r2PublicUrl}/${row.storage_path}`;
      await db.query(`UPDATE media_files SET url = $1 WHERE id = $2`, [newUrl, row.id]);

      console.log(`✅ ${row.name} (${(buffer.length / 1024 / 1024).toFixed(1)}MB) → ${newUrl}`);
      ok++;
    } catch (err: any) {
      console.error(`❌ ${row.name}: ${err.message}`);
      fail++;
    }
  }

  console.log(`\nConcluído: ${ok} migrados, ${fail} falharam.`);
  await db.end();
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
