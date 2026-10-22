# PMS Backend

Backend del **Sistema de Gestión de Proyectos (PMS)**: API REST para administrar usuarios, roles, proyectos, tareas y
comentarios, con autenticación JWT, control de acceso por roles (RBAC), caché, colas, mensajería, procesamiento de
eventos y cómputo en hilos. Construido con **Node.js + TypeScript + Express + TypeORM (PostgreSQL)** siguiendo el
material del curso de arquitectura backend y sistemas intensivos en datos.

## Stack

| Área | Tecnología |
|---|---|
| Runtime / lenguaje | Node.js 20+, TypeScript, `ts-node` |
| Servidor HTTP | Express (modo cluster) |
| Base de datos | PostgreSQL + TypeORM (índices B-Tree, triggers de CDC) |
| Autenticación | JSON Web Tokens (JWT) + bcrypt |
| Caché | Redis |
| Colas / correo | Bull + Redis, Nodemailer (Gmail o SMTP de pruebas) |
| Mensajería | RabbitMQ (`amqplib`) |
| Almacenamiento | Disco, S3 (LocalStack), LevelDB, motor de registro propio |
| Concurrencia | `worker_threads`, `child_process`, `SharedArrayBuffer` + `Atomics` |
| Pruebas | Mocha + Chai + Supertest + Sinon, nyc |
| Despliegue | `javascript-obfuscator`, PM2, servidor EC2 simulado, LocalStack |

## Estructura del proyecto

```
.
├── src/
│   ├── main.ts, app.ts, express_server.ts   # Entrada (cluster), configuración de Express y arranque
│   ├── components/        # Módulos HTTP: users, roles, projects, tasks, comments, audit, analytics, health
│   ├── domain/            # Capa de dominio: entidad Task, máquina de estados, errores, costos (cap. 12-13)
│   ├── use-cases/         # Casos de uso (cap. 13)
│   ├── adapters/          # Repositorios PostgreSQL / memoria, SMS, notificaciones (cap. 11, 13)
│   ├── infrastructure/    # Composición de dependencias (cap. 13)
│   ├── factories/ proxies/ builders/ decorators/ repositories/   # Patrones del capítulo 11
│   ├── commands/ core/ reports/                                  # Patrones del capítulo 12
│   ├── engines/           # LevelDB y motor Bitcask (cap. 14)
│   ├── messaging/         # RabbitMQ: eventos, consumidores (cap. 16)
│   ├── events/            # CDC, Event Sourcing, CQRS, ventanas (cap. 17)
│   ├── workers/           # Procesos y hilos: actividad, auditoría, notificaciones, proyector, riesgo
│   ├── services/ utils/ config/ diagnostics/
├── tests/                 # unit/api con dobles de prueba + integration contra servicios reales
├── scripts/               # mkpackage, obfuscate, deploy, aws/ (LocalStack), docker/ec2-sim
├── md/                    # Notas del curso (ignoradas por git)
├── ecosystem.config.js    # PM2: API (cluster) y microservicios
├── server_config.example.json, .env.example
```

## Requisitos

