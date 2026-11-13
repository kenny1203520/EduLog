#!/usr/bin/env bash
set -euo pipefail
export MSYS_NO_PATHCONV=1
api_image="${CLASS_SMOKE_API_IMAGE:-edulog-release-smoke:api}"
frontend_image="${CLASS_SMOKE_FRONTEND_IMAGE:-edulog-release-smoke:frontend}"
network="edulog-class-smoke-${RANDOM}-$$"
containers=()
cleanup() {
  for container in "${containers[@]}"; do docker rm -f "$container" >/dev/null 2>&1 || true; done
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
run() {
  local name="$1"; shift
  containers+=("$network-$name")
  docker run -d --name "$network-$name" --network "$network" --network-alias "$name" "$@" >/dev/null
}
secret='edulog-local-release-class-smoke-signing-key'
run db -e POSTGRES_PASSWORD=postgres postgres:15
for attempt in {1..45}; do
  if docker exec "$network-db" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1; then break; fi
  if [[ "$attempt" == 45 ]]; then docker logs "$network-db"; exit 1; fi
  sleep 1
done
sql() { docker exec -i -e 'PGOPTIONS=-c client_min_messages=warning' "$network-db" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }
sql < supabase/tests/postgres_bootstrap.sql
for migration in supabase/migrations/*.sql; do sql < "$migration" >/dev/null; done
{
  sed 's/\r$//; /^SET LOCAL ROLE authenticated;/,$d' supabase/tests/scoped_teaching_access_integration.sql
  cat <<'SQL'
UPDATE public.class_session_teachers SET role_id = (SELECT id FROM public.roles WHERE code = 'assistant' AND domain = 'teaching' AND is_builtin)
WHERE teacher_id = '15800000-0000-4000-8000-0000000000f5';
UPDATE public.user_role_assignments SET role_id = (SELECT id FROM public.roles WHERE code = 'teaching_owner' AND domain = 'teaching' AND is_builtin)
WHERE user_id = '15800000-0000-4000-8000-000000000007';
INSERT INTO public.lessons(id,course_id,title,sequence) VALUES
 ('15800000-0000-4000-8000-0000000000a9','15800000-0000-4000-8000-0000000000d1','Smoke unit',1);
INSERT INTO public.students(id,name) VALUES ('15800000-0000-4000-8000-0000000000a3','Scope Student Three');
INSERT INTO public.enrollments(id,student_id,course_id,classroom_id,class_session_id,status,start_date,lesson_number)
VALUES ('15800000-0000-4000-8000-0000000000b3','15800000-0000-4000-8000-0000000000a3','15800000-0000-4000-8000-0000000000d1',
 '15800000-0000-4000-8000-0000000000c1','15800000-0000-4000-8000-0000000000e1','regular',CURRENT_DATE-30,1);
INSERT INTO public.students(id,name) VALUES ('15800000-0000-4000-8000-0000000000a4','Scope Makeup Student');
UPDATE public.class_sessions SET course_ids = array_append(course_ids, '15800000-0000-4000-8000-0000000000d1'::uuid)
WHERE id = '15800000-0000-4000-8000-0000000000e2';
INSERT INTO public.enrollments(id,student_id,course_id,classroom_id,class_session_id,status,start_date,lesson_number)
VALUES ('15800000-0000-4000-8000-0000000000b4','15800000-0000-4000-8000-0000000000a4','15800000-0000-4000-8000-0000000000d1',
 '15800000-0000-4000-8000-0000000000c2','15800000-0000-4000-8000-0000000000e2','regular',CURRENT_DATE-30,1);
INSERT INTO public.single_lesson_transfers(enrollment_id,source_occurrence_id,target_occurrence_id)
VALUES ('15800000-0000-4000-8000-0000000000b4','15800000-0000-4000-8000-000000000012','15800000-0000-4000-8000-000000000011');
COMMIT;
CREATE ROLE authenticator LOGIN PASSWORD 'postgres' NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
SQL
} | sql >/dev/null
dates="$(sql -Atc 'select current_date-1, current_date+10')"
run rest -e PGRST_DB_URI=postgres://authenticator:postgres@db:5432/postgres \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$secret" postgrest/postgrest:v14.18
# Stub only Auth /user; REST calls go to the real PostgREST and PostgreSQL.
run gateway -e SMOKE_SECRET="$secret" --entrypoint node "$api_image" -e '
const http=require("node:http"), crypto=require("node:crypto")
http.createServer(async (req,res)=>{
  const url=new URL(req.url,"http://gateway")
  if (url.pathname==="/auth/v1/user") {
    const token=req.headers.authorization?.split(" ")[1] || ""
    const [h,p,s]=token.split(".")
    if (!s || crypto.createHmac("sha256",process.env.SMOKE_SECRET).update(h+"."+p).digest("base64url")!==s) {res.writeHead(401).end();return}
    const {sub}=JSON.parse(Buffer.from(p,"base64url"))
    res.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({id:sub,email:"smoke@example.test",app_metadata:{},user_metadata:{},aud:"authenticated"}));return
  }
  if (!url.pathname.startsWith("/rest/v1/")) {res.writeHead(404).end();return}
  const headers={...req.headers}; delete headers.host
  const upstream=http.request("http://rest:3000"+url.pathname.slice(8)+url.search,{method:req.method,headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)})
  upstream.on("error",()=>res.writeHead(502).end())
  req.pipe(upstream)
}).listen(8000)'
token() {
  SMOKE_SECRET="$secret" node -e '
    const c=require("node:crypto"); const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url")
    const v=b({alg:"HS256",typ:"JWT"})+"."+b({role:process.argv[1],sub:process.argv[2],aud:"authenticated",exp:Math.floor(Date.now()/1000)+3600})
    console.log(v+"."+c.createHmac("sha256",process.env.SMOKE_SECRET).update(v).digest("base64url"))
  ' "$@"
}
run api -e SUPABASE_URL=http://gateway:8000 -e SUPABASE_ANON_KEY="$(token anon)" \
  -e SUPABASE_SERVICE_ROLE_KEY="$(token service_role)" -e SUPABASE_JWT_SECRET="$secret" \
  -e COOKIE_SECRET=release-smoke-cookie-secret-at-least-32-characters \
  -e EDULOG_WEB_BASE_URL=https://edulog.example.test -e API_ALLOWED_ORIGINS=https://edulog.example.test \
  -e RATE_LIMIT_STORE=supabase "$api_image"
run frontend "$frontend_image"
for attempt in {1..45}; do
  if docker exec "$network-frontend" wget -q -O /dev/null http://127.0.0.1:4173/api/healthz; then break; fi
  if [[ "$attempt" == 45 ]]; then docker logs "$network-api"; exit 1; fi
  sleep 1
done
export SMOKE_DATE="${dates%|*}" SMOKE_HOLIDAY="${dates#*|}"
for pair in 7:owner 2:teacher 5:assistant 4:outsider; do
  actor="15800000-0000-4000-8000-00000000000${pair%:*}"
  # The origin is confined to this private test network and uses synthetic credentials.
  docker exec -i -e SMOKE_API_ORIGIN=http://frontend:4173 -e SMOKE_DATE -e SMOKE_HOLIDAY -e ACTOR="${pair#*:}" -e TOKEN="$(token authenticated "$actor")" "$network-api" node --input-type=module - < scripts/release/class-smoke.mjs
done
