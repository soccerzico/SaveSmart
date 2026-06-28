"""Cashflow aggregation and savings-goal date projection.

Kept separate from the route modules so both the goals and recurring blueprints
can use it without importing each other.
"""
from datetime import date, timedelta
from math import ceil

from .models import RecurringTransaction

# Average days per month (365.25 / 12). Used to turn a "months to goal" figure
# into a concrete calendar date.
_DAYS_PER_MONTH = 30.4375


def monthly_cashflow(user_id: int) -> dict:
    """Sum a user's recurring items into monthly income, expense, and net.

    All figures are in (fractional) cents. `count` lets callers tell "no data
    entered yet" apart from "income and expenses happen to cancel out".
    """
    items = RecurringTransaction.query.filter_by(user_id=user_id).all()
    income = sum(i.monthly_cents for i in items if i.direction == "income")
    expense = sum(i.monthly_cents for i in items if i.direction == "expense")
    return {
        "income": income,
        "expense": expense,
        "net": income - expense,
        "count": len(items),
    }


def project_goal(goal, net_cents: float, has_recurring: bool, today: date = None) -> dict:
    """Estimate when a goal will be met given the monthly surplus.

    The projection optimistically assumes the *entire* monthly surplus is
    directed at this one goal (the frontend says as much), so multiple goals
    each show a "soonest possible" date rather than a contended one.

    Statuses:
      achieved    - already at/over target
      on_track    - positive surplus, returns projected_date + months_to_goal
      no_surplus  - expenses >= income, can't make progress
      no_data     - no recurring items entered yet
    """
    remaining = goal.target_cents - goal.current_cents

    if remaining <= 0:
        return _result("achieved", today or date.today(), 0, net_cents)
    if not has_recurring:
        return _result("no_data", None, None, 0)
    if net_cents <= 0:
        return _result("no_surplus", None, None, net_cents)

    months = remaining / net_cents
    projected = (today or date.today()) + timedelta(days=ceil(months * _DAYS_PER_MONTH))
    return _result("on_track", projected, round(months, 1), net_cents)


def _result(status, projected_date, months, contribution_cents) -> dict:
    iso = projected_date.isoformat() if isinstance(projected_date, date) else None
    return {
        "status": status,
        "projected_date": iso,
        "months_to_goal": months,
        "monthly_contribution": round(contribution_cents / 100, 2),
    }