- Node.js 20+ y PostgreSQL.
- **Opcionales** (la API funciona sin ellos, con menos capacidades): Redis (caché y cola de correo), RabbitMQ (eventos de dominio),
  un SMTP (Gmail o [Mailpit](https://mailpit.axllent.org/)), LocalStack (S3/EC2 simulados), podman o docker.
- Todos los servicios de apoyo se pueden levantar con contenedores; las pruebas de integración los detectan y se omiten si faltan.

## Configuración

La conexión a PostgreSQL y el puerto se definen en `server_config.json`:

```json
{
    "port": 3000,
    "db_config": {
        "db": "postgres",
        "username": "postgres",
        "password": "TU_PASSWORD",
        "host": "localhost",
        "port": 5432,
        "dbname": "pms_db"
    }
}
```

> Nota: `server_config.json` está **ignorado por git** (contiene credenciales). Ajusta
> los valores a tu entorno local.

## Instalación

```bash
npm install
```

## Ejecución

```bash
# Inicializa roles y usuario por defecto (SuperAdmin)
npx ts-node src/main.ts --init

# Arranca el servidor (modo cluster, un worker por CPU)
npx ts-node src/main.ts
```

El servidor queda escuchando en el puerto configurado (por defecto `3000`). Health check: `GET /ping` -> `pong`; `GET /api/health` informa PostgreSQL,
Redis, RabbitMQ, el event loop y el pool de hilos.

Procesos independientes (cada uno se puede escalar o reiniciar por separado; `ecosystem.config.js` los arranca todos con PM2):

```bash
npm run activity        # servicio de actividad (LevelDB + motor Bitcask)            cap. 14
npm run audit           # microservicio de auditoría (RabbitMQ)                      cap. 16
npm run notifications   # microservicio de notificaciones (RabbitMQ)                 cap. 16
npm run projector       # proyector CQRS sobre el log de cambios (CDC)               cap. 17
```

## API

Todas las rutas (excepto login/recuperación de contraseña) requieren un token JWT
válido en la cabecera `Authorization`.

| Recurso | Endpoint base | Operaciones |
|---|---|---|
| Roles | `/api/roles` | `GET`, `POST`, `GET/PUT/DELETE /:id` |
| Usuarios | `/api/users` | `POST /login`, `POST /refresh-token`, `POST /change-password`, `POST /forgot-password`, `POST /reset-password`, `GET/POST`, `GET/PUT/DELETE /:id` |
| Proyectos | `/api/projects` | `GET/POST`, `GET/PUT/DELETE /:id`, `GET /with-default-task` |
| Tareas | `/api/tasks` | `GET/POST`, `GET/PUT/DELETE /:id`, `PUT /:id/status` |
| Comentarios | `/api/comments` | `GET/POST`, `GET/PUT/DELETE /:id` |

## Express: seguridad, rendimiento y errores (capítulo 3)

Toda la configuración de Express vive en `createApp()` (`src/app.ts`), que usan tanto el servidor como las pruebas
(antes estaba duplicada, así que lo que se probaba no era exactamente lo que corría). Orden de la cadena:

| Paso | Qué hace |
|---|---|
| **Helmet** | Cabeceras defensivas: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`...; sin `X-Powered-By` |
| **compression** | Gzip/Brotli en respuestas de más de 1 KB |
| **express-rate-limit** | Límite general de `/api/` (`RATE_LIMIT_MAX`, 1000 por 15 min y por IP) y límite estricto contra fuerza bruta en `login`, `forgot-password`, `reset-password` y `refresh-token` (`LOGIN_RATE_LIMIT_MAX`, 10): en el login **solo cuentan los intentos fallidos**. Responde 429 con las cabeceras `RateLimit-*` |
| Cuerpo | JSON y formularios limitados a 50 KB (los adjuntos viajan por una ruta aparte de hasta 10 MB) |
| Rutas | Los enrutadores modulares de cada componente |
| **404 y errores** | `src/middlewares/error.middleware.ts`: ruta inexistente, JSON mal formado (400), cuerpo demasiado grande (413) y errores inesperados (500) responden siempre en JSON; la traza de pila solo en `NODE_ENV=development` y en producción no se filtra el mensaje interno |

Limitación: con el cluster cada proceso lleva su propio contador de tasa, de modo que el límite efectivo se multiplica por el número de procesos
(para un contador compartido haría falta un almacén en Redis). Como el límite es por IP, varios usuarios tras la misma IP comparten los intentos fallidos.

## Adjuntos de tareas y patrones de diseño (capítulo 11)

Subir un archivo a una tarea reúne los patrones del capítulo (`src/components/tasks/task_orchestrator.ts`):

| Patrón | Dónde | Papel |
|---|---|---|
| Factory | `src/factories/storage_factory.ts` | Elige el proveedor (`STORAGE_PROVIDER`): disco, S3 de LocalStack o memoria |
| Proxy | `src/proxies/logging_proxy.ts` | Audita cada llamada al almacenamiento y mide su duración |
| Adapter | `src/adapters/sms_adapter.ts` | Traduce `sendSms()` del dominio al SDK del proveedor de SMS |
| Builder | `src/builders/http_client_builder.ts` | Construye el cliente HTTP (reintentos, timeout, token) de la pasarela de SMS |
| Singleton | `src/config/database_connection.ts` | Pool único de PostgreSQL, usado por `GET /api/health` |
| Decorator | `src/decorators/encrypted_task_repository_decorator.ts` | Cifra la descripción de la tarea (AES-256-GCM) sobre `TypeOrmTaskRepository` |
| Inyección de dependencias | constructor de `TaskOrchestrator` | Permite sustituir almacenamiento y notificador en pruebas |

```bash
# El archivo viaja como cuerpo binario (máximo 10 MB); phone es opcional y dispara el SMS
curl -X POST "http://localhost:3000/api/tasks/<id>/attachments?filename=informe.pdf&phone=%2B526671234567" \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/octet-stream" --data-binary @informe.pdf
curl "http://localhost:3000/api/tasks/<id>/attachments" -H "Authorization: Bearer <token>"
curl -X DELETE "http://localhost:3000/api/tasks/<id>/attachments/informe.pdf" -H "Authorization: Bearer <token>"
```

Con `STORAGE_PROVIDER=s3` los archivos van al bucket de LocalStack (`AWS_ENDPOINT_URL=http://127.0.0.1:4566`).
El cliente S3 exige ese endpoint y usa credenciales de relleno: no puede hablar con una cuenta real de AWS.
El Decorator de cifrado está probado contra PostgreSQL pero no está conectado a un endpoint de la API.

## Flujo de trabajo y patrones de comportamiento (capítulo 12)

| Patrón | Dónde | Papel en la API |
|---|---|---|
| State | `src/domain/task_workflow.ts` | Ciclo de vida de la tarea: `Not-Started` -> `In-Progress` -> `In-Review` -> `Completed`. Solo se permiten esas transiciones |
| Middleware (Pipeline, modelo cebolla) | `src/core/middleware_pipeline.ts` | Procesa las acciones del flujo: métricas -> autorización -> transición -> notificación |
| Command | `src/commands/task_commands.ts` | Reasignar una tarea con historial para deshacer (guardado en Redis, compartido entre procesos) |
| Template Method | `src/reports/base_report_generator.ts` | Esqueleto del reporte: obtener datos -> formatear -> exportar -> auditar |
| Strategy | `src/reports/project_report_generators.ts` | El formato (`csv` o `json`) elige el algoritmo de generación |
| Iterador asíncrono | `src/utils/async_iterator.ts` | El reporte lee las tareas por lotes de 100 con `for await` |

```bash
POST /api/tasks/:id/workflow/start | submit | approve   # transición del flujo; 409 si no es legal
PUT  /api/tasks/:id/status                              # cambio de estado libre, con las mismas reglas
PUT  /api/tasks/:id/assign        {"user_id": "..."}    # reasigna y guarda el comando
POST /api/tasks/:id/assign/undo                         # deshace la última reasignación
GET  /api/projects/:id/report?format=csv|json           # reporte descargable (CSV neutraliza fórmulas)
```

La estrategia de almacenamiento de adjuntos del capítulo es la interfaz `IStorageService` y sus proveedores (capítulo 11).

## SOLID y arquitectura limpia (capítulo 13)

Aplicado al caso de uso "crear tarea" (`POST /api/tasks`), sin reestructurar el resto de la aplicación:

| Capa | Archivos | Responsabilidad |
|---|---|---|
| 1. Entidades | `src/domain/entities/task.ts`, `errors.ts`, `task_status.ts` | Reglas de negocio puras (nombre, proyecto, fechas, estado inicial); no importan ningún framework |
| 2. Casos de uso | `src/use-cases/create_task_use_case.ts` | Orquesta: valida, verifica referencias, guarda y notifica, solo a través de interfaces |
| 3. Adaptadores | `src/adapters/repositories/*`, `task_notifications_adapter.ts`, controlador de tareas | Traducen entre el dominio y PostgreSQL / HTTP / correo |
| 4. Infraestructura | `src/infrastructure/composition.ts` | Único lugar donde se ensamblan las piezas concretas |

| Principio | Cómo se demuestra |
|---|---|
| SRP | Entidad (reglas), caso de uso (flujo), repositorio (persistencia) y notificador (aviso) son piezas separadas |
| OCP | `src/domain/cost/task_cost.ts`: tarifas `standard` y `urgent` como clases; `GET /api/tasks/:id/cost?type=` |
| LSP | `tests/helpers/task_repository_contract.ts`: el mismo contrato lo cumplen el repositorio en memoria y el de PostgreSQL |
| ISP | `ITaskReader` / `ITaskWriter`; `TaskQueryService` depende solo de la lectura |
| DIP | `CreateTaskUseCase` recibe interfaces por constructor; las pruebas inyectan implementaciones en memoria |

Las capas internas no importan `typeorm`, `express`, `pg` ni utilidades de infraestructura (lo verifica una prueba).
Una tarea nueva siempre inicia en `Not-Started`; los demás estados se alcanzan por el flujo de trabajo del capítulo 12.

## Motores de almacenamiento e índices (capítulo 14)

La aplicación combina motores según su fortaleza, como describe el capítulo:

| Motor | Uso | Dónde |
|---|---|---|
| PostgreSQL + índices **B-Tree** | Datos transaccionales y consultas frecuentes | `idx_tasks_user_id`, `idx_tasks_status`, `idx_comments_task_id` (más los únicos por proyecto/nombre) |
| **LevelDB** (LSM-Tree) | Historial completo de actividad por tarea, con lecturas secuenciales por rango | `src/engines/activity_logger_service.ts` |
| Motor **Bitcask** (log append-only + índice hash) | Última actividad de cada tarea en una sola lectura; recuperación tras caída y compactación | `src/engines/simple_log_engine.ts` |

LevelDB bloquea su carpeta, así que solo **un proceso** puede abrirla; por eso los motores viven en el servicio
`pms-activity` (`npm run activity`, o `npm run start:activity` compilado; `ecosystem.config.js` lo arranca como una
sola instancia) y la API, que corre en varios procesos, le habla por HTTP local con el Builder del capítulo 11.
Si el servicio no está disponible la API sigue funcionando: el registro es "dispara y olvida" y la consulta responde 503.

```bash
GET /api/tasks/:id/activity?limit=100&order=asc|desc   # historial (LevelDB)
GET /api/tasks/:id/activity/last                       # última actividad (índice hash)
```

Se registran: creación, transiciones del flujo, cambios de estado, reasignaciones y su deshacer, y adjuntos.
Variables: `ACTIVITY_URL` (por defecto `http://127.0.0.1:4100`), `ACTIVITY_PORT`, `ACTIVITY_DATA_DIR` (por defecto
`./data/activity`), `ACTIVITY_TOKEN` (token interno opcional entre la API y el servicio).

## Transacciones y concurrencia (capítulo 15)

Dos anomalías de concurrencia reales del sistema están resueltas y probadas con peticiones simultáneas contra PostgreSQL:

| Anomalía | Dónde aparecía | Solución | Código |
|---|---|---|---|
| **Write skew** (sesgo de escritura) | Máximo de tareas `In-Progress` por proyecto (por defecto 5, `MAX_IN_PROGRESS_PER_PROJECT`): dos inicios simultáneos leían "queda un cupo" y ambos escribían | Transacción `SERIALIZABLE` + reintentos con backoff exponencial y jitter ante el error `40001` | `task_transaction_service.ts`, `utils/serializable_retry.ts` |
| **Lost update** (pérdida de actualización) | Lista de adjuntos de una tarea: subidas simultáneas leían, modificaban y se pisaban (12 subidas dejaban 2) | Bloqueo de fila `SELECT ... FOR UPDATE` dentro de una transacción | `addAttachment` / `removeAttachment` |

Iniciar una tarea (`POST /api/tasks/:id/workflow/start` o `PUT /status` a `In-Progress`) pasa por esa transacción: si el proyecto
ya está en el límite responde **409**; si PostgreSQL aborta por conflicto, se reintenta automáticamente (y si se agotan los reintentos, 409 "vuelva a intentar").
Las pruebas de integración incluyen un **experimento de control** para cada caso: sin la protección (`READ COMMITTED` / sin bloqueo)
la invariante se rompe, y con ella se cumple siempre.

## Mensajería con RabbitMQ (capítulo 16)

Cada operación sobre una tarea se anuncia como **evento de dominio** en un intercambiador `topic` duradero de RabbitMQ
(`src/messaging/domain_events.ts`), además de registrarse en el servicio de actividad. Dos microservicios independientes lo consumen:

| Microservicio | Proceso | Cola y enlace | Qué hace |
|---|---|---|---|
| Auditoría | `npm run audit` (`pms-audit`) | `audit_service_queue` <- `#` (todo) | Guarda cada evento en la tabla `audit_events`; es **idempotente** (clave primaria = `eventId`, la entrega es "al menos una vez") |
| Notificaciones | `npm run notifications` (`pms-notifications`) | `notification_service_queue` <- `task.event.*` | Avisa por correo a quien recibe una tarea (creación o reasignación); se puede escalar con varias instancias (consumidores competidores) |

Claves de enrutamiento: `task.event.created`, `task.event.status_changed`, `task.event.assigned`, `task.event.attachment_added|removed`.

Garantías: mensajes **persistentes** y colas **duraderas** (lo que ocurre con un consumidor caído se conserva y se entrega al volver),
**confirmación del publicador**, **ACK manual** con `prefetch(1)`, y **reintentos con límite**: tras 3 fallos el mensaje pasa a la cola de
mensajes muertos `pms_dead_letters` (en vez de reencolarse para siempre). Si RabbitMQ cae, la API sigue respondiendo (publicar es "dispara y olvida",
`GET /api/health` informa `rabbitmq`) y los workers terminan con error para que PM2 los reinicie con espera creciente hasta que el broker vuelva.

```bash
GET /api/audit/events?task_id=&type=&user_id=&limit=   # consulta la auditoría (derecho get_audit_events)
```

La mensajería es opcional: solo se activa si `RABBITMQ_URL` está definida (por ejemplo `amqp://guest:guest@127.0.0.1:5672`).
Panel de administración: http://127.0.0.1:15672 (`guest` / `guest`). Los eventos emitidos mientras el broker está caído no se reponen.
Una base de datos creada antes del derecho `get_audit_events` necesita agregarlo al rol SuperAdmin.

## Flujos de eventos, CDC, Event Sourcing y CQRS (capítulo 17)

| Concepto | Implementación |
|---|---|
| **CDC** (captura de cambios) | Triggers de PostgreSQL escriben cada `INSERT/UPDATE/DELETE` de `tasks` en `task_changes` (fila anterior y nueva) **dentro de la misma transacción**: captura el 100 % de las mutaciones, incluidos los borrados, y no hay doble escritura (si la transacción se revierte, el registro también). El log es inmutable (un trigger prohíbe modificarlo o borrarlo). Al activarlo se toma una instantánea inicial de las tareas existentes (`src/events/cdc.ts`) |
| **Event Sourcing** | Los cambios se traducen a eventos de dominio (`TaskCreated`, `TaskStatusChanged`, `TaskCompleted`, `TaskAssigned`, `TaskRenamed`, `TaskMoved`, `TaskFieldsChanged`, `TaskDeleted`) y el estado de una tarea se reconstruye solo reproduciéndolos (`src/events/stream_events.ts`) |
| **Viaje en el tiempo** | `GET /api/tasks/:id/at?time=<ISO>` devuelve el estado que tenía la tarea en ese instante, incluso si ya fue borrada; `GET /api/tasks/:id/history` lista sus eventos |
| **CQRS** | Lado de comandos: la API escribe en `tasks`. Lado de lectura: la vista `project_metrics`, mantenida incrementalmente por el proyector (`npm run projector`, `pms-projector`); `GET /api/analytics/projects/:id/metrics` la consulta e informa el retraso (`lag`) |
| **Garantías de entrega** | El offset del consumidor (`stream_offsets`) se guarda en la **misma transacción** que la actualización de la vista: el efecto de cada cambio se aplica exactamente una vez aunque el proceso muera a mitad de un lote. El bloqueo de la fila del offset hace seguras varias instancias |
| **Orden y huecos** | Una transacción lenta puede obtener un `seq` bajo y confirmarse después de otra con `seq` alto; avanzar el offset la saltaría para siempre. El proyector solo consume el prefijo de cambios cuyas transacciones ya terminaron (`pg_snapshot_xmin`) |
| **Ventanas** | `GET /api/analytics/throughput?window=tumbling\|sliding\|session&size=&slide=&gap=&metric=created\|completed&project_id=&from=&to=` (`src/events/windowing.ts`) |
| **Reconstrucción** | `npm run projector:rebuild` vacía la vista y la reconstruye reproduciendo todo el log |

La vista de lectura es **eventualmente consistente**: si el proyector está caído, la API sigue funcionando y el `lag` crece hasta que vuelve.
Las fechas de `tasks` son `timestamp` sin zona horaria (diseño original), por lo que los eventos conservan esa hora local ingenua en su carga; el instante del evento (`changed_at`) sí lleva zona.
Con Kafka y Debezium se haría la misma lectura del WAL de PostgreSQL con herramientas dedicadas; aquí se implementó con triggers y un procesador propio para no añadir infraestructura.

## Event loop, worker threads y procesos hijo (capítulo 18)

Node.js ejecuta el JavaScript en un solo hilo: un cálculo largo ahí detiene **todas** las peticiones. El análisis de riesgo
(`GET /api/analytics/projects/:id/risk`) es una **simulación Monte Carlo** del plazo restante de un proyecto (percentiles P50/P80/P90/P95
de las horas pendientes y probabilidad de cumplir la fecha límite), un cálculo real y pesado para la CPU.

| Modo (`?mode=`) | Dónde corre | Cuándo |
|---|---|---|
| `thread` (por defecto) | Pool de **worker threads** reutilizables (`src/utils/worker_pool.ts`) | Cálculos frecuentes: no se crea un hilo por petición |
| `process` | Un **proceso hijo** por tarea (`child_process.fork`, `src/workers/risk_process.ts`) | Aislamiento total de memoria y fallos; sin secretos heredados del entorno |
| `inline` | El hilo principal | Solo para comparar: **bloquea el servidor**; requiere `ANALYTICS_ALLOW_INLINE=true` |

El pool: cola FIFO, reemplazo automático de hilos que fallan o mueren, tiempo máximo por tarea (`ANALYTICS_TIMEOUT_MS`, 504 al excederlo)
con **cancelación cooperativa por memoria compartida** (`SharedArrayBuffer` + `Atomics`: una bandera por worker) y, si el worker no obedece, se termina
y se reemplaza. Los contadores (completadas, fallidas, canceladas) también viven en memoria compartida. El tiempo máximo no cuenta el arranque del hilo
(el worker envía `{ ready: true }`). Con la misma `seed` los tres modos devuelven resultados idénticos.

Diagnóstico con `perf_hooks`: `GET /api/health` incluye `event_loop` (utilización, retraso p99 y máximo) y `worker_pool`.
`npm run diagnostics:event-loop` muestra el orden de ejecución (síncrono, `nextTick`, microtareas, Timers, Check) y la utilización del event loop
con y sin bloqueo. Variables: `ANALYTICS_THREADS` (2 por defecto), `ANALYTICS_TIMEOUT_MS` (15000).

## Pruebas

```bash
npm test                  # Unitarias y de API con dobles de prueba (Sinon); no requieren servicios
npm run test:coverage     # Igual, con reporte de cobertura (nyc)
npm run test:integration  # Contra PostgreSQL, Redis y un SMTP de prueba reales
```

Las pruebas de integración usan una base propia (`pms_db_test`, la crean y limpian ellas), la base 1 de Redis, un virtual host
propio de RabbitMQ (`pms_test`) y un servidor SMTP de pruebas en `localhost:1025` (por ejemplo [Mailpit](https://mailpit.axllent.org/), interfaz en `:8025`);
LocalStack para las de S3. Nunca leen el `.env`, así que no envían correos reales, y las que dependen de un servicio ausente se omiten.
Variables opcionales: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `TEST_REDIS_URL`, `TEST_RABBITMQ_URL`, `TEST_SMTP_HOST`, `TEST_SMTP_PORT`, `TEST_S3_ENDPOINT`.

## Variables de entorno

Copia `.env.example` a `.env` (ignorado por git) y `server_config.example.json` a `server_config.json`.
Para enviar correos reales con Gmail usa una contraseña de aplicación de Google en `SMTP_PASS`.

## Build y despliegue

```bash
# Empaquetar: compila, ofusca y genera binaries/pms_be_<versión>.tgz
bash scripts/mkpackage.sh

# Desplegar por SSH (en un servidor real, KEY_PATH es la clave .pem de la instancia)
SERVER_IP=203.0.113.10 KEY_PATH=./mi_clave_ec2.pem bash scripts/deploy.sh
```

El despliegue instala el paquete con `npm ci --omit=dev` y lo arranca con PM2 en modo cluster
(`ecosystem.config.js`, puerto 8080). Si existe `.env.production` se envía al servidor como `.env`;
los secretos nunca viajan dentro del paquete.

### Servidor EC2 simulado (sin AWS)

`scripts/docker/ec2-sim/` es un Ubuntu 22.04 con `sshd` (solo clave), Node 20 y PM2. Sirve para ejecutar el
despliegue real de punta a punta sin crear nada en la nube. Con podman (o docker):

```bash
ssh-keygen -t ed25519 -N "" -f scripts/docker/ec2-sim/mi_clave_ec2        # la clave no se sube a git
podman build -t pms-ec2-sim scripts/docker/ec2-sim
podman run -d --name pms-ec2 -p 2222:22 -p 8080:8080 \
  -v "$PWD/scripts/docker/ec2-sim/mi_clave_ec2.pub:/tmp/authorized_key.pub:ro,z" pms-ec2-sim

# .env.production: DB_HOST, REDIS_URL y SMTP_HOST apuntan a host.containers.internal (el host);
# WEB_CONCURRENCY limita las instancias de PM2.
SERVER_IP=localhost SSH_PORT=2222 KEY_PATH=scripts/docker/ec2-sim/mi_clave_ec2 bash scripts/deploy.sh
ssh -i scripts/docker/ec2-sim/mi_clave_ec2 -p 2222 ubuntu@localhost 'cd pms-backend && node dist/src/main.js --init'
curl localhost:8080/ping
```

### AWS simulado con LocalStack

`scripts/aws/` aprovisiona en LocalStack (una simulación local de AWS, sin costo) lo que describe el
capítulo 10: par de claves SSH, grupo de seguridad (SSH solo desde una IP administrativa; HTTP 80 y 8080
públicos), una instancia `t2.micro` con Ubuntu 22.04 y disco gp3 de 20 GB que se borra con la instancia,
y un bucket S3 con versionado para los paquetes. Requiere el contenedor `pms-localstack` con
`LOCALSTACK_AUTH_TOKEN` (ver `.env.example`).

```bash
bash scripts/aws/provision.sh      # crea todo en LocalStack (localhost:4566)
ARTIFACT_BUCKET=<bucket> SERVER_IP=... KEY_PATH=... bash scripts/deploy.sh   # despliega y guarda el paquete en S3
bash scripts/aws/teardown.sh       # lo elimina todo, incluidas las versiones del bucket
```

El despliegue SSH real se hace contra el servidor simulado (`scripts/docker/ec2-sim`). Este proyecto no
crea recursos en AWS real.

## Notas

- Las notas teóricas del curso se mantienen localmente en la carpeta `md/` (ignorada por git).
