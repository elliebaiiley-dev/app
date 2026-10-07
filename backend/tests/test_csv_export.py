"""Tests for iteration 7:

- GET /api/export/weekly.csv (Authorization header) -> 200, CSV content-type, filename, body shape
- GET /api/export/weekly.csv?token=<JWT> works equivalently (query-string auth)
- GET /api/export/weekly.csv without any token -> 401
- GET /api/export/weekly.csv with a token for a user with no active membership -> 403
- CSV scoping: a second (freshly-registered) business cannot see Business A's bookings
- Regression: POST /api/payments records a payment and GET /api/bookings/{id} outstanding goes down
- Regression: GET /api/rebooking/message returns both message and customer_phone fields
"""
import os
import uuid
import pytest
import requests

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://petadmin-mvp.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@petadmin.app"
DEMO_PASS = "petadmin123"


# ---------- helpers ----------
def _access_token(resp_json: dict) -> str:
    return resp_json.get("access_token") or resp_json.get("token")


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    return _access_token(r.json())


def _register_only_no_onboarding() -> str:
    """Register a brand new user but do NOT run onboarding -> user has no active membership."""
    email = f"TEST_csv_nomember_{uuid.uuid4().hex[:8]}@test.pet"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Password123!", "name": "No Member"}, timeout=15)
    assert r.status_code == 200, r.text
    return _access_token(r.json())


def _register_fresh_business() -> str:
    email = f"TEST_csv_{uuid.uuid4().hex[:8]}@test.pet"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": "Password123!", "name": "CSV Tester"}, timeout=15)
    assert r.status_code == 200, r.text
    tok = _access_token(r.json())
    h = {"Authorization": f"Bearer {tok}"}
    r2 = requests.post(f"{API}/onboarding", json={"business_name": f"TEST CSV {uuid.uuid4().hex[:6]}", "business_type": "grooming", "owner_name": "CSV Tester", "seed_demo": False}, headers=h, timeout=15)
    assert r2.status_code in (200, 201), r2.text
    return tok


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def demo_token():
    return _login(DEMO_EMAIL, DEMO_PASS)


# ---------- CSV export tests ----------
class TestCsvExport:
    def test_header_auth_returns_csv(self, demo_token):
        r = requests.get(f"{API}/export/weekly.csv", headers={"Authorization": f"Bearer {demo_token}"}, timeout=20)
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("Content-Type", "").lower(), r.headers
        cd = r.headers.get("Content-Disposition", "")
        assert "attachment" in cd.lower(), cd
        assert "petadmin-" in cd, cd
        # body starts with the known header
        text = r.text
        assert text.startswith("PetAdmin weekly export —"), text[:120]
        assert "\nBookings" in text or "\r\nBookings" in text, "Bookings section header missing"
        assert "Date,Time,Customer,Pet,Service" in text, "booking columns missing"

    def test_query_token_auth_works(self, demo_token):
        r = requests.get(f"{API}/export/weekly.csv", params={"token": demo_token}, timeout=20)
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("Content-Type", "").lower()
        assert r.text.startswith("PetAdmin weekly export —")

    def test_no_token_returns_401(self):
        r = requests.get(f"{API}/export/weekly.csv", timeout=15)
        assert r.status_code == 401, (r.status_code, r.text)

    def test_token_user_without_membership_returns_403(self):
        tok = _register_only_no_onboarding()
        r = requests.get(f"{API}/export/weekly.csv", headers={"Authorization": f"Bearer {tok}"}, timeout=15)
        assert r.status_code == 403, (r.status_code, r.text)

    def test_cross_business_scoping(self, demo_token):
        """Fresh business sees ONLY its own (empty) CSV — demo bookings must not leak."""
        other_tok = _register_fresh_business()
        r_other = requests.get(f"{API}/export/weekly.csv", headers={"Authorization": f"Bearer {other_tok}"}, timeout=20)
        assert r_other.status_code == 200, r_other.text
        # Fetch demo CSV + at least one demo customer name to search for in the other biz CSV
        h = {"Authorization": f"Bearer {demo_token}"}
        r_demo = requests.get(f"{API}/export/weekly.csv", headers=h, timeout=20)
        assert r_demo.status_code == 200, r_demo.text
        # Pull a customer name from demo
        rc = requests.get(f"{API}/customers", headers=h, timeout=15)
        assert rc.status_code == 200
        customers = rc.json()
        # The demo CSV should mention at least one customer name only if that customer has a booking this week.
        # To avoid false negatives from weeks with no demo bookings, assert the stricter negative:
        # the fresh business CSV must only reference its own business name header.
        other_biz_rp = requests.get(f"{API}/profile", headers={"Authorization": f"Bearer {other_tok}"}, timeout=10)
        assert other_biz_rp.status_code == 200
        other_biz_name = other_biz_rp.json().get("business_name", "")
        assert other_biz_name and other_biz_name in r_other.text, "fresh biz CSV missing its own name"
        # Demo customer names should NOT appear in the fresh biz CSV
        for c in customers[:5]:
            name = c.get("name", "")
            if name:
                assert name not in r_other.text, f"demo customer '{name}' leaked into other-biz CSV"


# ---------- regression: payments + rebooking ----------
class TestPaymentsAndRebookingRegression:
    def test_payment_reduces_outstanding(self, demo_token):
        h = {"Authorization": f"Bearer {demo_token}"}
        # Find a booking with an outstanding balance
        rb = requests.get(f"{API}/bookings", headers=h, timeout=15)
        assert rb.status_code == 200, rb.text
        bookings = rb.json()
        target = None
        for b in bookings:
            rd = requests.get(f"{API}/bookings/{b['id']}", headers=h, timeout=10)
            if rd.status_code != 200:
                continue
            det = rd.json()
            paid = sum(float(p.get("amount", 0)) for p in det.get("payments", []))
            if float(det.get("price", 0)) - paid > 0.5:
                target = det
                break
        if not target:
            pytest.skip("No demo booking with outstanding balance to exercise /payments regression")
        before_outstanding = float(target["price"]) - sum(float(p.get("amount", 0)) for p in target.get("payments", []))
        # Record a £0.50 partial payment
        rp = requests.post(f"{API}/payments", headers=h, json={"booking_id": target["id"], "amount": 0.50, "method": "cash"}, timeout=15)
        assert rp.status_code in (200, 201), rp.text
        # GET again
        rd2 = requests.get(f"{API}/bookings/{target['id']}", headers=h, timeout=10)
        assert rd2.status_code == 200
        det2 = rd2.json()
        after_outstanding = float(det2["price"]) - sum(float(p.get("amount", 0)) for p in det2.get("payments", []))
        assert after_outstanding < before_outstanding - 0.49, (before_outstanding, after_outstanding)

    def test_rebooking_message_contains_phone_and_message(self, demo_token):
        h = {"Authorization": f"Bearer {demo_token}"}
        rp = requests.get(f"{API}/pets", headers=h, timeout=10)
        assert rp.status_code == 200
        pets = rp.json()
        assert pets, "demo should have seeded pets"
        rm = requests.get(f"{API}/rebooking/message", params={"pet_id": pets[0]["id"]}, headers=h, timeout=15)
        assert rm.status_code == 200, rm.text
        body = rm.json()
        assert "message" in body and isinstance(body["message"], str) and body["message"].startswith("Hi ")
        assert "customer_phone" in body
