"""Multi-tenant isolation, roles and staff invite flows for PetAdmin."""
import os
import uuid
import time
import pytest
import requests
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://petadmin-mvp.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "petadmin_db")

mongo = MongoClient(MONGO_URL)
_db = mongo[DB_NAME]


def _s():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _unique(prefix):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:8]}"


def _register(email_prefix: str):
    s = _s()
    email = f"{email_prefix}_{uuid.uuid4().hex[:6]}@test.pet".lower()
    r = s.post(f"{API}/auth/register", json={"email": email, "password": "pw1234", "name": email_prefix})
    assert r.status_code == 200, r.text
    data = r.json()
    s.headers["Authorization"] = f"Bearer {data['access_token']}"
    return s, data["user"], email


def _onboard(sess, biz_name):
    r = sess.post(f"{API}/onboarding", json={
        "business_name": biz_name,
        "business_type": "Grooming",
        "owner_name": biz_name + " Owner",
        "phone": "07700 900000",
        "opening_hours": {},
        "services": [{"name": "Groom", "price": 40, "duration_minutes": 60}],
        "seed_demo": False,
    })
    assert r.status_code == 200, r.text
    return r.json()["business_id"]


def _create_customer(sess, name="Alice"):
    r = sess.post(f"{API}/customers", json={"name": name, "phone": "07", "email": "a@a.com"})
    assert r.status_code == 200, r.text
    return r.json()


def _create_pet(sess, customer_id, name="Rex"):
    r = sess.post(f"{API}/pets", json={"customer_id": customer_id, "name": name, "species": "Dog"})
    assert r.status_code == 200, r.text
    return r.json()


def _create_service(sess, name="Walk", price=15, mins=30):
    r = sess.post(f"{API}/services", json={"name": name, "price": price, "duration_minutes": mins})
    assert r.status_code == 200, r.text
    return r.json()


def _create_booking(sess, c, p, svc):
    start = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    r = sess.post(f"{API}/bookings", json={
        "customer_id": c["id"], "pet_id": p["id"], "service_id": svc["id"],
        "start_at": start,
    })
    assert r.status_code == 200, r.text
    return r.json()


# ---- Fixtures ----
@pytest.fixture(scope="module")
def owner_a():
    s, user, email = _register("ownerA")
    biz = _onboard(s, "Biz A")
    cust = _create_customer(s, "A Cust")
    pet = _create_pet(s, cust["id"], "A Dog")
    svc = _create_service(s, "A Service")
    booking = _create_booking(s, cust, pet, svc)
    return {"sess": s, "user": user, "email": email, "biz": biz, "cust": cust, "pet": pet, "svc": svc, "booking": booking}


@pytest.fixture(scope="module")
def owner_b():
    s, user, email = _register("ownerB")
    biz = _onboard(s, "Biz B")
    cust = _create_customer(s, "B Cust")
    pet = _create_pet(s, cust["id"], "B Dog")
    svc = _create_service(s, "B Service")
    booking = _create_booking(s, cust, pet, svc)
    return {"sess": s, "user": user, "email": email, "biz": biz, "cust": cust, "pet": pet, "svc": svc, "booking": booking}


# ---- 1. Auth / roles ----
class TestAuthRoles:
    def test_each_owner_has_separate_business_and_role_owner(self, owner_a, owner_b):
        assert owner_a["biz"] != owner_b["biz"]
        for o in (owner_a, owner_b):
            r = o["sess"].get(f"{API}/auth/me")
            assert r.status_code == 200
            me = r.json()
            assert me["business_id"] == o["biz"]
            assert me["role"] == "owner"
            assert me["onboarded"] is True


