import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Os Workers do BullMQ fecham no onApplicationShutdown. Sem isso, um SIGTERM
  // (redeploy) mata o processo com job em andamento e ele só é reprocessado
  // depois de ficar "stalled" — com os hooks, o worker devolve o job na hora.
  app.enableShutdownHooks();
  const rawBodyBuffer = (req, res, buf) => { req.rawBody = buf; };
  app.use(require('express').json({ limit: '10mb', verify: rawBodyBuffer }));
  app.use(require('express').urlencoded({ extended: true, limit: '10mb' }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  const frontendUrl = process.env.FRONTEND_URL;
  app.enableCors({
    // Libera o FRONTEND_URL (prod) + qualquer localhost/127.0.0.1 em qualquer porta (dev).
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl, mobile, server-to-server
      if (frontendUrl && origin === frontendUrl) return cb(null, true);
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Backend rodando na porta ${port}`);
}
bootstrap();
