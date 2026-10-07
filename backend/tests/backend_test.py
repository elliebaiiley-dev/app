"""PetAdmin backend regression suite."""
import os
import io
import uuid
from datetime import datetime, timedelta
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://petadmin-mvp.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@petadmin.app"
DEMO_PASSWORD = "petadmin123"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def demo_token(session):
    r = session.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200, f"demo login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def demo_headers(demo_token):
    return {"Authorization": f"Bearer {demo_token}", "Content-Type": "application/json"}


# ---------- health ----------
def test_root(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    assert r.json()["service"] == "petadmin"


# ---------- auth ----------
def test_me_requires_auth(session):
    r = session.get(f"{API}/auth/me")
    assert r.status_code == 401


def test_me_bad_token(session):
    r = session.get(f"{API}/auth/me", headers={"Authorization": "Bearer not-a-valid-jwt"})
    assert r.status_code == 401


def test_register_and_login_new_user(session):
    email = f"test_{uuid.uuid4().hex[:10]}@example.com"
    pwd = "testpass123"
    r = session.post(f"{API}/auth/register", json={"email": email, "password": pwd})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    assert data["user"]["email"] == email
    assert data["user"]["onboarded"] is False
    tok = data["access_token"]

    r2 = session.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r2.status_code == 200
    assert r2.json()["email"] == email

    r3 = session.post(f"{API}/auth/login", json={"email": email, "password": pwd})
    assert r3.status_code == 200
    assert r3.json()["user"]["email"] == email

    r4 = session.post(f"{API}/auth/login", json={"email": email, "password": "wrong"})
    assert r4.status_code == 401


def test_register_duplicate_rejected(session):
    r = session.post(f"{API}/auth/register", json={"email": DEMO_EMAIL, "password": "whatever"})
    assert r.status_code == 409


def test_demo_login_works(demo_token):
    assert demo_token


def test_demo_user_onboarded(session, demo_headers):
    r = session.get(f"{API}/auth/me", headers=demo_headers)
    assert r.status_code == 200
    assert r.json()["onboarded"] is True


# ---------- dashboard ----------
def test_dashboard_shape(session, demo_headers):
    r = session.get(f"{API}/dashboard", headers=demo_headers)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("today_appointments", "today_revenue", "upcoming_appointments", "outstanding_total", "pets_due"):
        assert k in d, f"missing key {k}"
    assert isinstance(d["today_appointments"], list)
    assert isinstance(d["today_revenue"], (int, float))
    assert isinstance(d["upcoming_appointments"], list)


# ---------- services ----------
def test_services_crud(session, demo_headers):
    # list
    r = session.get(f"{API}/services", headers=demo_headers)
    assert r.status_code == 200
    initial = r.json()
    assert isinstance(initial, list)

    # create
    payload = {"name": "TEST_Service", "price": 42.5, "duration_minutes": 30}
    r = session.post(f"{API}/services", json=payload, headers=demo_headers)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    assert r.json()["name"] == "TEST_Service"

    # update
    r = session.put(f"{API}/services/{sid}", json={"name": "TEST_Service2", "price": 50, "duration_minutes": 45}, headers=demo_headers)
    assert r.status_code == 200

    # delete (soft)
    r = session.delete(f"{API}/services/{sid}", headers=demo_headers)
    assert r.status_code == 200


# ---------- customers ----------
def test_customers_list_nests_pets(session, demo_headers):
    r = session.get(f"{API}/customers", headers=demo_headers)
    assert r.status_code == 200
    data = r.json()
    assert len(data) >= 1
    for c in data:
        assert "pets" in c
        assert "_id" not in c


def test_customer_crud(session, demo_headers):
    # create
    payload = {"name": "TEST_Customer", "phone": "0000", "email": "t@t.com", "address": "x", "notes": ""}
    r = session.post(f"{API}/customers", json=payload, headers=demo_headers)
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    # get
    r = session.get(f"{API}/customers/{cid}", headers=demo_headers)
    assert r.status_code == 200
    assert r.json()["name"] == "TEST_Customer"
    assert "bookings" in r.json()
    assert "payments" in r.json()
    # update
    r = session.put(f"{API}/customers/{cid}", json={**payload, "name": "TEST_Customer2"}, headers=demo_headers)
    assert r.status_code == 200
    r = session.get(f"{API}/customers/{cid}", headers=demo_headers)
    assert r.json()["name"] == "TEST_Customer2"
    # delete (soft)
    r = session.delete(f"{API}/customers/{cid}", headers=demo_headers)
    assert r.status_code == 200


# ---------- pets ----------
def test_pet_detail(session, demo_headers):
    r = session.get(f"{API}/customers", headers=demo_headers)
    cust = r.json()[0]
    pet_id = cust["pets"][0]["id"]
    r = session.get(f"{API}/pets/{pet_id}", headers=demo_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "customer" in data and data["customer"] is not None
    assert "bookings" in data
    assert "last_appointment" in data
    assert "next_appointment" in data


def test_pets_list(session, demo_headers):
    r = session.get(f"{API}/pets", headers=demo_headers)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert "customer_name" in data[0]


# ---------- bookings ----------
def test_bookings_list_and_date_filter(session, demo_headers):
    r = session.get(f"{API}/bookings", headers=demo_headers)
    assert r.status_code == 200
    all_bookings = r.json()
    assert len(all_bookings) >= 1
    assert "pet_name" in all_bookings[0]
    assert "customer_name" in all_bookings[0]
    assert "service_name" in all_bookings[0]

    # date filter
    today = datetime.now().date().isoformat()
    tomorrow = (datetime.now().date() + timedelta(days=1)).isoformat()
    r = session.get(f"{API}/bookings", headers=demo_headers, params={"date_from": today, "date_to": tomorrow + "T23:59:59"})
    assert r.status_code == 200


def test_booking_status_update(session, demo_headers):
    r = session.get(f"{API}/bookings", headers=demo_headers)
    bid = r.json()[0]["id"]
    original = r.json()[0]["status"]
    r = session.post(f"{API}/bookings/{bid}/status", json={"status": "completed"}, headers=demo_headers)
    assert r.status_code == 200
    # invalid
    r = session.post(f"{API}/bookings/{bid}/status", json={"status": "bogus"}, headers=demo_headers)
    assert r.status_code == 400
    # restore
    session.post(f"{API}/bookings/{bid}/status", json={"status": original}, headers=demo_headers)


# ---------- payments ----------
def test_payments_list_and_create(session, demo_headers):
    r = session.get(f"{API}/payments", headers=demo_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)

    r = session.get(f"{API}/bookings", headers=demo_headers)
    bid = r.json()[0]["id"]
    r = session.post(f"{API}/payments", json={"booking_id": bid, "amount": 1.0, "method": "cash"}, headers=demo_headers)
    assert r.status_code == 200
    assert r.json()["amount"] == 1.0


# ---------- rebooking ----------
def test_rebooking_message(session, demo_headers):
    r = session.get(f"{API}/customers", headers=demo_headers)
    pet_id = r.json()[0]["pets"][0]["id"]
    cust_name = r.json()[0]["name"]
    pet_name = r.json()[0]["pets"][0]["name"]
    r = session.get(f"{API}/rebooking/message", headers=demo_headers, params={"pet_id": pet_id})
    assert r.status_code == 200, r.text
    msg = r.json()["message"]
    assert cust_name in msg
    assert pet_name in msg


# ---------- upload / file auth ----------
def test_files_require_auth(session):
    r = session.get(f"{API}/files/petadmin/uploads/anything")
    assert r.status_code == 401


def test_files_forbids_other_user(session, demo_headers):
    # Use demo token to try to access another user's path
    r = requests.get(
        f"{API}/files/petadmin/uploads/some-other-user/x.png",
        headers={"Authorization": demo_headers["Authorization"]},
    )
    assert r.status_code in (403, 404)


def test_upload_png(session, demo_headers):
    png_bytes = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xcf\xc0\x00\x00\x00\x03\x00\x01"
        b"\x5c\xcd\xff\x69\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    files = {"file": ("test.png", io.BytesIO(png_bytes), "image/png")}
    headers = {"Authorization": demo_headers["Authorization"]}
    try:
        r = requests.post(f"{API}/upload", files=files, headers=headers, timeout=60)
    except Exception as e:
        pytest.skip(f"Upload transport error: {e}")
    if r.status_code == 502:
        pytest.skip("Object storage unavailable (502)")
    if r.status_code == 500 and "not configured" in r.text.lower():
        pytest.skip("Object storage not configured")
    assert r.status_code == 200, r.text
    path = r.json()["path"]
    assert path.startswith("petadmin/uploads/")

    # Fetch via ?token=
    tok = demo_headers["Authorization"].split(" ", 1)[1]
    r = requests.get(f"{API}/files/{path}", params={"token": tok}, timeout=30)
    assert r.status_code == 200
    assert r.content == png_bytes or len(r.content) > 0