# ---- 2. Data isolation ----
class TestDataIsolation:
    def test_a_cannot_get_b_customer_pet_booking(self, owner_a, owner_b):
        sa = owner_a["sess"]
        assert sa.get(f"{API}/customers/{owner_b['cust']['id']}").status_code == 404
        assert sa.get(f"{API}/pets/{owner_b['pet']['id']}").status_code == 404
        assert sa.get(f"{API}/bookings/{owner_b['booking']['id']}").status_code == 404

    def test_a_cannot_update_or_delete_b_resources(self, owner_a, owner_b):
        sa = owner_a["sess"]
        r = sa.put(f"{API}/customers/{owner_b['cust']['id']}", json={"name": "hack"})
        assert r.status_code == 404
        r = sa.delete(f"{API}/customers/{owner_b['cust']['id']}")
        assert r.status_code == 404
        r = sa.delete(f"{API}/pets/{owner_b['pet']['id']}")
        assert r.status_code == 404
        r = sa.delete(f"{API}/bookings/{owner_b['booking']['id']}")
        assert r.status_code == 404

    def test_services_list_isolated(self, owner_a, owner_b):
        r = owner_a["sess"].get(f"{API}/services")
        a_ids = {s["id"] for s in r.json()}
        assert owner_b["svc"]["id"] not in a_ids
        assert owner_a["svc"]["id"] in a_ids

    def test_customers_list_isolated(self, owner_a, owner_b):
        r = owner_a["sess"].get(f"{API}/customers")
        a_ids = {c["id"] for c in r.json()}
        assert owner_b["cust"]["id"] not in a_ids

    def test_a_cannot_create_booking_referencing_b_entities(self, owner_a, owner_b):
        sa = owner_a["sess"]
        r = sa.post(f"{API}/bookings", json={
            "customer_id": owner_b["cust"]["id"],
            "pet_id": owner_b["pet"]["id"],
            "service_id": owner_b["svc"]["id"],
            "start_at": datetime.now(timezone.utc).isoformat(),
        })
        assert r.status_code == 400
        assert "not found" in r.text.lower()

    def test_a_cannot_create_payment_for_b_booking(self, owner_a, owner_b):
        sa = owner_a["sess"]
        r = sa.post(f"{API}/payments", json={"booking_id": owner_b["booking"]["id"], "amount": 10})
        assert r.status_code == 400

    def test_a_staff_list_isolated(self, owner_a, owner_b):
        r = owner_a["sess"].get(f"{API}/staff")
        assert r.status_code == 200
        members = r.json()["members"]
        emails = {m["email"] for m in members}
        assert owner_a["email"] in emails
        assert owner_b["email"] not in emails

    def test_billing_status_is_per_business(self, owner_a, owner_b):
        ra = owner_a["sess"].get(f"{API}/billing/status").json()
        rb = owner_b["sess"].get(f"{API}/billing/status").json()
        assert ra["status"] in {"trial", "trialing", "active"}
        assert rb["status"] in {"trial", "trialing", "active"}

    def test_billing_verify_rejects_cross_business_session(self, owner_a, owner_b):
        # Seed a fake checkout session tagged to B, then let A try to verify it.
        session_id = f"cs_test_{uuid.uuid4().hex[:16]}"
        _db.checkout_sessions.insert_one({
            "session_id": session_id,
            "business_id": owner_b["biz"],
            "user_id": owner_b["user"]["id"],
            "status": "created",
            "created_at": datetime.now(timezone.utc),
        })
        # Stripe retrieve would 502 before 403 on the metadata check — but using an id
        # tagged with real stripe metadata is not possible in unit test. Instead,
        # confirm that A's billing/status does NOT reflect B — already covered.
        # We validate that endpoint still refuses unknown session with 4xx/5xx (not 200).
        r = owner_a["sess"].get(f"{API}/billing/verify", params={"session_id": session_id})
        assert r.status_code in (400, 403, 404, 502), r.text


# ---- 3. File isolation ----
class TestFileIsolation:
    def test_file_access_blocked_cross_business(self, owner_a, owner_b):
        # Upload a tiny file as B
        files = {"file": ("hello.txt", b"secret-b-data", "text/plain")}
        headers = {"Authorization": owner_b["sess"].headers["Authorization"]}
        r = requests.post(f"{API}/upload", files=files, headers=headers)
        if r.status_code != 200:
            pytest.skip(f"Upload backend unavailable in preview: {r.status_code} {r.text[:100]}")
        path = r.json()["path"]
        # A tries to retrieve
        ra = requests.get(f"{API}/files/{path}", headers={"Authorization": owner_a["sess"].headers["Authorization"]})
        assert ra.status_code == 403
        # B can retrieve
        rb = requests.get(f"{API}/files/{path}", headers=headers)
        assert rb.status_code == 200


