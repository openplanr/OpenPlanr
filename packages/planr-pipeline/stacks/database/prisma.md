# Stack: Prisma ORM

> **Category:** database
> **Version:** 5.x / 6.x
> **Docs:** https://www.prisma.io/docs
> **Created:** Template — copy to `.claude/stacks/database/prisma.md` in your project to override.

---

## Overview

Prisma is a next-generation ORM for Node.js and TypeScript.
Schema-first: define your data model in `prisma/schema.prisma`,
generate a type-safe client, run migrations.

---

## Project Structure

```
prisma/
├── schema.prisma            ← Data model definition
├── migrations/              ← Auto-generated migration history
│   └── {timestamp}_{name}/
│       └── migration.sql
└── seed.ts                  ← Database seed script (optional)

src/
└── lib/
    └── prisma.ts            ← PrismaClient singleton
```

---

## Core Files

### Prisma Client Singleton
```typescript
// src/lib/prisma.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ['query'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

### Schema Pattern
```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"  // or mysql, sqlite, sqlserver
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  posts     Post[]
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  published Boolean  @default(false)
  authorId  Int
  author    User     @relation(fields: [authorId], references: [id])
}
```

---

## Code Patterns

### Query patterns
```typescript
// Create
const user = await prisma.user.create({ data: { email, name } })

// Read many with filter
const users = await prisma.user.findMany({
  where: { email: { contains: '@example.com' } },
  include: { posts: true },
  orderBy: { createdAt: 'desc' },
  take: 10,
  skip: 0,
})

// Update
const updated = await prisma.user.update({
  where: { id },
  data: { name: 'New Name' },
})

// Soft delete (if using deletedAt pattern)
await prisma.user.update({
  where: { id },
  data: { deletedAt: new Date() },
})

// Transaction
await prisma.$transaction([
  prisma.user.create({ data: userData }),
  prisma.post.create({ data: postData }),
])
```

---

## Migration Commands

```bash
# Create + apply migration
npx prisma migrate dev --name {migration_name}

# Apply to production
npx prisma migrate deploy

# Reset (dev only — destroys data)
npx prisma migrate reset

# Generate client after schema change
npx prisma generate

# Open Prisma Studio
npx prisma studio
```

---

## Integration Points

- Connect via `DATABASE_URL` env var
- Import `prisma` singleton from `src/lib/prisma.ts`
- Use `@prisma/client` types for full type safety
- Run `prisma generate` after every schema change

---

## Agent Usage Notes

- Schema file: `prisma/schema.prisma` — Backend Agent modifies this for new models
- Client import: `import { prisma } from '@/lib/prisma'`
- After schema changes: agent must note "Run `npx prisma migrate dev`"
- Types: use generated Prisma types — never manually type DB entities
