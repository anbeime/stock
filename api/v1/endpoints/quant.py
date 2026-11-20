# -*- coding: utf-8 -*-
"""
Antinet 量化融合后端 —— 自包含 FastAPI router。

定位：把「知易/Antinet 技术选股引擎」与「TOPGO 新闻/LLM 决策信号」在统一接口里融合，
      并桥接 QMT 自动交易（把擒龙【买入】信号 append 进共享日志 C:\\F\\sign.txt
      + 镜像到 C:\\F\\antinet_signals）。

重要口径：C:\\F\\sign.txt 是用户实时预警程序持续写入的共享日志，其中三金/强势狙击/
      V型反转/逃顶 等标签属于形态或【卖出】信号，与买入选股链路无关。
      本 router 只在 push-qmt 回显里读取「擒龙」标签行，绝不把 sign.txt 全量信号
      纳入候选池或前端买入视图。

设计原则：
- 零硬依赖 TOPGO 内部服务：只读我们自己的 signals_dragon_*.csv/.json 与 TOPGO 的
  stock_analysis.db（sqlite3 标准库即可），因此既能独立轻量启动验证 MVP，
  也能原样 drop-in 挂进 TOPGO 真实后端（api/v1/endpoints/quant.py + 在 api/app.py 注册）。
- 路径全部绝对化（Windows），与本机国泰君安离线数据、QMT 预警目录对齐。
- 挂载约定：本 router 只定义 /quant/* 路径，由宿主以 prefix="/api/v1" 挂入，
  最终对外为 /api/v1/quant/*（与 TOPGO 现有 /api/v1/decision-signals 同级）。
"""
import os
import glob
import csv
import json
import shutil
import subprocess
import sqlite3
import sys
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

# ---- 路径常量（全部可移植：项目内路径基于 __file__ 推导，外部数据路径走环境变量）----
# 红标：禁止把磁盘目录名写死在代码里——品牌改名/换机器/换目录都会指向不存在的路径，
# 导致 K 线/回测取数静默失败。项目内路径动态推导；跨项目外部数据源走环境变量覆盖，
# 默认值仅作为本机开发便利，部署到其他机器时设同名环境变量即可，无需改代码。
_REPO_ROOT = Path(__file__).resolve().parents[3]  # endpoints/v1/api -> 项目根
DSA_DB = str(_REPO_ROOT / "data" / "stock_analysis.db")
# venv 位于项目根的上一级（本机布局 <parent>/<repo>/.venv）；exe 在 Win/类 Unix 下位置不同
_VENV_DIR = _REPO_ROOT.parent / ".venv"
VENV_PY = str(
    os.environ.get("TOPGO_VENV_PY")
    or str(_VENV_DIR / ("Scripts/python.exe" if os.name == "nt" else "bin/python"))
)
# 外部协作目录：知易量化研究（dual_energy 策略脚本）、QMT 实时预警日志与信号镜像。
# 这些不在本仓库内，无法用 __file__ 推导，改为环境变量可配置（本机默认值保留）。
DUAL_ENERGY_DIR = os.environ.get("TOPGO_DUAL_ENERGY_DIR") or r"C:\D\zhiyi\quant_research\dual_energy"
SIGN_TXT = os.environ.get("TOPGO_SIGN_TXT") or r"C:\F\sign.txt"
ANTINET_SIGNALS_DIR = os.environ.get("TOPGO_ANTINET_SIGNALS_DIR") or r"C:\F\antinet_signals"

# 两个 router：
# - quant_router：自研量化核心（/quant/*）。TOPGO drop-in 只挂这个。
# - compat_router：TOPGO 前端兼容桩（空态）。仅独立轻量启动器使用——
#   灌进 TOPGO 真后端时绝不挂载，否则会遮蔽真实现（Starlette 先注册先匹配）。
quant_router = APIRouter()
compat_router = APIRouter()


