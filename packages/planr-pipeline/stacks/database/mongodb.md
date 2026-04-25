# Stack: MongoDB

> **Category:** database
> **Version:** 7.x
> **Docs:** https://www.mongodb.com/docs/
> **Created:** Template — edit via /discover-stack database

---

## Overview

MongoDB is a document-oriented NoSQL database. Stores BSON documents in collections.
No fixed schema — documents in the same collection can have different shapes,
but in practice teams enforce shape via Mongoose, Prisma, or application-level validation.

This framework expects an **application-level shape contract** (Mongoose schema, Zod, Prisma)
to exist. The DB Agent introspects collections by sampling documents — it does NOT
enforce or migrate shape.

---

## Recommended Pairing

| Layer | Recommendation |
|-------|----------------|
| Backend ODM | Mongoose (default) or Prisma (with mongodb provider) |
| Validation | Zod or class-validator (NestJS) |
| Migrations | migrate-mongo or none (schemaless) |

---

## Connection Conventions

```yaml
DB_HOST: "${MONGO_HOST}"             # e.g. cluster0.mongodb.net or localhost
DB_PORT: "${MONGO_PORT}"             # 27017 default
DB_NAME: "${MONGO_DB}"
DB_USER: "${MONGO_USER}"
DB_PASSWORD: "${MONGO_PASSWORD}"

# Connection string assembled by the application:
# mongodb+srv://USER:PASS@HOST/DB?retryWrites=true&w=majority
```

---

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Collection | camelCase plural | `users`, `orderItems` |
| Field | camelCase | `createdAt`, `userId` |
| `_id` | Always ObjectId unless schema explicitly typed | `ObjectId('...')` |
| References | `{singular}Id: ObjectId` | `userId: ObjectId` references `users._id` |

---

## DB Agent Introspection (READ-ONLY)

The DB Agent samples up to 100 documents per collection to infer field shape:

```javascript
// for each collection:
db.<coll>.find({}, { _id: 0 }).limit(100).toArray()  // sample
db.<coll>.getIndexes()                               // indexes
```

Inferred output in `output/db/schema.json`:
- `tables[i].name` = collection name
- `tables[i].columns[j]` = field name + observed BSON type(s)
- `tables[i].columns[j].nullable` = true if absent in any sampled doc
- `tables[i].foreignKeys` = best-effort, based on `*Id` field naming convention
- `tables[i].indexes` = from getIndexes()

Mongo has no FKs at the engine level. Relationships are application contracts.

---

## Code Generation Hints

### Mongoose Schema (default)
```typescript
// src/features/{feature}/{feature}.schema.ts
import { Schema, model } from 'mongoose';

const {Feature}Schema = new Schema({
  name: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

export const {Feature} = model('{Feature}', {Feature}Schema);
```

### Prisma (mongodb provider)
```prisma
// prisma/schema.prisma
datasource db {
  provider = "mongodb"
  url      = env("DATABASE_URL")
}

model {Feature} {
  id     String @id @default(auto()) @map("_id") @db.ObjectId
  name   String
  userId String @db.ObjectId
  user   User   @relation(fields: [userId], references: [id])
}
```

---

## Constraints for DEV Agents

- ❌ Never `db.collection.drop()` or `dropDatabase()`
- ❌ Never write migrations that delete fields without explicit task spec
- ✅ Always set `timestamps: true` on Mongoose schemas (createdAt, updatedAt)
- ✅ Always add an index on FK-equivalent fields (`*Id`)
- ✅ Use ObjectId for `_id` unless task explicitly types it (e.g. UUID, slug)

---

*Used by: DB Agent · Backend Agent*
