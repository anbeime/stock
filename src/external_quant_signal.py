# -*- coding: utf-8 -*-
"""外部量化引擎技术信号 → TOPGO LLM 分析 prompt 注入（第三层打通 · 实时重算版）。

2026-11-17 改造（用户决策）：数据源从"读静态 signals_dragon_YYYYMMDD.csv"
改为"每次分析用本地通达信当日数据 + 技术形态真重算"，彻底甩掉陈旧快照。

职责单一：按股票代码调 Antinet 擒龙引擎的当日实时重算结果，
渲染成一段带来源/数据日/时效标注的中文 prompt，供 pipeline 追加到
analysis_context_pack_summary（analyzer / agent 执行器会原样拼进 LLM prompt）。

设计约束（诚实原则）：
- 零 TOPGO 内部依赖：不 import src.* / api.*；只额外依赖 dual_energy 的实时引擎
  （通过 sys.path 注入，lazy import，引擎缺失/异常一律诚实返回 ""，绝不编造）。
- 只读真实重算：由 realtime_signal_engine 复用已投产 production_signal 的同一套
  DE-A / MF / 龙资格闸门 / 流动性预筛逻辑，全市场当日重算，不落盘。
- 精确匹配 code：6 位补零对齐，防止串票。
- 明确时效：写明数据日（本地行情库最新交易日）与距今天数，
  绝不说成"今日新信号"（行情库可能滞后，盘后产物）。
- 可关：DSA_EXTERNAL_QUANT_SIGNAL=0 整体停用；DSA_QUANT_REALTIME=0 时
  退回只读静态 CSV（兼容旧部署，默认走实时）。

用法（pipeline.py，签名未变）：
    from src.external_quant_signal import build_external_quant_signal_prompt
    seg, meta = build_external_quant_signal_prompt(
        code, report_language=report_language, return_meta=True)
"""
from __future__ import annotations

import csv
import glob
import os
from datetime import date, datetime
from typing import Any, Dict, Optional

# ---------------------------------------------------------------- 实时引擎（主路径）
_ENGINE_DIR = r"C:\D\zhiyi\quant_research\dual_energy"
# 静态 CSV 兜底目录（仅 DSA_QUANT_REALTIME=0 时用）
_SIGNAL_DIR = _ENGINE_DIR
_SIGNAL_GLOB = os.path.join(_SIGNAL_DIR, "signals_dragon_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9].csv")

_STRATEGY_LABELS = {
    "core": "核心仓（DE-A 大盘门控）",
    "core_DE-A": "核心仓（DE-A 大盘门控）",
    "satellite_MF": "卫星仓（主力控盘·资金回流）",
    "satellite": "卫星仓",
}
_GATE_LABELS = {"Y": "通过", "N": "未通过", "": "无数据"}


def _realtime_enabled() -> bool:
    return os.environ.get("DSA_QUANT_REALTIME", "1").strip() not in {"0", "false", "False", "NO", "no"}


def _call_realtime_engine(code: str):
    """返回 (row|None, meta|None)。引擎不可用/异常 → (None, None)，诚实不编造。"""
    if _ENGINE_DIR not in os.sys.path:
        os.sys.path.insert(0, _ENGINE_DIR)
    try:
        from realtime_signal_engine import signal_for_code  # lazy：引擎缺失不影响模块加载
        row, rmeta = signal_for_code(code)
    except Exception:
        return None, None
    if not row:
        return None, None
    return row, rmeta


# ---------------------------------------------------------------- 静态 CSV（仅兜底/兼容）
def _normalize_code(value: Any) -> str:
    text = str(value or "").strip().lstrip("\ufeff")
    digits = "".join(ch for ch in text if ch.isdigit())
    return digits.zfill(6) if digits else ""


def _load_csv_row(code: str):
    files = sorted(glob.glob(_SIGNAL_GLOB))
    if not files:
        return None, None
    want = _normalize_code(code)
    try:
        with open(files[-1], encoding="utf-8-sig", newline="") as fh:
            for row in csv.DictReader(fh):
                if _normalize_code(row.get("code")) == want:
                    return ({k: (v or "").strip() for k, v in row.items() if k},
                            {"source_file": os.path.basename(files[-1]), "realtime": False})
    except (OSError, UnicodeDecodeError, csv.Error):
        return None, None
    return None, None


def _parse_signal_date(text: str) -> Optional[date]:
    text = (text or "").strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except (ValueError, TypeError):
            continue
    return None


def _age_text(sig_date: Optional[date], today: date) -> str:
    if sig_date is None:
        return "时效未知"
    age = (today - sig_date).days
    if age < 0:
        return "时效未知"
    if age == 0:
        return "数据日当日"
    if age == 1:
        return "数据日次日"
    return f"距数据日 {age} 天（行情库滞后，仅供参考，勿当作今日新信号）"


def build_external_quant_signal_prompt(
    code: str,
    *,
    report_language: str = "zh",
    as_of_date: Optional[date] = None,
    return_meta: bool = False,
):
    """返回可追加进 analysis_context_pack_summary 的 prompt 段落。

    有真实信号 → 返回 '\\n## ' 开头段落；无信号/被关/引擎异常 → 返回 ""。
    return_meta=True → (prompt_text, meta_dict|None)。
    """
    empty = ("", None) if return_meta else ""
    if os.environ.get("DSA_EXTERNAL_QUANT_SIGNAL", "1").strip() in {"0", "false", "False", "NO", "no"}:
        return empty

    # ---- 主路径：当日实时重算 ----
    if _realtime_enabled():
        row, rmeta = _call_realtime_engine(code)
        if row:
            return _render_realtime(code, row, rmeta or {}, as_of_date, return_meta)
        # 引擎跑通但此票未过闸门 = 无信号，诚实返回空（不回退静态 CSV，避免旧快照污染）
        return empty

    # ---- 兜底：静态 CSV（仅显式关实时时） ----
    row, cmeta = _load_csv_row(code)
    if not row:
        return empty
    return _render_csv(code, row, cmeta or {}, as_of_date, return_meta)