# ---- TOPGO 前端启动兼容桩 ----
# TOPGO 前端首屏会探测自身后端的认证状态；本轻量服务无认证层，
# 返回「无密码模式」结构（topgo-web api/auth.ts AuthStatusResponse）直接放行，
# 避免前端 404 卡在登录守卫。
@compat_router.get("/auth/status")
def dsa_auth_status_compat():
    return {
        "authEnabled": False,
        "loggedIn": True,
        "passwordSet": False,
        "passwordChangeable": False,
        "setupState": "no_password",
    }


# TOPGO 首页轮询的自家端点兼容桩：返回「诚实空态」（TOPGO 分析引擎未在本服务运行，
# 历史记录/自选/任务本就为空），避免前端 404 与 SSE 重连风暴。
# 结构依据 topgo-web 源码消费点：history→response.items；watchlist→stock_codes；
# analysis/tasks→response.tasks；skills→{skills, default_skill_id}；setup→isComplete。
@compat_router.get("/agent/skills")
def dsa_skills_compat():
    return {"skills": [], "default_skill_id": ""}


@compat_router.get("/system/config/setup/status")
def dsa_setup_status_compat():
    return {
        "is_complete": True,
        "ready_for_smoke": True,
        "required_missing_keys": [],
        "next_step_key": None,
        "checks": [],
    }


@compat_router.get("/history")
def dsa_history_compat(request: "Request"):
    qp = request.query_params
    return {"items": [], "total": 0,
            "page": int(qp.get("page", 1)), "limit": int(qp.get("limit", 20))}


@compat_router.get("/history/stocks")
def dsa_history_stocks_compat(request: "Request"):
    return {"items": [], "total": 0}


@compat_router.get("/stocks/watchlist")
def dsa_watchlist_compat():
    return {"stock_codes": []}


@compat_router.get("/analysis/tasks")
def dsa_analysis_tasks_compat(request: "Request"):
    return {"tasks": [], "total": 0}


@compat_router.post("/analysis/market-review")
def dsa_market_review_compat():
    """诚实拒绝：轻量模式无 LLM 流水线，不能假 202。

    前端首页「生成大盘复盘」按钮 POST 此端点；没有本桩时请求会命中
    SPA 的 GET 兜底路由 → 405 Method Not Allowed。返回 503 让前端
    走错误提示路径，明确指引切换 start_fusion_backend.bat 真后端。
    """
    raise HTTPException(
        status_code=503,
        detail={
            "message": "大盘复盘需要 TOPGO 真后端的 LLM 流水线。"
                       "请关闭当前窗口并运行 start_fusion_backend.bat 后重试。",
            "code": "lightweight_mode_unavailable",
        },
    )