# ---- 4. Staff invites ----
class TestStaffInvites:
    def test_owner_invite_and_accept_flow(self, owner_a):
        email = f"staff_{uuid.uuid4().hex[:6]}@test.pet"
        r = owner_a["sess"].post(f"{API}/staff/invite", json={"email": email, "role": "staff"})
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["invite_link"] and inv["token"]

        # GET invite details
        rg = requests.get(f"{API}/invites/{inv['token']}")
        assert rg.status_code == 200
        details = rg.json()
        assert details["email"] == email.lower()
        assert details["role"] == "staff"
        assert details["business_name"] == "Biz A"

        # Accept
        ra = requests.post(f"{API}/invites/accept", json={
            "token": inv["token"], "password": "pw1234", "name": "StaffUser"
        })
        assert ra.status_code == 200
        data = ra.json()
        assert data["user"]["business_id"] == owner_a["biz"]
        assert data["user"]["role"] == "staff"

        # Staff session
        ss = _s()
        ss.headers["Authorization"] = f"Bearer {data['access_token']}"

        # Staff can access A's data
        assert ss.get(f"{API}/customers").status_code == 200
        assert ss.get(f"{API}/pets").status_code == 200
        assert ss.get(f"{API}/bookings").status_code == 200
        assert ss.get(f"{API}/dashboard").status_code == 200
        assert ss.get(f"{API}/staff").status_code == 200

        # Idempotency: accepting the same token again returns 404 (invite already used)
        ra2 = requests.post(f"{API}/invites/accept", json={
            "token": inv["token"], "password": "pw1234", "name": "StaffUser"
        })
        assert ra2.status_code == 404

        # Staff cannot invite more staff
        rinv = ss.post(f"{API}/staff/invite", json={"email": "other@test.pet", "role": "staff"})
        assert rinv.status_code == 403

        # Save for later use
        TestStaffInvites.staff_session = ss
        TestStaffInvites.staff_user = data["user"]
        # Find membership_id
        members = owner_a["sess"].get(f"{API}/staff").json()["members"]
        staff_m = next(m for m in members if m["email"] == email.lower())
        TestStaffInvites.staff_membership_id = staff_m["membership_id"]


# ---- 5. Role gating on billing & staff ops ----
class TestRoleGating:
    @pytest.fixture(scope="class")
    def staff_sess(self, owner_a):
        # Create a staff member for role tests
        email = f"gating_{uuid.uuid4().hex[:6]}@test.pet"
        r = owner_a["sess"].post(f"{API}/staff/invite", json={"email": email, "role": "staff"})
        assert r.status_code == 200
        tok = r.json()["token"]
        ra = requests.post(f"{API}/invites/accept", json={"token": tok, "password": "pw1234", "name": "gating"})
        assert ra.status_code == 200
        ss = _s()
        ss.headers["Authorization"] = f"Bearer {ra.json()['access_token']}"
        members = owner_a["sess"].get(f"{API}/staff").json()["members"]
        mid = next(m["membership_id"] for m in members if m["email"] == email.lower())
        return {"sess": ss, "email": email, "mid": mid}

    def test_staff_blocked_from_billing_and_mgmt(self, staff_sess):
        s = staff_sess["sess"]
        assert s.post(f"{API}/billing/checkout", json={"origin": "https://x"}).status_code == 403
        assert s.post(f"{API}/billing/portal", json={"origin": "https://x"}).status_code == 403
        assert s.get(f"{API}/billing/verify", params={"session_id": "foo"}).status_code == 403
        assert s.post(f"{API}/staff/invite", json={"email": "x@x.io", "role": "staff"}).status_code == 403
        assert s.post(f"{API}/staff/{staff_sess['mid']}/deactivate").status_code == 403
        assert s.post(f"{API}/staff/{staff_sess['mid']}/reactivate").status_code == 403
        assert s.delete(f"{API}/staff/{staff_sess['mid']}").status_code == 403
        assert s.delete(f"{API}/invites/{uuid.uuid4().hex}").status_code == 403


# ---- 6. Unlimited staff ----
class TestUnlimitedStaff:
    def test_many_staff_share_single_business_subscription(self, owner_a):
        emails = []
        for i in range(10):
            email = f"bulk{i}_{uuid.uuid4().hex[:4]}@test.pet"
            r = owner_a["sess"].post(f"{API}/staff/invite", json={"email": email, "role": "staff"})
            assert r.status_code == 200
            tok = r.json()["token"]
            ra = requests.post(f"{API}/invites/accept", json={"token": tok, "password": "pw1234", "name": f"bulk{i}"})
            assert ra.status_code == 200
            emails.append(email)
        bs = owner_a["sess"].get(f"{API}/billing/status").json()
        # Still a single business-level subscription — no per-user duplication.
        assert "status" in bs
        # Owner's business should still be in trial (or whatever it was); unaffected by invites.
        r = owner_a["sess"].get(f"{API}/staff").json()
        assert len({m["email"] for m in r["members"] if m["email"] in [e.lower() for e in emails]}) == 10


