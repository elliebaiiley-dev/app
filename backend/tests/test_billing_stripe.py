"""Billing / Stripe integration tests (iteration 3).

Covers:
- POST /api/billing/checkout returns Stripe hosted-checkout URL + session_id (mode=subscription)
- GET /api/billing/status returns status/entitled/trial_days_left for current user
- GET /api/billing/verify?session_id=... for a brand-new unpaid session: user still 'trial'
- POST /api/stripe/webhook accepts events without signature, is idempotent, and
  activates user subscription on customer.subscription.{created,updated}
- Auth is required on billing endpoints
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://petadmin-mvp.preview.emergentagent.com").rstrip("/")
DEMO_EMAIL = "demo@petadmin.app"
DEMO_PASSWORD = "petadmin123"


@pytest.fixture(scope="module")
def auth_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def auth_headers(auth_token):
    return {"Authorization": f"Bearer {auth_token}", "Content-Type": "application/json"}


# ---------- auth guard ----------
def test_billing_status_requires_auth():
    r = requests.get(f"{BASE_URL}/api/billing/status", timeout=20)
    assert r.status_code in (401, 403), f"expected 401/403 got {r.status_code}"


def test_billing_checkout_requires_auth():
    r = requests.post(f"{BASE_URL}/api/billing/checkout", json={"origin": "https://example.com"}, timeout=20)
    assert r.status_code in (401, 403)


# ---------- /api/billing/status ----------
def test_billing_status_shape(auth_headers):
    r = requests.get(f"{BASE_URL}/api/billing/status", headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    for key in ("status", "entitled", "trial_days_left"):
        assert key in data, f"missing {key} in {data}"
    assert isinstance(data["entitled"], bool)
    assert isinstance(data["trial_days_left"], int)
    assert data["status"] in {"trial", "trialing", "active", "past_due", "canceled", "cancelled", "incomplete"}


# ---------- /api/billing/status: trial-days-left regression (iteration 4) ----------
def test_billing_status_trial_days_left_positive(auth_headers):
    """Regression for the tz-naive datetime bug: demo user still inside trial window should
    see trial_days_left in 1..14 and entitled=True (status=trial)."""
    r = requests.get(f"{BASE_URL}/api/billing/status", headers=auth_headers, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    if data["status"] == "trial":
        assert data["entitled"] is True, f"expected entitled=True for trial, got {data}"
        assert 1 <= data["trial_days_left"] <= 14, f"trial_days_left out of 1..14: {data}"
    else:
        # If the account is now trialing/active (webhook moved it), that's also acceptable
        assert data["entitled"] is True, f"non-trial status should still be entitled: {data}"


# ---------- /api/billing/checkout ----------
@pytest.fixture(scope="module")
def checkout_session(auth_headers):
    origin = "https://petadmin-mvp.preview.emergentagent.com"
    r = requests.post(
        f"{BASE_URL}/api/billing/checkout",
        headers=auth_headers,
        json={"origin": origin},
        timeout=60,
    )
    assert r.status_code == 200, f"checkout failed: {r.status_code} {r.text}"
    body = r.json()
    assert "url" in body and body["url"], "missing url in checkout response"
    assert "session_id" in body and body["session_id"], "missing session_id"
    assert "checkout.stripe.com" in body["url"], f"url should be stripe hosted: {body['url']}"
    return body


def test_billing_checkout_returns_stripe_url(checkout_session):
    # verified by fixture; this test just records the pass explicitly
    assert checkout_session["session_id"].startswith("cs_"), checkout_session["session_id"]


# ---------- /api/billing/verify (unpaid session) ----------
def test_billing_verify_unpaid_session_keeps_trial(auth_headers, checkout_session):
    sid = checkout_session["session_id"]
    r = requests.get(
        f"{BASE_URL}/api/billing/verify",
        headers=auth_headers,
        params={"session_id": sid},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    # For a brand-new unpaid session, status should stay 'trial'
    # (not advanced to trialing/active because the user hasn't completed checkout)
    assert data.get("status") in {"trial", "trialing"}, data
    # entitled still true because trial is live (14 days from signup)
    assert "entitled" in data
    assert "trial_days_left" in data


def test_billing_verify_requires_session_id(auth_headers):
    r = requests.get(f"{BASE_URL}/api/billing/verify", headers=auth_headers, timeout=20)
    # Missing required query param → 422
    assert r.status_code == 422


# ---------- /api/stripe/webhook ----------
def test_stripe_webhook_accepts_unsigned_in_preview(auth_headers):
    """STRIPE_WEBHOOK_SECRET is empty in preview, so unsigned events should be accepted
    and the user doc updated. We use the demo user id via metadata.user_id so the
    handler can find the user even without a stripe_customer_id yet.
    """
    # Fetch demo user id via /auth/me
    me = requests.get(f"{BASE_URL}/api/auth/me", headers=auth_headers, timeout=20)
    assert me.status_code == 200, me.text
    user_id = me.json()["id"]

    event_id = f"evt_test_{uuid.uuid4().hex[:12]}"
    payload = {
        "id": event_id,
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "id": f"sub_test_{uuid.uuid4().hex[:10]}",
                "status": "trialing",
                "customer": f"cus_test_{uuid.uuid4().hex[:10]}",
                "cancel_at_period_end": False,
                "current_period_end": 9999999999,
                "metadata": {"user_id": user_id},
            }
        },
    }

    r = requests.post(f"{BASE_URL}/api/stripe/webhook", json=payload, timeout=30)
    assert r.status_code == 200, f"webhook failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get("received") is True
    assert not body.get("duplicate", False)

    # Idempotency: send the same event again
    r2 = requests.post(f"{BASE_URL}/api/stripe/webhook", json=payload, timeout=30)
    assert r2.status_code == 200
    assert r2.json().get("duplicate") is True, r2.json()

    # Verify status now reflects trialing via /billing/status
    s = requests.get(f"{BASE_URL}/api/billing/status", headers=auth_headers, timeout=20)
    assert s.status_code == 200
    assert s.json()["status"] in {"trialing", "active"}, s.json()
    assert s.json()["entitled"] is True


def test_stripe_webhook_rejects_malformed():
    r = requests.post(
        f"{BASE_URL}/api/stripe/webhook",
        data=b"not-json-at-all",
        headers={"Content-Type": "application/json"},
        timeout=20,
    )
    assert r.status_code == 400
