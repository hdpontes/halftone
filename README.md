# Halftone Platform

Plataforma de ferramentas para DTF em Next.js, PostgreSQL e Prisma, pronta para build via GitHub e Portainer. O stack usa o PostgreSQL já existente na VPS, conectado pela rede Docker externa `debora-app_default`.

## Deploy no Portainer

1. No banco PostgreSQL da stack `debora-app`, execute [`database/create-halftone-schema.sql`](database/create-halftone-schema.sql). Ele cria o schema `Halftone` sem alterar o schema do Evolution.
2. Crie um stack a partir deste repositório. Na seção **Environment variables** do Portainer, adicione todas as variáveis listadas em `.env.example`.
3. Troque `AUTH_SECRET`, `N8N_WEBHOOK_SECRET`, `ADMIN_PASSWORD` e `NEXT_PUBLIC_HOTMART_CHECKOUT_URL` por valores reais.
4. Em `DATABASE_URL`, use o usuário, senha e banco corretos. Como o serviço PostgreSQL está na rede `debora-app_default`, o host normalmente será `postgres`: `postgresql://hdpontes:SENHA@postgres:5432/evolution_db?schema=Halftone`.
5. Faça o build/redeploy. O container aplica o schema, cria/atualiza o admin e inicia a aplicação na porta `3000`.

O `docker-compose.yml` não cria banco, volume ou serviço PostgreSQL local. Ele também não depende de um arquivo `.env` no repositório: as variáveis são fornecidas pelo Portainer.

O nome da rede precisa existir previamente no Docker. O Compose está configurado com `external: true`, portanto não tentará criar uma rede duplicada.

### Diagnóstico sem a página de logs do Portainer

Conecte-se à VPS por SSH e execute na pasta onde o stack foi baixado:

```bash
docker compose build --no-cache --progress=plain app
```

O erro real aparecerá depois de `RUN npx prisma generate` ou `RUN npm run build`. Para verificar a rede e o PostgreSQL:

```bash
docker network inspect debora-app_default
docker run --rm --network debora-app_default alpine:3.20 sh -c 'apk add --no-cache postgresql-client >/dev/null && pg_isready -h postgres -p 5432'
```

## Integração n8n

Envie `POST /api/integration/provision` com o header `x-n8n-secret` e um JSON com `name`, `email`, `hotmartId` e opcionalmente `password`. O endpoint é idempotente: uma nova compra atualiza o cadastro existente e reativa o acesso.

O checkout exibido na tela de login é definido por `NEXT_PUBLIC_HOTMART_CHECKOUT_URL`.

## Halftone Studio

Usuários com `accessStatus=ACTIVE` acessam `/halftone` pelo painel. O preview aplica a retícula no Canvas assim que a imagem é importada; a exportação envia a arte para `POST /api/halftone`, que processa PNG, JPG, WEBP ou TIFF com ImageMagick e retorna um PNG de produção em 300 DPI. Os parâmetros aceitos são `mode` (`mono` ou `cmyk`), `lpi` (10-120), `angle` (-90 a 90), `dpi` (fixo em 300), `dot` (`round`, `ellipse` ou `line`), `contrast`, `brightness` e `transparent`.