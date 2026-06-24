#!/usr/bin/env python3
"""
Busca os detalhes (formas de pagamento e regras de despesas) dos imóveis
de SP que atendem ao critério: apartamento, venda direta/online,
desconto >= 40%, preço <= R$200k.

Requer Playwright:
    pip install playwright
    playwright install chromium

Uso:
    python scripts/fetch_detalhes_sp.py
"""

import json
import re
import sys
import time
from pathlib import Path

OUTPUT_PATH = "data/SP_detalhes.json"
BASE_URL = "https://venda-imoveis.caixa.gov.br"
BUSCA_URL = f"{BASE_URL}/sistema/busca-imovel.asp"

MODALIDADES_ALVO = {"Venda Direta Online", "Venda Online"}
DESCONTO_MIN = 0.40
PRECO_MAX = 200_000
TIPO_ALVO = "apartamento"

# pausa entre requisições para não sobrecarregar o servidor
DELAY_SEGUNDOS = 2.0


def load_candidatos():
    """Carrega o índice e filtra os imóveis de SP que atendem aos critérios."""
    with open("data.json", encoding="utf-8") as f:
        index = json.load(f)

    sp_entry = next((u for u in index["ufs"] if u["uf"] == "SP"), None)
    if not sp_entry:
        raise SystemExit("SP não encontrado no índice data.json.")

    with open(sp_entry["file"], encoding="utf-8") as f:
        items = json.load(f)

    candidatos = [
        i for i in items
        if TIPO_ALVO in (i.get("tipo") or "").lower()
        and (i.get("modalidade") or "").strip() in MODALIDADES_ALVO
        and (i.get("desconto") or 0) >= DESCONTO_MIN
        and (i.get("preco") or 999_999) <= PRECO_MAX
    ]
    return candidatos


def load_existing():
    """Carrega resultados já extraídos para permitir retomada em caso de falha."""
    path = Path(OUTPUT_PATH)
    if path.exists():
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return {entry["cod"]: entry for entry in data.get("items", [])}
    return {}


def save(items, source_date=None):
    from datetime import datetime, timezone
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_date": source_date,
        "count": len(items),
        "criterio": "SP · apartamento · venda direta/online · desconto >= 40% · preço <= R$200k",
        "items": list(items.values()),
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Salvo: {len(items)} imóveis em {OUTPUT_PATH}", file=sys.stderr)


def extract_fields(html: str) -> dict:
    """
    Extrai 'formas_pagamento' e 'regras_despesas' do HTML da página de detalhe.
    Retorna dict com os dois campos (string ou None).
    """
    result = {"formas_pagamento": None, "regras_despesas": None}

    # padrão de extração: texto após o label até o próximo label ou fim do bloco
    # os campos aparecem em texto puro separados por quebras de linha / tags
    cleaned = re.sub(r'<[^>]+>', ' ', html)  # remove tags HTML
    cleaned = re.sub(r'&nbsp;', ' ', cleaned)
    cleaned = re.sub(r'&amp;', '&', cleaned)
    cleaned = re.sub(r'&#\d+;', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    # extrai FORMAS DE PAGAMENTO ACEITAS
    m = re.search(
        r'FORMAS DE PAGAMENTO ACEITAS[:\s]*(.*?)(?=REGRAS PARA|$)',
        cleaned, re.IGNORECASE | re.DOTALL
    )
    if m:
        result["formas_pagamento"] = m.group(1).strip()

    # extrai REGRAS PARA PAGAMENTO DAS DESPESAS
    m = re.search(
        r'REGRAS PARA PAGAMENTO DAS DESPESAS[^:]*:[:\s]*(.*?)(?=FORMAS DE PAGAMENTO|Imprimir|Compartilhar|$)',
        cleaned, re.IGNORECASE | re.DOTALL
    )
    if m:
        result["regras_despesas"] = m.group(1).strip()

    return result


def run():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("Playwright não instalado. Execute: pip install playwright && playwright install chromium")

    candidatos = load_candidatos()
    print(f"Imóveis a processar: {len(candidatos)}", file=sys.stderr)

    existing = load_existing()
    ja_processados = set(existing.keys())
    pendentes = [c for c in candidatos if str(c["cod"]) not in ja_processados]
    print(f"Já processados: {len(ja_processados)} | Pendentes: {len(pendentes)}", file=sys.stderr)

    if not pendentes:
        print("Nenhum imóvel novo a processar.", file=sys.stderr)
        save(existing)
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            locale="pt-BR"
        )
        page = ctx.new_page()

        # cria sessão navegando pela busca primeiro
        print("Criando sessão...", file=sys.stderr)
        page.goto(BUSCA_URL, timeout=30_000, wait_until="domcontentloaded")
        time.sleep(2)

        erros = 0
        for i, item in enumerate(pendentes):
            cod = str(item["cod"])
            url = item.get("link") or f"{BASE_URL}/sistema/detalhe-imovel.asp?hdnimovel={cod}"

            try:
                page.goto(url, timeout=30_000, wait_until="domcontentloaded")
                html = page.content()

                if "erro ao tentar recuperar" in html.lower():
                    # sessão expirou — renova
                    print(f"  [{i+1}/{len(pendentes)}] Sessão expirada, renovando...", file=sys.stderr)
                    page.goto(BUSCA_URL, timeout=30_000, wait_until="domcontentloaded")
                    time.sleep(3)
                    page.goto(url, timeout=30_000, wait_until="domcontentloaded")
                    html = page.content()

                fields = extract_fields(html)
                existing[cod] = {
                    "cod": cod,
                    "formas_pagamento": fields["formas_pagamento"],
                    "regras_despesas": fields["regras_despesas"],
                }

                if (i + 1) % 50 == 0:
                    print(f"  [{i+1}/{len(pendentes)}] processados, salvando checkpoint...", file=sys.stderr)
                    save(existing)

            except Exception as e:
                erros += 1
                print(f"  [{i+1}/{len(pendentes)}] ERRO cod={cod}: {e}", file=sys.stderr)
                if erros > 20:
                    print("Muitos erros consecutivos, abortando.", file=sys.stderr)
                    break
            else:
                erros = 0

            time.sleep(DELAY_SEGUNDOS)

        browser.close()

    save(existing)
    print("Concluído.", file=sys.stderr)


if __name__ == "__main__":
    run()
