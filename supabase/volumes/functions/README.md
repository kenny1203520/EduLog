Aggregate Functions
===================

This folder contains Supabase Edge Functions used to aggregate multiple DB queries into a single HTTP request to reduce client-side roundtrips.

Functions:
- `aggregate-user-preferences` - returns `{ preferences, visibility }` for the authenticated user. Requires `Authorization: Bearer <access_token>` header. Uses `SUPABASE_SERVICE_ROLE_KEY` to query DB.
- `aggregate-student-reports` - returns `{ enrollment, reports, count }` for a given `enrollment_id` query parameter. Requires `Authorization: Bearer <access_token>` header.

Env requirements for running/deploying the functions:
- `SUPABASE_URL` - your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` or `SERVICE_ROLE_KEY` - service role key (keep secret)

Example curl (aggregate-user-preferences):

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  https://<functions-host>/aggregate-user-preferences
```

Example curl (aggregate-student-reports):

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
  "https://<functions-host>/aggregate-student-reports?enrollment_id=<ENROLLMENT_ID>&page=1&perPage=50"
```

Frontend usage
--------------
If you host functions at a base URL, set `VITE_SUPABASE_FUNCTIONS_BASE_URL` in your front-end env. Otherwise the client will call `/<function-name>`.

AggregateService methods are available at `app/src/services/AggregateService.ts`.