def _render_realtime(code, row, rmeta, as_of_date, return_meta):
    sig_date = _parse_signal_date(row.get("signal_date") or rmeta.get("data_asof"))
    data_asof = rmeta.get("data_asof") or (sig_date.isoformat() if sig_date else "未知")
    today = as_of_date or date.today()
    age = _age_text(sig_date, today)

    strategy = _STRATEGY_LABELS.get(row.get("strategy"), row.get("strategy") or "未标注")
    gate = _GATE_LABELS.get(row.get("dragon_gate"), row.get("dragon_gate") or "无数据")
    sel_codes = rmeta.get("selected_codes") or []
    norm_code = _normalize_code(code)
    if row.get("selected") and norm_code in sel_codes:
        selected = "是（当日擒龙选中，第 %d 仓）" % (sel_codes.index(norm_code) + 1)
    else:
        selected = "否（过闸门候选，未进前仓）"

    lines = [
        "",
        "## 外部量化引擎技术信号（Antinet 擒龙引擎 · 当日实时重算，仅供参考）",
        f"- 标的：{_normalize_code(code)} {row.get('name') or ''}".rstrip(),
        f"- 数据日：{data_asof}；{age}",
        f"- 生成方式：**本次分析现调本地通达信全市场日K + 技术形态实时重算**，非静态信号文件快照",
        f"- 是否入选：{selected}",
        f"- 策略归属：{strategy}",
        f"- 龙头资格闸门（dragon_gate）：{gate}",
        f"- 量化评分（dragon_score）：{row.get('dragon_score') or 'N/A'}；技术强度：{row.get('strength') or 'N/A'}",
        f"- 参考价：{row.get('ref_close') or 'N/A'} 元；止损纪律：{row.get('stop_loss_pct') or 'N/A'}%",
        f"- 流动性排名分位：{row.get('liq_rank_pct') or 'N/A'}",
    ]
    note = row.get("note")
    if note:
        lines.append(f"- 交易备注：{note}")
    lines.append(
        "- 使用规则：以上为**外部技术选股引擎**基于本地行情库最新日的独立判断，来源=本次实时重算。"
        "请结合本次真实行情/新闻独立判断；若数据日滞后或与当前技术面矛盾，以当前数据为准，"
        "不得把该信号当作确定性结论，也不得虚构其未提供的字段。"
    )
    prompt = "\n".join(lines) + "\n"
    if not return_meta:
        return prompt

    meta: Dict[str, Any] = {
        "injected": True,
        "source": "Antinet 擒龙引擎（本地通达信当日实时重算）",
        "mode": "realtime",
        "data_asof": data_asof,
        "signal_date": row.get("signal_date") or data_asof,
        "age_days": (today - sig_date).days if sig_date and (today - sig_date).days >= 0 else None,
        "strategy": strategy,
        "dragon_gate": gate,
        "dragon_score": row.get("dragon_score") or None,
        "strength": row.get("strength") or None,
        "stop_loss_pct": row.get("stop_loss_pct") or None,
        "selected": bool(row.get("selected")),
        "market_up": rmeta.get("market_up"),
        "universe_size": rmeta.get("universe_size"),
        "kept_n": rmeta.get("kept_n"),
        "recompute_sec": rmeta.get("elapsed_sec"),
        "cache_hit": rmeta.get("cache_hit"),
        "note": "技术信号经当日实时重算注入 LLM 上下文，仅供参考；最终决策以本报告分析为准",
    }
    return prompt, meta


def _render_csv(code, row, cmeta, as_of_date, return_meta):
    """静态 CSV 兜底渲染（仅 DSA_QUANT_REALTIME=0）。"""
    sig_date = _parse_signal_date(row.get("signal_date"))
    today = as_of_date or date.today()
    age = _age_text(sig_date, today)
    strategy = _STRATEGY_LABELS.get(row.get("strategy"), row.get("strategy") or "未标注")
    gate = _GATE_LABELS.get(row.get("dragon_gate"), row.get("dragon_gate") or "无数据")
    lines = [
        "",
        "## 外部量化引擎技术信号（Antinet 擒龙引擎 · 静态快照，仅供参考）",
        f"- 标的：{_normalize_code(code)} {row.get('name') or ''}".rstrip(),
        f"- 信号日期：{row.get('signal_date') or '未知'}；{age}",
        f"- 生成方式：静态信号文件 {cmeta.get('source_file', '')}（非本次重算，可能滞后）",
        f"- 策略归属：{strategy}；闸门：{gate}；评分：{row.get('dragon_score') or 'N/A'}",
        f"- 参考价：{row.get('ref_close') or 'N/A'}；止损：{row.get('stop_loss_pct') or 'N/A'}%",
        "- 使用规则：外部技术引擎旧快照，仅供参考，以当前数据为准，不得当作今日新信号。",
    ]
    prompt = "\n".join(lines) + "\n"
    if not return_meta:
        return prompt
    meta = {
        "injected": True,
        "source": "Antinet 擒龙引擎（静态 CSV 快照）",
        "mode": "static_csv",
        "signal_date": row.get("signal_date"),
        "age_days": (today - sig_date).days if sig_date and (today - sig_date).days >= 0 else None,
        "strategy": strategy,
        "dragon_gate": gate,
        "note": "静态快照兜底（实时重算关闭）",
    }
    return prompt, meta


__all__ = ["build_external_quant_signal_prompt"]