@compat_router.get("/analysis/tasks/stream")
async def dsa_tasks_stream_compat():
    """SSE 空流：保持连接 + 心跳，防前端断线重连刷屏。不发任何任务事件。"""
    import asyncio
    from fastapi.responses import StreamingResponse

    async def _heartbeat():
        yield ": connected\n\n"
        while True:
            await asyncio.sleep(15)
            yield ": ping\n\n"

    return StreamingResponse(
        _heartbeat(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@compat_router.get("/agent/status")
def dsa_agent_status_compat():
    # AgentBackendStatusResponse（types/systemConfig.ts，toCamelCase 前为 snake_case）：
    # 本轻量服务不跑 TOPGO 问股 Agent，如实返回 available=false。
    return {
        "backend": "builtin",
        "available": False,
        "experimental": False,
        "version": None,
        "error_code": None,
        "message": "本量化融合服务未运行 TOPGO 问股 Agent；量化选股请用侧栏「量化选股」页。",
    }


@compat_router.get("/agent/chat/sessions")
def dsa_chat_sessions_compat(request: "Request"):
    # ChatSessionItem[]：session_id/title/message_count/created_at/last_active。
    return {"sessions": []}


@compat_router.get("/system/config")
def dsa_system_config_compat(request: "Request"):
    # SystemConfigResponse：config_version/mask_token/items（toCamelCase 后
    # configVersion/maskToken/items）。设置页在本服务不适用，返回空配置。
    return {
        "config_version": "v1",
        "mask_token": "******",
        "items": [],
        "llm_model_providers": [],
        "updated_at": None,
    }


@compat_router.get("/screening/status")
def dsa_screening_status_compat():
    # ScreeningStatus（api/screening.ts）：enabled/available/engine/strategy_count。
    # TOPGO builtin 选股引擎未在本服务运行，如实返回 disabled。
    return {
        "enabled": False,
        "available": False,
        "engine": "builtin",
        "contract_version": None,
        "version": None,
        "strategy_count": 0,
    }


@compat_router.get("/data/overview")
def dsa_data_overview_compat():
    # RawOverview（api/dataCapability.ts）：as_of/providers/datasets/priorities/warnings。
    return {
        "as_of": datetime.now().strftime("%Y-%m-%d"),
        "providers": [],
        "datasets": [],
        "priorities": [],
        "warnings": [],
    }


@compat_router.get("/usage/dashboard")
def dsa_usage_dashboard_compat(request: "Request"):
    # UsageDashboard（api/usage.ts，toCamelCase 前为 snake_case）：LLM 用量空态。
    today = datetime.now().strftime("%Y-%m-%d")
    return {
        "period": request.query_params.get("period", "month"),
        "from_date": today,
        "to_date": today,
        "total_calls": 0,
        "total_prompt_tokens": 0,
        "total_completion_tokens": 0,
        "total_tokens": 0,
        "by_call_type": [],
        "by_model": [],
        "recent_calls": [],
    }


@compat_router.get("/alerts/rules")
def dsa_alerts_rules_compat(request: "Request"):
    # AlertRuleListResponse（types/alerts.ts）。
    qp = request.query_params
    return {"items": [], "total": 0,
            "page": int(qp.get("page", 1)), "page_size": int(qp.get("page_size", 20)),
            "rule_sources": None}


@compat_router.get("/backtest/results")
def dsa_backtest_results_compat(request: "Request"):
    # BacktestResultsResponse（api/backtest.ts getResults）：{total,page,limit,items}。
    qp = request.query_params
    return {"items": [], "total": 0,
            "page": int(qp.get("page", 1)), "limit": int(qp.get("limit", 20))}


# 注：/backtest/performance 不桩——前端 getOverallPerformance 刻意把 404 当
# 「暂无绩效数据」处理（catch 404 → null），按 TOPGO 设计保留。


@compat_router.get("/decision-signals")
def dsa_decision_signals_list_compat(request: "Request"):
    # DecisionSignalListResponse（types/decisionSignals.ts）：items 必须是数组。
    qp = request.query_params
    return {"items": [], "total": 0,
            "page": int(qp.get("page", 1)), "page_size": int(qp.get("page_size", 20))}


@compat_router.get("/decision-signals/outcomes/stats")
def dsa_decision_signals_outcomes_stats_compat():
    # DecisionSignalOutcomeStatsResponse（types/decisionSignals.ts:291）：全零空态。
    return {
        "engine_version": "v0",
        "horizons": None,
        "statuses": [],
        "total": 0,
        "completed": 0,
        "unable": 0,
        "hit": 0,
        "miss": 0,
        "neutral": 0,
        "hit_rate_pct": None,
        "avg_stock_return_pct": None,
        "unable_reasons": {},
        "breakdowns": {},
    }


@compat_router.get("/portfolio/accounts")
def dsa_portfolio_accounts_compat(request: "Request"):
    # PortfolioAccountListResponse：{accounts: []}。
    return {"accounts": []}


@compat_router.get("/portfolio/snapshot")
def dsa_portfolio_snapshot_compat():
    # PortfolioSnapshotResponse（types/portfolio.ts:83）：零仓位空态。
    return {
        "as_of": datetime.now().strftime("%Y-%m-%d"),
        "cost_method": "fifo",
        "currency": "CNY",
        "account_count": 0,
        "total_cash": 0.0,
        "total_market_value": 0.0,
        "total_equity": 0.0,
        "realized_pnl": 0.0,
        "unrealized_pnl": 0.0,
        "fee_total": 0.0,
        "tax_total": 0.0,
        "fx_stale": False,
        "accounts": [],
    }


@compat_router.get("/portfolio/trades")
def dsa_portfolio_trades_compat(request: "Request"):
    # PortfolioTradeListResponse：{items,total,page,page_size}。
    qp = request.query_params
    return {"items": [], "total": 0,
            "page": int(qp.get("page", 1)), "page_size": int(qp.get("page_size", 20))}


@compat_router.get("/portfolio/imports/csv/brokers")
def dsa_portfolio_brokers_compat():
    # PortfolioImportBrokerListResponse：{brokers: []}。
    return {"brokers": []}


@compat_router.get("/alerts/triggers")
def dsa_alerts_triggers_compat(request: "Request"):
    # AlertTriggerListResponse（types/alerts.ts:130）。
    qp = request.query_params
    return {"items": [], "total": 0,
            "page": int(qp.get("page", 1)), "page_size": int(qp.get("page_size", 20))}


@compat_router.get("/alerts/notifications")
def dsa_alerts_notifications_compat(request: "Request"):
    # AlertNotificationListResponse（types/alerts.ts:150）。
    qp = request.query_params
    return {"items": [], "total": 0,
            "page": int(qp.get("page", 1)), "page_size": int(qp.get("page_size", 20))}


@compat_router.get("/portfolio/risk")
def dsa_portfolio_risk_compat():
    # PortfolioRiskResponse（types/portfolio.ts:153）：零仓位空态，无集中度告警。
    return {
        "as_of": datetime.now().strftime("%Y-%m-%d"),
        "account_id": None,
        "cost_method": "fifo",
        "currency": "CNY",
        "thresholds": {},
        "concentration": {
            "total_market_value": 0.0,
            "top_weight_pct": 0.0,
            "alert": False,
            "top_positions": [],
        },
        "sector_concentration": {
            "total_market_value": 0.0,
            "top_weight_pct": 0.0,
            "alert": False,
            "top_sectors": [],
            "coverage": {},
            "errors": [],
        },
    }


def _f(v: Any) -> Optional[float]:
    """安全转 float，失败返回 None。"""
    try:
        if v is None or v == "":
            return None
        return float(v)
    except (ValueError, TypeError):
        return None


def _latest_signal_file():
    """返回 (csv_path, json_path_or_None, asof_str)。取日期最大的一份。

    只认 signals_dragon_8位数字.csv（tdx 真信号），排除 signals_sina_* 与
    signals_dragon_dsa_* 等调试/适配产物（其文件名含字母，字典序会排在数字后，
    导致误选“最新”）。
    """
    pat = os.path.join(DUAL_ENERGY_DIR, "signals_dragon_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9].csv")
    files = glob.glob(pat)
    if not files:
        return None, None, None
    files.sort()
    csvp = files[-1]
    asof = os.path.basename(csvp).replace("signals_dragon_", "").replace(".csv", "")
    jsonp = os.path.join(DUAL_ENERGY_DIR, f"signals_dragon_{asof}.json")
    return csvp, (jsonp if os.path.exists(jsonp) else None), asof


@quant_router.get("/quant/signals")
def get_signals() -> Dict[str, Any]:
    """我们的技术选股信号（DE-A 核心 + MF 卫星 + 龙资格闸门 + 新闻匹配层）。"""
    csvp, jsonp, asof = _latest_signal_file()
    if not csvp:
        return {"as_of": None, "signals": [], "summary": {}}
    signals: List[Dict[str, Any]] = []
    with open(csvp, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            signals.append({
                "code": (row.get("code") or "").strip(),
                "name": (row.get("name") or "").strip(),
                "strategy": (row.get("strategy") or "").strip(),
                "signal_date": (row.get("signal_date") or "").strip(),
                "ref_close": _f(row.get("ref_close")),
                "weight_pct": _f(row.get("weight_pct")),
                "stop_loss_pct": _f(row.get("stop_loss_pct")),
                "liq_rank_pct": _f(row.get("liq_rank_pct")),
                "strength": _f(row.get("strength")),
                "dragon_score": _f(row.get("dragon_score")),
                "dragon_gate": (row.get("dragon_gate") or "").strip(),
                "sentiment": _f(row.get("sentiment")),
                "from_news": (row.get("from_news") or "").strip(),
                "news_confirmed": (row.get("news_confirmed") or "").strip(),
                "note": (row.get("note") or "").strip(),
            })
    summary: Dict[str, Any] = {}
    if jsonp:
        try:
            with open(jsonp, encoding="utf-8") as jf:
                summary = json.load(jf)
        except Exception:
            summary = {}
    return {"as_of": asof, "signals": signals, "summary": summary}


@quant_router.get("/quant/dragon-board")
def get_dragon_board(date: Optional[str] = None) -> Dict[str, Any]:
    """超短打板复盘快照（东财 push2ex 真实数据，扣子导出包接口契约复用）。
    date 格式 YYYYMMDD，不传取最近交易日。题材热度=涨停股行业分布（诚实标注）。"""
    try:
        import importlib.util
        mod_path = os.path.join(DUAL_ENERGY_DIR, "dragon_board.py")
        spec = importlib.util.spec_from_file_location("_dragon_board", mod_path)
        if spec is None or spec.loader is None:
            return {"ok": False, "error": "dragon_board module not loadable"}
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.get_board_snapshot(date=date)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:160]}"}


@quant_router.get("/quant/sector-board")
def get_sector_board() -> Dict[str, Any]:
    """概念/行业板块涨跌榜（东财 push2 clist 真实数据）。
    每类含涨幅榜/跌幅榜 top + 领涨股，60 秒缓存，失败返回 ok:false 不编造。"""
    try:
        import importlib.util
        mod_path = os.path.join(DUAL_ENERGY_DIR, "sector_board.py")
        spec = importlib.util.spec_from_file_location("_sector_board", mod_path)
        if spec is None or spec.loader is None:
            return {"ok": False, "error": "sector_board module not loadable"}
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.get_sector_snapshot()
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:160]}"}


