#!/usr/bin/env python3
"""
Baixa a lista completa de imóveis da Caixa (todos os estados) e gera o
arquivo data.json consumido pelo painel (index.html).

Uso:
    python scripts/update_data.py
"""

import json
import re
import sys
import urllib.request
from datetime import datetime, timezone

CSV_URL = "https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_geral.csv"
OUTPUT_PATH = "data.json"
DATA_DIR = "data"

KEY_MAP = {
    "n_imovel": "cod",
    "uf": "uf",
    "cidade": "cidade",
    "bairro": "bairro",
    "endereco": "endereco",
    "preco": "preco",
    "avaliacao": "avaliacao",
    "desconto": "desconto",
    "financiamento": "financiamento",
    "descricao": "descricao",
    "modalidade": "modalidade",
    "link": "link",
}


def fetch_csv_text(url: str) -> str:
    """Baixa o CSV e decodifica (latin1, formato padrão da Caixa)."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read()
    try:
        return raw.decode("latin1")
    except UnicodeDecodeError:
        return raw.decode("utf-8", errors="replace")


def parse_br_number(s: str):
    if s is None:
        return None
    s = s.strip()
    if s in ("", "-"):
        return None
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def parse_descricao(desc: str):
    out = {"tipo": "", "area": None, "area_priv": None, "quartos": None, "vagas": None}
    if not desc:
        return out
    out["tipo"] = desc.split(",")[0].strip()

    m = re.search(r"([\d]+\.[\d]+|\d+)\s*de\s*área\s*total", desc, re.I)
    if m:
        out["area"] = float(m.group(1))

    m = re.search(r"([\d]+\.[\d]+|\d+)\s*de\s*área\s*privativa", desc, re.I)
    if m:
        out["area_priv"] = float(m.group(1))

    m = re.search(r"(\d+)\s*qto", desc, re.I)
    if m:
        out["quartos"] = int(m.group(1))

    m = re.search(r"(\d+)\s*vaga", desc, re.I)
    if m:
        out["vagas"] = int(m.group(1))

    return out


def parse_csv(text: str):
    lines = [l for l in re.split(r"\r\n|\r|\n", text) if l.strip()]
    if len(lines) < 2:
        raise ValueError("Arquivo CSV vazio ou em formato inesperado.")

    gen_date = None
    m = re.search(r"(\d{2}/\d{2}/\d{4})", lines[0])
    if m:
        gen_date = m.group(1)

    header_idx = None
    for i in range(min(len(lines), 5)):
        if re.search(r"UF;\s*Cidade|N[°ºo]\s*do\s*im[oó]vel", lines[i], re.I):
            header_idx = i
            break
    if header_idx is None:
        header_idx = 1

    headers = [h.strip().lower() for h in lines[header_idx].split(";")]

    def col_index(*names):
        for name in names:
            for i, h in enumerate(headers):
                if name in h:
                    return i
        return -1

    idx = {
        "cod": col_index("imóvel", "imovel"),
        "uf": col_index("uf"),
        "cidade": col_index("cidade"),
        "bairro": col_index("bairro"),
        "endereco": col_index("endereço", "endereco"),
        "preco": col_index("preço", "preco"),
        "avaliacao": col_index("avaliação", "avaliacao"),
        "desconto": col_index("desconto"),
        "financiamento": col_index("financiamento"),
        "descricao": col_index("descrição", "descricao"),
        "modalidade": col_index("modalidade"),
        "link": col_index("link"),
    }

    if idx["cod"] == -1 or idx["preco"] == -1 or idx["cidade"] == -1:
        raise ValueError("Não foi possível identificar as colunas esperadas no CSV.")

    rows = []
    for line in lines[header_idx + 1:]:
        cols = line.split(";")
        if len(cols) < 3:
            continue
        cod_raw = cols[idx["cod"]].strip()
        if not cod_raw or not re.search(r"\d", cod_raw):
            continue

        desc = cols[idx["descricao"]].strip() if idx["descricao"] != -1 else ""
        parsed = parse_descricao(desc)

        desconto = None
        if idx["desconto"] != -1:
            draw = cols[idx["desconto"]].strip()
            if draw:
                try:
                    desconto = float(draw.replace(",", ".")) / 100
                except ValueError:
                    desconto = None

        rows.append({
            "cod": re.sub(r"\D", "", cod_raw),
            "uf": cols[idx["uf"]].strip() if idx["uf"] != -1 else "",
            "cidade": cols[idx["cidade"]].strip(),
            "bairro": cols[idx["bairro"]].strip() if idx["bairro"] != -1 else "",
            "endereco": cols[idx["endereco"]].strip() if idx["endereco"] != -1 else "",
            "tipo": parsed["tipo"],
            "area": parsed["area"],
            "area_priv": parsed["area_priv"],
            "quartos": parsed["quartos"],
            "vagas": parsed["vagas"],
            "preco": parse_br_number(cols[idx["preco"]]),
            "avaliacao": parse_br_number(cols[idx["avaliacao"]]) if idx["avaliacao"] != -1 else None,
            "desconto": desconto,
            "financiamento": cols[idx["financiamento"]].strip() if idx["financiamento"] != -1 else "",
            "modalidade": cols[idx["modalidade"]].strip() if idx["modalidade"] != -1 else "",
            "link": cols[idx["link"]].strip() if idx["link"] != -1 else "",
        })

    return rows, gen_date


def main():
    print(f"Baixando {CSV_URL} ...", file=sys.stderr)
    text = fetch_csv_text(CSV_URL)

    print("Processando CSV ...", file=sys.stderr)
    rows, gen_date = parse_csv(text)

    if not rows:
        raise SystemExit("Nenhum imóvel encontrado no CSV — abortando para não sobrescrever a base atual.")

    # agrupa por UF para manter cada arquivo pequeno (uploads e fetch mais leves)
    by_uf = {}
    for row in rows:
        by_uf.setdefault(row["uf"] or "—", []).append(row)

    import os
    os.makedirs(DATA_DIR, exist_ok=True)

    ufs_meta = []
    for uf in sorted(by_uf.keys()):
        items = by_uf[uf]
        fname = f"{uf}.json"
        with open(os.path.join(DATA_DIR, fname), "w", encoding="utf-8") as f:
            json.dump(items, f, ensure_ascii=False, separators=(",", ":"))
        ufs_meta.append({"uf": uf, "count": len(items), "file": f"{DATA_DIR}/{fname}"})

    index = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_date": gen_date,
        "total_count": len(rows),
        "ufs": ufs_meta,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))

    print(f"OK: {len(rows)} imóveis em {len(ufs_meta)} arquivos (pasta {DATA_DIR}/) "
          f"+ índice {OUTPUT_PATH} (data de geração da fonte: {gen_date})", file=sys.stderr)


if __name__ == "__main__":
    main()
