# Stack: Next.js (App Router)

> **Category:** frontend
> **Version:** 14.x / 15.x
> **Docs:** https://nextjs.org/docs
> **Created:** Template — edit via /discover-stack frontend

---

## Overview

Next.js with the App Router is a React framework for production.
Server Components by default, Client Components opt-in with `"use client"`.
File-system based routing. Built-in API routes via Route Handlers.

---

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              ← Root layout (Server Component)
│   ├── page.tsx                ← Root page
│   ├── (auth)/                 ← Route group (no URL segment)
│   │   ├── login/
│   │   │   └── page.tsx
│   │   └── register/
│   │       └── page.tsx
│   ├── dashboard/
│   │   ├── layout.tsx          ← Nested layout
│   │   └── page.tsx
│   └── api/
│       └── [resource]/
│           └── route.ts        ← Route Handler (GET, POST, etc.)
├── components/
│   ├── ui/                     ← Primitive UI components
│   └── features/               ← Feature-specific components
├── features/
│   └── {feature}/
│       ├── components/         ← Feature components
│       ├── hooks/              ← Custom hooks
│       ├── store/              ← State (Zustand, etc.)
│       ├── actions/            ← Server Actions
│       └── types.ts
├── lib/
│   ├── api/                    ← API client utilities
│   ├── utils.ts                ← Shared utilities
│   └── validations/            ← Zod schemas
└── types/
    └── index.ts                ← Global type definitions
```

---

## Code Patterns

### Server Component (default)
```typescript
// app/dashboard/page.tsx
export default async function DashboardPage() {
  const data = await fetchData() // direct async call, no useEffect
  return <div>{/* render */}</div>
}
```

### Client Component
```typescript
// components/features/SomeInteractiveComponent.tsx
"use client"
import { useState } from 'react'

export function SomeInteractiveComponent() {
  const [state, setState] = useState(...)
  return <div>{/* render */}</div>
}
```

### Route Handler
```typescript
// app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  return NextResponse.json({ users: [] })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  return NextResponse.json({ created: true }, { status: 201 })
}
```

### Server Action
```typescript
// features/{feature}/actions/{feature}.actions.ts
"use server"
import { revalidatePath } from 'next/cache'

export async function createItem(formData: FormData) {
  // mutation logic
  revalidatePath('/dashboard')
}
```

---

## Integration Points

- Database: via ORM in `lib/db.ts` (Prisma, Drizzle, etc.)
- Auth: via `middleware.ts` + session cookies or NextAuth
- State: Zustand store in `features/{feature}/store/`
- Forms: React Hook Form + Zod in `features/{feature}/`
- HTTP calls from Server Components: native fetch with Next.js caching headers

---

## Agent Usage Notes

- File path pattern: `src/app/{route}/page.tsx` for pages
- Component pattern: `src/features/{feature}/components/{ComponentName}.tsx`
- Test files: `{name}.test.tsx` co-located or in `__tests__/`
- Key imports: `next/navigation`, `next/image`, `next/link`, `next/headers`
