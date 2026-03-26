import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const rawBodyBuffer = (req, res, buf) => { req.rawBody = buf; };
  app.use(require('express').json({ limit: '10mb', verify: rawBodyBuffer }));
  app.use(require('express').urlencoded({ extended: true, limit: '10mb' }));

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableCors();

  await app.listen(3000);
  console.log('Backend rodando na porta 3000');
}
bootstrap();