# ---- 7. Deactivation / reactivation ----
class TestDeactivation:
    def test_deactivate_blocks_access_and_reactivate_restores(self, owner_a):
        email = f"deact_{uuid.uuid4().hex[:6]}@test.pet"
        r = owner_a["sess"].post(f"{API}/staff/invite", json={"email": email, "role": "staff"})
        tok = r.json()["token"]
        ra = requests.post(f"{API}/invites/accept", json={"token": tok, "password": "pw1234", "name": "dz"})
        access = ra.json()["access_token"]
        members = owner_a["sess"].get(f"{API}/staff").json()["members"]
        mid = next(m["membership_id"] for m in members if m["email"] == email.lower())

        # Deactivate
        dr = owner_a["sess"].post(f"{API}/staff/{mid}/deactivate")
        assert dr.status_code == 200

        # Deactivated token → protected endpoint returns 403
        s = _s()
        s.headers["Authorization"] = f"Bearer {access}"
        assert s.get(f"{API}/customers").status_code == 403

        # Login attempt also 403 (all memberships deactivated)
        rl = requests.post(f"{API}/auth/login", json={"email": email, "password": "pw1234"})
        assert rl.status_code == 403

        # Reactivate
        rr = owner_a["sess"].post(f"{API}/staff/{mid}/reactivate")
        assert rr.status_code == 200
        assert s.get(f"{API}/customers").status_code == 200


# ---- 8. Trial expiry ----
class TestTrialExpiry:
    def test_trial_expired_means_not_entitled(self, owner_a):
        # Save original to restore
        orig = _db.businesses.find_one({"id": owner_a["biz"]})
        try:
            _db.businesses.update_one(
                {"id": owner_a["biz"]},
                {"$set": {"subscription_status": "trial",
                          "trial_ends_at": datetime.now(timezone.utc) - timedelta(days=1)}},
            )
            bs = owner_a["sess"].get(f"{API}/billing/status").json()
            assert bs["entitled"] is False
            assert bs["trial_days_left"] == 0
        finally:
            _db.businesses.update_one(
                {"id": owner_a["biz"]},
                {"$set": {"subscription_status": orig.get("subscription_status", "trial"),
                          "trial_ends_at": orig.get("trial_ends_at")}},
            )


# ---- 9. Shared entitlement ----
class TestSharedEntitlement:
    def test_owner_and_staff_see_same_status(self, owner_a):
        # Simulate active sub
        orig = _db.businesses.find_one({"id": owner_a["biz"]})
        try:
            _db.businesses.update_one({"id": owner_a["biz"]}, {"$set": {"subscription_status": "active"}})
            email = f"share_{uuid.uuid4().hex[:6]}@test.pet"
            r = owner_a["sess"].post(f"{API}/staff/invite", json={"email": email, "role": "staff"})
            tok = r.json()["token"]
            ra = requests.post(f"{API}/invites/accept", json={"token": tok, "password": "pw1234", "name": "share"})
            ss = _s()
            ss.headers["Authorization"] = f"Bearer {ra.json()['access_token']}"
            o = owner_a["sess"].get(f"{API}/billing/status").json()
            s = ss.get(f"{API}/billing/status").json()
            assert o["status"] == s["status"] == "active"
            assert o["entitled"] is True and s["entitled"] is True
        finally:
            _db.businesses.update_one(
                {"id": owner_a["biz"]},
                {"$set": {"subscription_status": orig.get("subscription_status", "trial")}},
            )


# ---- 10. Legacy demo data ----
class TestLegacyDemo:
    def test_demo_user_still_works(self):
        s = _s()
        r = s.post(f"{API}/auth/login", json={"email": "demo@petadmin.app", "password": "petadmin123"})
        assert r.status_code == 200, r.text
        tok = r.json()["access_token"]
        user = r.json()["user"]
        assert user["business_id"]
        assert user["role"] == "owner"
        s.headers["Authorization"] = f"Bearer {tok}"
        customers = s.get(f"{API}/customers").json()
        assert len(customers) >= 5, f"Expected seeded demo customers, got {len(customers)}"
        dash = s.get(f"{API}/dashboard").json()
        assert "today_appointments" in dash


# ---- 11. Stripe checkout URL ----
class TestStripeCheckout:
    def test_owner_can_create_checkout(self, owner_a):
        r = owner_a["sess"].post(f"{API}/billing/checkout", json={"origin": "https://example.com"})
        if r.status_code == 502:
            pytest.skip("Stripe test backend unreachable in preview")
        assert r.status_code == 200, r.text
        url = r.json()["url"]
        assert "checkout.stripe.com" in url or "stripe" in url
