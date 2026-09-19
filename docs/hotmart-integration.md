# Integração Hotmart / n8n — Endpoints e modelos de dados

Documentação dos endpoints usados para provisionar contas e assinaturas a partir de uma
compra na Hotmart, e para receber eventos de reembolso/chargeback/cancelamento.

Fluxo recomendado para uma **nova compra aprovada** (evento `PURCHASE_APPROVED` da Hotmart,
tratado no n8n):

1. n8n chama `POST /api/integration/provision` para criar/atualizar o usuário (conta de acesso).
2. n8n chama `POST /api/integration/subscription` para criar/renovar a assinatura (controla o
   acesso ao produto: prazo, plano, status).

Esses dois passos são separados de propósito: `provision` cuida da **conta** (login/senha),
`subscription` cuida do **direito de acesso** (prazo, plano, renovação).

---

## 1. `POST /api/integration/provision`

Cria ou atualiza o usuário. Idempotente por `email` (upsert).

**Auth:** header `x-n8n-secret` deve ser igual à env `N8N_WEBHOOK_SECRET`.

### Request

```json
{
  "name": "Nome do Comprador",
  "email": "comprador@email.com",
  "hotmartId": "buyer.ucode-da-hotmart",
  "password": "opcional-min-8-chars"
}
```

| Campo      | Tipo   | Obrigatório | Observação |
|------------|--------|:---:|---|
| `name`     | string | sim | mínimo 2 caracteres |
| `email`    | string | sim | usado como chave do upsert (normalizado para minúsculas) |
| `hotmartId`| string | não | usar `buyer.ucode` do payload da Hotmart (não `purchase.transaction`) |
| `password` | string | não | se omitido, uma senha aleatória é gerada (o usuário deve trocar depois) |

- Sempre seta `accessStatus: "ACTIVE"` no usuário (criação ou atualização).
- Grava `AuditLog` com `action: "USER_PROVISIONED"`.

### Response `200`
```json
{ "ok": true, "userId": "clx...", "email": "comprador@email.com" }
```

### Erros
- `401` — `x-n8n-secret` ausente/incorreto.
- `400` — payload inválido (zod).

---

## 2. `POST /api/integration/subscription`

Cria ou renova a assinatura vinculada a um usuário já existente (chamar `provision` antes, se o
usuário ainda não existir). Idempotente por `hotmartTransaction`.

**Auth:** header `x-n8n-secret` deve ser igual à env `N8N_WEBHOOK_SECRET`.

### Request

```json
{
  "email": "comprador@email.com",
  "hotmartId": "buyer.ucode-da-hotmart",
  "planId": "halftone-pro-mensal",
  "hotmartTransaction": "HP123456789",
  "hotmartSubscriptionId": "subscriber.code-da-hotmart",
  "hotmartProductId": "123456",
  "hotmartOfferCode": "abc123"
}
```

| Campo | Tipo | Obrigatório | Observação |
|---|---|:---:|---|
| `email` | string | um dos dois (`email` ou `hotmartId`) | usado para localizar o usuário se `hotmartId` não vier |
| `hotmartId` | string | um dos dois | tem prioridade sobre `email` para localizar o usuário |
| `planId` | string | sim | **ID do plano Hotmart**, não o nome. Precisa existir em `HOTMART_PLANS` (`src/lib/subscription.ts`) |
| `hotmartTransaction` | string | sim | chave de idempotência — identifica essa cobrança específica |
| `hotmartSubscriptionId` | string | não | `subscriber.code`, agrupa cobranças recorrentes da mesma assinatura |
| `hotmartProductId` | string | não | id do produto na Hotmart |
| `hotmartOfferCode` | string | não | código da oferta/cupom |

**Planos configurados atualmente** (`src/lib/subscription.ts` → `HOTMART_PLANS`):

| `planId` | Duração |
|---|---|
| `halftone-pro-mensal` | 30 dias |
| `halftone-pro-anual` | 365 dias |

> Para adicionar um novo plano/produto, basta incluir uma nova chave em `HOTMART_PLANS` com
> `{ name, durationDays }` — não precisa mexer em nenhuma rota.

**Regra de renovação:** se o usuário já tem uma assinatura vigente (`expiresAt` no futuro), o
novo prazo é somado a partir do `expiresAt` atual. Se está vencida (ou não existe), o prazo
começa a contar a partir de agora.

### Response `200` (criação/renovação)
```json
{ "ok": true, "subscriptionId": "clx...", "expiresAt": "2026-10-13T00:00:00.000Z" }
```

### Response `200` (chamada repetida — mesma `hotmartTransaction`)
```json
{ "ok": true, "subscriptionId": "clx...", "expiresAt": "2026-10-13T00:00:00.000Z", "idempotent": true }
```

### Erros
- `401` — `x-n8n-secret` ausente/incorreto.
- `400` — payload inválido, ou `planId` desconhecido (`"Plano desconhecido"`).
- `404` — usuário não encontrado (rodar `provision` antes).

