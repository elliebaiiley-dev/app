"""Tests for booking/payment/status fixes (iteration 2)."""
import os
import pytest
import requests
from datetime import datetime, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://petadmin-mvp.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

EMAIL = "demo@petadmin.app"
PASSWORD = "petadmin123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def ctx(h):
    """Return (customer_id, pet_id, service_id) usable for creating bookings."""
    cs = requests.get(f"{API}/customers", headers=h, timeout=30).json()
    assert cs, "no customers seeded"
    customer = cs[0]
    pet = customer["pets"][0]
    svcs = requests.get(f"{API}/services", headers=h, timeout=30).json()
    svc = next((s for s in svcs if not s.get("deleted_at")), svcs[0])
    return customer["id"], pet["id"], svc["id"], float(svc["price"])


def _make_booking(h, ctx, status=None, start_at=None):
    cid, pid, sid, _ = ctx
    body = {
        "customer_id": cid,
        "pet_id": pid,
        "service_id": sid,
        "start_at": start_at or (datetime.utcnow() + timedelta(days=3)).replace(microsecond=0).isoformat(),
    }
    if status:
        body["status"] = status
    r = requests.post(f"{API}/bookings", headers=h, json=body, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# ---- GET /api/bookings/{id} enrichment ----
def test_get_booking_returns_breakdown(h, ctx):
    b = _make_booking(h, ctx)
    r = requests.get(f"{API}/bookings/{b['id']}", headers=h, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "price" in data and "paid_total" in data and "outstanding" in data
    assert isinstance(data["payments"], list)
    assert data["paid_total"] == 0
    assert data["outstanding"] == data["price"]


# ---- POST /api/payments updates paid_total / outstanding ----
def test_payment_updates_booking_breakdown(h, ctx):
    b = _make_booking(h, ctx)
    price = b["price"]
    pay = requests.post(
        f"{API}/payments",
        headers=h,
        json={"booking_id": b["id"], "amount": price / 2, "method": "cash"},
        timeout=30,
    )
    assert pay.status_code == 200, pay.text
    r = requests.get(f"{API}/bookings/{b['id']}", headers=h, timeout=30).json()
    assert round(r["paid_total"], 2) == round(price / 2, 2)
    assert round(r["outstanding"], 2) == round(price / 2, 2)
    assert len(r["payments"]) == 1
    # pay in full
    pay2 = requests.post(
        f"{API}/payments",
        headers=h,
        json={"booking_id": b["id"], "amount": price / 2, "method": "card"},
        timeout=30,
    )
    assert pay2.status_code == 200
    r2 = requests.get(f"{API}/bookings/{b['id']}", headers=h, timeout=30).json()
    assert round(r2["paid_total"], 2) == round(price, 2)
    assert r2["outstanding"] == 0


# ---- status persists ----
def test_status_persistence_all_values(h, ctx):
    b = _make_booking(h, ctx)
    for s in ["completed", "cancelled", "no_show", "confirmed"]:
        r = requests.post(f"{API}/bookings/{b['id']}/status", headers=h, json={"status": s}, timeout=30)
        assert r.status_code == 200, r.text
        got = requests.get(f"{API}/bookings/{b['id']}", headers=h, timeout=30).json()
        assert got["status"] == s, f"expected {s} got {got['status']}"


# ---- default status is confirmed ----
def test_default_status_confirmed(h, ctx):
    cid, pid, sid, _ = ctx
    r = requests.post(
        f"{API}/bookings",
        headers=h,
        json={
            "customer_id": cid,
            "pet_id": pid,
            "service_id": sid,
            "start_at": (datetime.utcnow() + timedelta(days=5)).replace(microsecond=0).isoformat(),
        },
        timeout=30,
    )
    assert r.status_code == 200
    assert r.json()["status"] == "confirmed"


# ---- past booking stays confirmed (no auto-complete) ----
def test_past_confirmed_booking_not_auto_completed(h, ctx):
    past = (datetime.utcnow() - timedelta(days=2)).replace(microsecond=0).isoformat()
    b = _make_booking(h, ctx, status="confirmed", start_at=past)
    # Simulate the dashboard query + a repeat GET to detect any lingering auto-side-effect
    requests.get(f"{API}/dashboard", headers=h, timeout=30)
    requests.get(f"{API}/bookings", headers=h, timeout=30)
    got = requests.get(f"{API}/bookings/{b['id']}", headers=h, timeout=30).json()
    assert got["status"] == "confirmed", f"status auto-changed to {got['status']}"


# ---- dashboard outstanding includes non-cancelled unpaid bookings ----
def test_dashboard_outstanding_includes_confirmed_unpaid(h, ctx):
    # create a confirmed, unpaid booking well in future
    b = _make_booking(h, ctx, status="confirmed")
    d = requests.get(f"{API}/dashboard", headers=h, timeout=30).json()
    # This booking's price should contribute to outstanding_total
    assert d["outstanding_total"] >= b["price"] - 0.01
    assert d["outstanding_count"] >= 1


# ---- customer timeline reflects payment ----
def test_customer_timeline_contains_new_payment(h, ctx):
    cid, _, _, _ = ctx
    b = _make_booking(h, ctx)
    pay = requests.post(
        f"{API}/payments",
        headers=h,
        json={"booking_id": b["id"], "amount": 1.23, "method": "cash"},
        timeout=30,
    )
    pay_id = pay.json()["id"]
    cust = requests.get(f"{API}/customers/{cid}", headers=h, timeout=30).json()
    assert any(p["id"] == pay_id for p in cust.get("payments", [])), "payment not in customer timeline"


# ---- cancelled booking not in outstanding ----
def test_cancelled_booking_excluded_from_outstanding(h, ctx):
    b = _make_booking(h, ctx)
    before = requests.get(f"{API}/dashboard", headers=h, timeout=30).json()["outstanding_total"]
    requests.post(f"{API}/bookings/{b['id']}/status", headers=h, json={"status": "cancelled"}, timeout=30)
    after = requests.get(f"{API}/dashboard", headers=h, timeout=30).json()["outstanding_total"]
    assert after <= before - b["price"] + 0.01
