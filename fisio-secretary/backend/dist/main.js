"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bodyParser: false });
    const rawBodyBuffer = (req, res, buf) => { req.rawBody = buf; };
    app.use(require('express').json({ limit: '10mb', verify: rawBodyBuffer }));
    app.use(require('express').urlencoded({ extended: true, limit: '10mb' }));
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true }));
    app.enableCors();
    await app.listen(3000);
    console.log('Backend rodando na porta 3000');
}
bootstrap();
//# sourceMappingURL=main.js.map