---

## 3. `POST /api/webhooks/hotmart`

Recebe diretamente da Hotmart os eventos de reembolso, chargeback e cancelamento. Não precisa
passar pelo n8n.

**Auth:** header `x-hotmart-hottok` deve ser igual à env `HOTMART_HOTTOK` (configurar o mesmo
valor no painel da Hotmart, na aba de webhooks do produto). O valor nunca é logado.

### Request (formato reduzido do payload da Hotmart)

```json
{
  "event": "PURCHASE_REFUNDED",
  "data": {
    "purchase": { "transaction": "HP123456789" },
    "subscription": { "subscriber": { "code": "subscriber.code-da-hotmart" } }
  }
}
```

| Campo | Observação |
|---|---|
| `event` | um de `PURCHASE_REFUNDED`, `PURCHASE_CHARGEBACK`, `PURCHASE_CANCELED`. Qualquer outro evento é apenas confirmado (`{ ok: true, ignored: true }`) e ignorado — ex.: `PURCHASE_APPROVED` deve continuar sendo tratado pelo fluxo n8n → `provision` + `subscription` acima. |
| `data.purchase.transaction` | usado para localizar a `Subscription` (bate com `hotmartTransaction`). Preferencial. |
| `data.subscription.subscriber.code` | fallback para localizar a assinatura mais recente por `hotmartSubscriptionId`, caso `transaction` não venha. |

### Efeitos por evento
- **`PURCHASE_REFUNDED`** → `Subscription.status = "REFUNDED"`. Acesso bloqueado imediatamente.
- **`PURCHASE_CHARGEBACK`** → `Subscription.status = "CHARGEBACK"`. Acesso bloqueado imediatamente.
- **`PURCHASE_CANCELED`** → `Subscription.status = "CANCELED"`. Acesso **continua até `expiresAt`**
  (cancelamento só impede renovação futura; a expiração natural marca `EXPIRED` depois).

Todos os casos gravam `AuditLog` (`SUBSCRIPTION_REFUNDED` / `SUBSCRIPTION_CHARGEBACK` /
`SUBSCRIPTION_CANCELED`) e são idempotentes: reenviar o mesmo evento não altera um estado
terminal (`REFUNDED`/`CHARGEBACK`) já gravado.

### Response `200`
```json
{ "ok": true }
```
Variações: `{ "ok": true, "ignored": true }` (evento não tratado), `{ "ok": true, "notFound": true }`
(transaction/subscriber não encontrado), `{ "ok": true, "idempotent": true }` (já estava em
estado terminal).

### Erros
- `401` — `x-hotmart-hottok` ausente/incorreto.
- `400` — payload inválido, ou nenhum identificador (`transaction`/`subscriber.code`) informado.

---

## 4. `GET /api/subscription`

Endpoint de auto-consulta: o próprio usuário logado vê o status da sua assinatura.

**Auth:** cookie de sessão (`halftone_session`), igual às demais rotas autenticadas do app.

### Response `200`
```json
{
  "hasAccess": true,
  "subscription": {
    "plan": "halftone-pro-mensal",
    "planName": "Halftone Pro Mensal",
    "status": "ACTIVE",
    "startsAt": "2026-09-13T00:00:00.000Z",
    "expiresAt": "2026-10-13T00:00:00.000Z"
  }
}
```
Se o usuário nunca teve uma assinatura: `{ "hasAccess": true|false, "subscription": null }`
(`hasAccess` ainda reflete `accessStatus`, para contas manuais sem Hotmart).

Nunca retorna `passwordHash`, tokens ou dados de outros usuários.

### Erros
- `401` — sem sessão.

---

## Regras de acesso (resumo)

`hasFullAccess(userId)` (`src/lib/subscription.ts`) é o único ponto de decisão usado no login,
na página `/halftone` e na API `/api/halftone`:

1. `User.accessStatus === "ACTIVE"` (controlado pelo admin) — se não, bloqueia sempre.
2. Se o usuário **não tem `hotmartId`** (conta manual, criada em `/api/admin/users`) → acesso
   liberado só com a regra 1.
3. Se o usuário **tem `hotmartId`** → precisa também ter uma `Subscription` com
   `status IN (ACTIVE, CANCELED)` e `expiresAt > agora`.

> ⚠️ Importante para contas já existentes: qualquer usuário que já tinha `hotmartId` **antes**
> dessa mudança e nunca teve uma `Subscription` criada via `/api/integration/subscription` vai
> falhar na regra 3 até que uma assinatura seja registrada para ele.

## Variáveis de ambiente novas/relevantes

| Variável | Usada em | Observação |
|---|---|---|
| `N8N_WEBHOOK_SECRET` | `provision`, `integration/subscription` | já existia, reaproveitada |
| `HOTMART_HOTTOK` | `webhooks/hotmart` | nova — copiar o hottok exibido no painel da Hotmart (aba Webhooks do produto) |
