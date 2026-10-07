"""Test GET /api/rebooking/message endpoint (iteration 6).

Verifies:
  1. 200 + message/customer_phone fields for a valid pet of the logged-in business
  2. Message string shape (starts with 'Hi <customer>, <pet> may be due ... <biz>')
  3. 404 for a pet that belongs to a DIFFERENT business (cross-tenant isolation)
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://petadmin-mvp.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@petadmin.app"
DEMO_PASS = "petadmin123"


def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed {r.status_code}: {r.text}"
    body = r.json()
    return body.get("access_token") or body["token"]


def _register_fresh_business():
    email = f"TEST_rebook_{uuid.uuid4().hex[:8]}@test.pet"
    pw = "Password123!"
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": pw, "name": "Rebook Tester"}, timeout=15)
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token") or r.json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    # onboarding creates the business
    r2 = requests.post(f"{API}/onboarding", json={"business_name": f"TEST Biz {uuid.uuid4().hex[:6]}", "business_type": "grooming", "owner_name": "Rebook Tester"}, headers=h, timeout=15)
    assert r2.status_code in (200, 201), r2.text
    return tok


@pytest.fixture(scope="module")
def demo_token():
    return _login(DEMO_EMAIL, DEMO_PASS)


@pytest.fixture(scope="module")
def demo_pet_id(demo_token):
    h = {"Authorization": f"Bearer {demo_token}"}
    r = requests.get(f"{API}/pets", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    pets = r.json()
    assert isinstance(pets, list) and len(pets) > 0, "demo account should have seeded pets"
    return pets[0]["id"]


class TestRebookingMessage:
    def test_valid_pet_returns_200_and_message(self, demo_token, demo_pet_id):
        h = {"Authorization": f"Bearer {demo_token}"}
        r = requests.get(f"{API}/rebooking/message", params={"pet_id": demo_pet_id}, headers=h, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "message" in body and isinstance(body["message"], str)
        assert "customer_phone" in body
        assert body["message"].startswith("Hi "), body["message"]
        assert "may be due" in body["message"]
        assert "appointment with" in body["message"]

    def test_cross_business_pet_returns_404(self, demo_pet_id):
        # Fresh business shouldn't be able to see demo's pet
        other_tok = _register_fresh_business()
        h = {"Authorization": f"Bearer {other_tok}"}
        r = requests.get(f"{API}/rebooking/message", params={"pet_id": demo_pet_id}, headers=h, timeout=15)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"

    def test_unknown_pet_returns_404(self, demo_token):
        h = {"Authorization": f"Bearer {demo_token}"}
        r = requests.get(f"{API}/rebooking/message", params={"pet_id": "does-not-exist-id"}, headers=h, timeout=15)
        assert r.status_code == 404

    def test_unauthenticated_returns_401(self, demo_pet_id):
        r = requests.get(f"{API}/rebooking/message", params={"pet_id": demo_pet_id}, timeout=15)
        assert r.status_code in (401, 403)