@quant_router.get("/quant/status")
def get_status() -> Dict[str, Any]:
    """管线运行状态（市场多空门控、龙资格、上次运行）。"""
    _, jsonp, asof = _latest_signal_file()
    if not jsonp:
        return {"as_of": None, "market_up": None, "dragon_gate_enabled": None,
                "last_run": None}
    try:
        with open(jsonp, encoding="utf-8") as jf:
            s = json.load(jf)
    except Exception:
        s = {}
    return {
        "as_of": asof,
        "market_up": s.get("market_up"),
        "dragon_gate_enabled": s.get("dragon_gate_enabled"),
        "universe_size": s.get("universe_size"),
        "liquidity_kept": s.get("liquidity_kept"),
        "selected": s.get("selected"),
        "core_n": s.get("core_n"),
        "satellite_n": s.get("satellite_n"),
        "ticket": s.get("ticket"),
        "elapsed_sec": s.get("elapsed_sec"),
    }


@quant_router.get("/quant/decision-signals")
def get_dsa_decision_signals(limit: int = 50) -> Dict[str, Any]:
    """TOPGO 库中的新闻/LLM 决策信号（与我们的技术信号并列展示）。"""
    if not os.path.exists(DSA_DB):
        return {"source": "dsa", "available": False, "signals": [],
                "reason": "stock_analysis.db 不存在"}
    try:
        c = sqlite3.connect(DSA_DB)
        c.row_factory = sqlite3.Row
        cur = c.cursor()
        cur.execute(
            "SELECT id,stock_code,stock_name,market,action,action_label,"
            "confidence,score,horizon,entry_low,entry_high,stop_loss,"
            "target_price,reason,status,created_at FROM decision_signals "
            "ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
        rows = [dict(r) for r in cur.fetchall()]
        c.close()
        return {"source": "dsa", "available": True, "signals": rows}
    except Exception as e:
        return {"source": "dsa", "available": False, "signals": [],
                "reason": str(e)}


@quant_router.get("/quant/merged")
def get_merged() -> Dict[str, Any]:
    """融合视图：技术信号 + TOPGO 决策信号，供统一仪表盘一次拉取。"""
    return {
        "technical": get_signals(),
        "dsa_decision": get_dsa_decision_signals(limit=50),
    }


class PushRequest(BaseModel):
    regenerate: bool = False  # True=重新跑选股管线；False=仅把现有信号写进 QMT


@quant_router.post("/quant/push-qmt")
def push_qmt(req: PushRequest) -> Dict[str, Any]:
    """桥接 QMT 自动交易（仅买入侧）：
       1) (可选)重新跑 production_signal 选股；
       2) 运行 sign_txt_adapter 把擒龙【买入】信号 append 进 C:\\F\\sign.txt；
          sign.txt 中其他标签(含「逃顶」卖出信号)一律不读取、不改判、不纳入；
       3) 镜像最新 CSV 到 C:\\F\\antinet_signals（QMT 策略读取目录）。
    """
    log: List[str] = []
    if req.regenerate:
        try:
            r = subprocess.run(
                [VENV_PY, os.path.join(DUAL_ENERGY_DIR, "production_signal.py"),
                 "--source", "tdx"],
                cwd=DUAL_ENERGY_DIR, capture_output=True, text=True, timeout=480,
            )
            log.append("production_signal exit=%d" % r.returncode)
            if r.returncode != 0:
                log.append((r.stderr or r.stdout)[-600:])
        except Exception as e:
            log.append("production_signal ERR: %s" % e)

    try:
        r2 = subprocess.run(
            [VENV_PY, os.path.join(DUAL_ENERGY_DIR, "sign_txt_adapter.py")],
            cwd=DUAL_ENERGY_DIR, capture_output=True, text=True, timeout=120,
        )
        log.append("sign_txt_adapter exit=%d" % r2.returncode)
        if r2.returncode != 0:
            log.append((r2.stderr or r2.stdout)[-600:])
    except Exception as e:
        log.append("sign_txt_adapter ERR: %s" % e)

    csvp, _, asof = _latest_signal_file()
    if csvp and os.path.isdir(ANTINET_SIGNALS_DIR):
        try:
            shutil.copy2(csvp, os.path.join(ANTINET_SIGNALS_DIR,
                                            os.path.basename(csvp)))
            log.append("mirror %s -> antinet_signals" % os.path.basename(csvp))
        except Exception as e:
            log.append("mirror ERR: %s" % e)

    # 回显已落 QMT 的【买入】信号：只取「擒龙」标签行。
    # sign.txt 其余行(三金/强势狙击/V型反转/逃顶)属实时预警程序的形态/卖出信号,
    # 与买入无关, 不回显、不混入。
    last_line = ""
    if os.path.exists(SIGN_TXT):
        try:
            with open(SIGN_TXT, "rb") as f:
                raw = f.read().decode("gbk", errors="replace")
            lines = [l for l in raw.split("\n") if l.strip()]
            ql = [l for l in lines if "擒龙" in l]
            last_line = ql[-1] if ql else (lines[-1] if lines else "")
        except Exception:
            last_line = ""
    return {"ok": True, "as_of": asof, "log": log, "last_sign_line": last_line}


def _ma(values: List[float], window: int) -> List[Optional[float]]:
    """简单移动平均，前 window-1 位为 None（不做未来函数、不前向填充）。"""
    out: List[Optional[float]] = []
    running = 0.0
    for i, v in enumerate(values):
        running += v
        if i >= window:
            running -= values[i - window]
        out.append(round(running / window, 3) if i >= window - 1 else None)
    return out


@quant_router.get("/quant/chart/{code}")
def get_chart(code: str, days: int = 120) -> Dict[str, Any]:
    """K 线聚合端点：真实 OHLCV + MA5/10/20/60 + 买卖点标记。

    数据源全部现成、零新增依赖：
    - K 线：复用 TOPGO StockService.get_history_data（Tushare/PyTDX/AKShare 真数据）
    - 买入点 B：
        * TOPGO decision_signals 里该股 action∈{buy,add,hold} 且带 entry_low/high
          -> 在 created_at 对应交易日附近画 B，价格用 entry_low
        * 擒龙技术信号 signals_dragon_*.csv 里 code 命中 signal_date/ref_close -> 画 B
    - 卖出点 S：decision_signals 里 action∈{reduce,sell,close} -> 画 S，价格用 target_price/stop_loss
    - 决策区间：最新一条 decision_signal 的 entry_low/entry_high/stop_loss/target_price
      （截图里的 28.60 标注即 entry_high）

    均线在前端二次计算亦可，但放后端一次算好，前端只负责画，口径统一。
    """
    code = (code or "").strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(status_code=400, detail="invalid stock code")

    # 1) K 线（复用 TOPGO 取数，真实数据）
    try:
        from src.services.stock_service import StockService
        hist = StockService().get_history_data(code, period="daily", days=days)
        rows = hist.get("data", []) if isinstance(hist, dict) else []
    except Exception as e:
        return {"ok": False, "code": code, "error": "kline source: %s" % e,
                "candles": [], "marks": [], "ma": {}, "levels": None}
    candles = [
        {
            "date": str(r.get("date") or "")[:10],
            "open": _f(r.get("open")), "high": _f(r.get("high")),
            "low": _f(r.get("low")), "close": _f(r.get("close")),
            "volume": _f(r.get("volume")),
        }
        for r in rows if r.get("date") and r.get("close") is not None
    ]
    if not candles:
        return {"ok": True, "code": code, "name": (hist or {}).get("stock_name"),
                "candles": [], "marks": [], "ma": {}, "levels": None,
                "note": "无 K 线数据（非交易日或数据源未覆盖）"}

    dates = [c["date"] for c in candles]
    closes = [c["close"] for c in candles]
    ma = {
        "ma5": _ma(closes, 5), "ma10": _ma(closes, 10),
        "ma20": _ma(closes, 20), "ma60": _ma(closes, 60),
    }

    def nearest_idx(date_str: str) -> Optional[int]:
        """把信号日期对齐到最近的交易日（信号可能落在周末/停牌日）。"""
        if not date_str:
            return None
        d = str(date_str)[:10]
        if d in dates:
            return dates.index(d)
        later = [i for i, x in enumerate(dates) if x > d]
        return later[0] if later else (len(dates) - 1 if dates else None)

    marks: List[Dict[str, Any]] = []
    levels: Optional[Dict[str, Any]] = None

    # 2) TOPGO 决策信号 -> B/S 标记 + 决策价位区间（真实 DB）
    try:
        conn = sqlite3.connect(DSA_DB)
        conn.row_factory = sqlite3.Row
        dr = conn.execute(
            "SELECT action, action_label, entry_low, entry_high, stop_loss, target_price, "
            "created_at, status, reason FROM decision_signals WHERE stock_code=? "
            "ORDER BY created_at DESC LIMIT 20", (code,)
        ).fetchall()
        # 同一交易日同一方向只保留最新一条决策（用户反复重跑分析会产生多条 expired 历史记录）
        # key=(映射idx, kind)，value=最新记录；避免同一天冒出多个重复买卖点
        latest_by_day: Dict[tuple, Dict[str, Any]] = {}
        for row in dr:
            d = dict(row)
            idx = nearest_idx(d.get("created_at") or "")
            if idx is None:
                continue
            action = (d.get("action") or "").lower()
            if action in ("reduce", "sell", "close"):
                kind = "S"
            elif action in ("buy", "add", "hold"):
                kind = "B"
            else:
                # watch/avoid 等非交易决策不入买卖点，但可继续用于 levels
                kind = None
            if kind is not None:
                key = (idx, kind)
                # dr 已按 created_at DESC，第一条即最新；仅保留首次出现
                if key not in latest_by_day:
                    latest_by_day[key] = (d, idx, kind)
            if levels is None and any(d.get(k) is not None for k in
                                      ("entry_low", "entry_high", "stop_loss", "target_price")):
                levels = {"entry_low": _f(d.get("entry_low")),
                          "entry_high": _f(d.get("entry_high")),
                          "stop_loss": _f(d.get("stop_loss")),
                          "target_price": _f(d.get("target_price")),
                          "action": d.get("action"), "action_label": d.get("action_label"),
                          "status": d.get("status"),
                          "as_of": (d.get("created_at") or "")[:10]}
        for d, idx, kind in latest_by_day.values():
            action = (d.get("action") or "").lower()
            if kind == "S":
                px = _f(d.get("target_price")) or candles[idx]["close"]
                marks.append({"kind": "S", "date": dates[idx], "index": idx,
                              "price": px, "label": d.get("action_label") or "卖出",
                              "source": "dsa_decision"})
            else:
                px = _f(d.get("entry_low")) or candles[idx]["close"]
                marks.append({"kind": "B", "date": dates[idx], "index": idx,
                              "price": px, "label": d.get("action_label") or "买入",
                              "source": "dsa_decision"})
        conn.close()
    except Exception:
        pass

    # 3) 擒龙技术买入信号 -> B（真实 CSV）
    try:
        csvp, _, _ = _latest_signal_file()
        if csvp:
            with open(csvp, encoding="utf-8-sig", newline="") as f:
                for row in csv.DictReader(f):
                    if (row.get("code") or "").strip() != code:
                        continue
                    idx = nearest_idx(row.get("signal_date") or "")
                    if idx is None:
                        continue
                    marks.append({"kind": "B", "date": dates[idx], "index": idx,
                                  "price": _f(row.get("ref_close")) or candles[idx]["close"],
                                  "label": "擒龙买入", "source": "dragon"})
    except Exception:
        pass

    marks.sort(key=lambda m: m["index"])

    # 4) 通达信主图指标叠加（纯 Python 实现，零新增依赖；未来函数已标注）
    overlay = {}
    try:
        import importlib.util as _ilu
        _ov_path = os.path.join(DUAL_ENERGY_DIR, "tdx_overlay.py")
        _spec = _ilu.spec_from_file_location("_tdx_overlay", _ov_path)
        if _spec and _spec.loader:
            _ov = _ilu.module_from_spec(_spec)
            _spec.loader.exec_module(_ov)
            overlay = _ov.compute_overlay(candles)
    except Exception as e:
        overlay = {"note": "主图指标计算失败: %s" % e}

    # 5) 通达信多空能量副图（纯 Python 实现，零新增依赖）
    subchart = {}
    try:
        import importlib.util as _ilu2
        _ilu = _ilu2  # 独立于主图步骤，避免其异常导致未绑定
        _sp_path = os.path.join(DUAL_ENERGY_DIR, "tdx_subchart.py")
        _sp_spec = _ilu.spec_from_file_location("_tdx_subchart", _sp_path)
        if _sp_spec and _sp_spec.loader:
            _sp = _ilu.module_from_spec(_sp_spec)
            _sp_spec.loader.exec_module(_sp)
            subchart = _sp.compute_subchart(candles)
    except Exception as e:
        subchart = {"note": "副图指标计算失败: %s" % e}

    return {"ok": True, "code": code, "name": (hist or {}).get("stock_name"),
            "as_of": dates[-1], "count": len(candles),
            "candles": candles, "ma": ma, "marks": marks, "levels": levels,
            "overlay": overlay, "subchart": subchart}


# ---- 组合 router：独立轻量启动器（quant_server.py）用 ----
# TOPGO drop-in 时改为只挂 quant_router（兼容桩由 TOPGO 真实现取代）。
router = APIRouter()
router.include_router(quant_router)
router.include_router(compat_router)
