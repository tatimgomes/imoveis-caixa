# Painel de Leilões — Imóveis Caixa

Painel estático (HTML + JS, sem backend) para explorar a lista de imóveis à
venda pela Caixa Econômica Federal, com filtros, ranking de descontos e
tabela ordenável.

A base de dados (`data.json`) é atualizada automaticamente **uma vez por
semana** a partir do arquivo oficial da Caixa, via GitHub Actions.

## Estrutura

```
index.html               -> o painel (interface)
app.js                    -> lógica (filtros, tabela, etc.)
data.json                 -> índice da base (lista de arquivos por UF)
data/UF.json              -> dados de cada estado (27 arquivos, gerados automaticamente)
scripts/update_data.py    -> script que baixa e processa o CSV da Caixa
.github/workflows/update.yml -> agenda a atualização semanal
```

> Por que dividido por UF? O arquivo único (~11MB) falhava ao ser enviado
> pela interface web do GitHub. Dividido por estado, cada arquivo fica
> abaixo de 5MB (a maioria abaixo de 1MB), o que evita esse problema e
> também acelera o carregamento (os arquivos são buscados em paralelo).

## Como publicar

### 1. Criar o repositório no GitHub

1. Crie um novo repositório (pode ser público ou privado).
2. Faça upload de todos os arquivos desta pasta, mantendo a estrutura
   (incluindo a pasta `.github/workflows/` e `scripts/`).
3. Em **Settings → Actions → General → Workflow permissions**, marque
   **"Read and write permissions"** — isso é necessário para o workflow
   conseguir fazer commit do `data.json` atualizado.

### 2. Conectar ao Netlify

1. No [Netlify](https://app.netlify.com), clique em **"Add new project" →
   "Import an existing project"**.
2. Escolha **GitHub** e selecione este repositório.
3. Configurações de build:
   - **Build command:** deixe em branco (não há build)
   - **Publish directory:** `.` (raiz do repositório)
4. Clique em **Deploy**.

A partir daí, qualquer alteração no repositório (incluindo o commit
automático do `data.json` feito pelo GitHub Actions) faz o Netlify
republicar o site automaticamente.

### 3. Testar a atualização manualmente

Na aba **Actions** do repositório no GitHub, escolha o workflow
**"Atualizar base de imóveis (Caixa)"** e clique em **"Run workflow"** para
rodar imediatamente, sem esperar a próxima segunda-feira.

## Atualizando manualmente (sem GitHub Actions)

Se preferir não usar a automação, rode localmente:

```bash
python scripts/update_data.py
```

Isso baixa o CSV mais recente da Caixa e regenera `data.json`. Depois,
suba o arquivo atualizado para o Netlify (arrastando a pasta novamente em
app.netlify.com/drop, ou via git push, se conectado a um repositório).


