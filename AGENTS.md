# SERVER KNOWLEDGE BASE

## OVERVIEW
NestJS backend with Drizzle ORM and MySQL.
- **Framework:** NestJS (Modules, Controllers, Services).
- **Database:** MySQL via Drizzle ORM.
- **Auth:** Passport (JWT strategy).

## STRUCTURE
```
src/
├── feature/       # Domain-Driven Modules
│   ├── [feature]/
│   │   ├── *.controller.ts      # HTTP Routes
│   │   ├── *.service.ts         # Business Logic
│   │   ├── *.public.service.ts  # Facade for other modules
│   │   ├── *.repository.ts      # Data Access
│   │   └── *.module.ts          # Dependency Injection
├── db/
│   └── schema/    # Drizzle ORM schema definitions
├── tools/         # Shared utilities (Mailer, File, PDF)
└── main.ts        # Entry point
```

## CONVENTIONS
- **Modularity:** Strict encapsulation. Use `*.public.service.ts` for inter-module communication.
- **Database:**
  - Define schemas in `src/db/schema`.
  - Inject `DBModule` (Drizzle pool) into repositories.
- **Validation:** Use DTOs with `class-validator` and `zod`.

## ANTI-PATTERNS
- **Fat Controllers:** Keep controllers thin. Logic goes in Services.
- **Direct Service Access:** Do not import private services across modules. Use public facades.
- **Raw SQL:** Use Drizzle query builder API.
