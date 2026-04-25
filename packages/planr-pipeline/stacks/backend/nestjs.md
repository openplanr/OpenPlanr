# Stack: NestJS

> **Category:** backend
> **Version:** 10.x
> **Docs:** https://docs.nestjs.com
> **Created:** Template — edit via /discover-stack backend

---

## Overview

NestJS is a progressive Node.js framework for building server-side applications.
Uses TypeScript, decorators, and dependency injection.
Modular architecture with feature modules.

---

## Project Structure

```
src/
├── main.ts                      ← Entry point
├── app.module.ts                ← Root module
├── common/
│   ├── decorators/              ← Custom decorators
│   ├── filters/                 ← Exception filters
│   ├── guards/                  ← Auth guards
│   ├── interceptors/            ← Request/response interceptors
│   ├── middleware/              ← Middleware
│   └── pipes/                   ← Validation pipes
├── config/
│   └── configuration.ts         ← App config (env vars)
└── features/
    └── {feature}/
        ├── {feature}.module.ts
        ├── {feature}.controller.ts
        ├── {feature}.service.ts
        ├── dto/
        │   ├── create-{feature}.dto.ts
        │   └── update-{feature}.dto.ts
        ├── entities/
        │   └── {feature}.entity.ts
        └── {feature}.service.spec.ts
```

---

## Code Patterns

### Module
```typescript
// features/{feature}/{feature}.module.ts
@Module({
  imports: [TypeOrmModule.forFeature([{Feature}Entity])],
  controllers: [{Feature}Controller],
  providers: [{Feature}Service],
  exports: [{Feature}Service],
})
export class {Feature}Module {}
```

### Controller
```typescript
// features/{feature}/{feature}.controller.ts
@ApiTags('{feature}')
@Controller('{feature}')
export class {Feature}Controller {
  constructor(private readonly service: {Feature}Service) {}

  @Get()
  findAll(): Promise<{Feature}Entity[]> {
    return this.service.findAll()
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: Create{Feature}Dto): Promise<{Feature}Entity> {
    return this.service.create(dto)
  }
}
```

### Service
```typescript
// features/{feature}/{feature}.service.ts
@Injectable()
export class {Feature}Service {
  constructor(
    @InjectRepository({Feature}Entity)
    private readonly repo: Repository<{Feature}Entity>,
  ) {}

  async findAll(): Promise<{Feature}Entity[]> {
    return this.repo.find()
  }
}
```

### DTO
```typescript
// features/{feature}/dto/create-{feature}.dto.ts
import { IsString, IsNotEmpty, IsEmail } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class Create{Feature}Dto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string
}
```

---

## Integration Points

- Database: TypeORM (configured in app.module.ts)
- Validation: class-validator + class-transformer via ValidationPipe
- Auth: Passport.js strategies + JWT guard
- Docs: Swagger via @nestjs/swagger
- Config: @nestjs/config + .env files

---

## Agent Usage Notes

- Module path: `src/features/{feature}/{feature}.module.ts`
- Always create module + controller + service + dto as a unit
- Test file: `{feature}.service.spec.ts` co-located with service
- Register new module in `app.module.ts` imports array
