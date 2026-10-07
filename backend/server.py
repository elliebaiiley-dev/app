"""PetAdmin backend API."""
import os
import uuid
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Any, Dict

import bcrypt
import jwt
import requests
from bson import ObjectId  # noqa: F401
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, Query, Request
from fastapi.responses import Response
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

# ---------- Config ----------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ.get("JWT_SECRET", "petadmin-dev-secret-change-me")
JWT_ALG = "HS256"
JWT_EXPIRE_DAYS = 30

# Emergent Object Storage
EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "petadmin"
_storage_key: Optional[str] = None

# ---------- DB ----------
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="PetAdmin API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
log = logging.getLogger("petadmin")


# ---------- Helpers ----------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


def clean(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if doc is None:
        return None
    doc.pop("_id", None)
    # Convert datetimes to iso
    for k, v in list(doc.items()):
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
    return doc


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def make_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "iat": now_utc(),
        "exp": now_utc() + timedelta(days=JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


async def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> Dict[str, Any]:
    if not creds or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return clean(user)


# ---------- Storage ----------
def _init_storage_sync() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_LLM_KEY:
        raise HTTPException(status_code=500, detail="Object storage not configured")
    r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    r.raise_for_status()
    _storage_key = r.json()["storage_key"]
    return _storage_key


def _put_object_sync(path: str, data: bytes, content_type: str) -> Dict[str, Any]:
    key = _init_storage_sync()
    r = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=120,
    )
    if r.status_code == 503:
        global _storage_key
        _storage_key = None
        key = _init_storage_sync()
        r = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=120,
        )
    r.raise_for_status()
    return r.json()


def _get_object_sync(path: str):
    key = _init_storage_sync()
    r = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")


# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    onboarded: bool = False
    created_at: str
    trial_ends_at: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class OnboardingIn(BaseModel):
    business_name: str
    business_type: str  # e.g. "Dog Groomer"
    owner_name: str
    phone: str = ""
    opening_hours: Dict[str, str] = Field(default_factory=dict)  # {"mon": "09:00-17:00"}
    services: List[Dict[str, Any]] = Field(default_factory=list)
    seed_demo: bool = True


class CustomerIn(BaseModel):
    name: str
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    notes: Optional[str] = ""


class PetIn(BaseModel):
    customer_id: str
    name: str
    species: Optional[str] = "Dog"
    breed: Optional[str] = ""
    date_of_birth: Optional[str] = ""  # YYYY-MM-DD or ""
    weight: Optional[str] = ""  # free text e.g. "12kg"
    allergies: Optional[str] = ""
    medical_notes: Optional[str] = ""
    behaviour_notes: Optional[str] = ""
    special_requirements: Optional[str] = ""
    vaccinations: Optional[str] = ""
    photo_path: Optional[str] = ""  # path returned by /upload
    next_recommended_at: Optional[str] = ""  # ISO date


class ServiceIn(BaseModel):
    name: str
    price: float
    duration_minutes: int


class BookingIn(BaseModel):
    customer_id: str
    pet_id: str
    service_id: str
    start_at: str  # ISO
    duration_minutes: Optional[int] = None  # derived if omitted
    price: Optional[float] = None
    notes: Optional[str] = ""
    status: str = "confirmed"  # confirmed | completed | cancelled | no_show


class PaymentIn(BaseModel):
    booking_id: str
    amount: float
    method: str = "cash"  # cash | card | bank | other
    paid_at: Optional[str] = None  # ISO or None (defaults to now)


# ---------- Auth routes ----------
@api.post("/auth/register", response_model=TokenOut)
async def register(body: RegisterIn):
    email = body.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    now = now_utc()
    user_doc = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(body.password),
        "onboarded": False,
        "created_at": now,
        "trial_ends_at": now + timedelta(days=14),
    }
    await db.users.insert_one(user_doc.copy())
    token = make_token(user_doc["id"])
    out = UserOut(
        id=user_doc["id"],
        email=user_doc["email"],
        onboarded=False,
        created_at=user_doc["created_at"].isoformat(),
        trial_ends_at=user_doc["trial_ends_at"].isoformat(),
    )
    return TokenOut(access_token=token, user=out)


@api.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = make_token(user["id"])
    out = UserOut(
        id=user["id"],
        email=user["email"],
        onboarded=user.get("onboarded", False),
        created_at=user["created_at"].isoformat() if isinstance(user["created_at"], datetime) else user["created_at"],
        trial_ends_at=user["trial_ends_at"].isoformat() if isinstance(user["trial_ends_at"], datetime) else user["trial_ends_at"],
    )
    return TokenOut(access_token=token, user=out)


@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(current_user)):
    return UserOut(**{k: user[k] for k in ("id", "email", "onboarded", "created_at", "trial_ends_at")})


# ---------- Onboarding ----------
@api.post("/onboarding")
async def onboarding(body: OnboardingIn, user=Depends(current_user)):
    user_id = user["id"]
    now = now_utc()
    profile = {
        "user_id": user_id,
        "business_name": body.business_name,
        "business_type": body.business_type,
        "owner_name": body.owner_name,
        "phone": body.phone,
        "opening_hours": body.opening_hours,
        "updated_at": now,
    }
    await db.business_profiles.update_one({"user_id": user_id}, {"$set": profile}, upsert=True)

    # Insert services
    for svc in body.services:
        s = {
            "id": new_id(),
            "user_id": user_id,
            "name": svc.get("name", "Service"),
            "price": float(svc.get("price", 0)),
            "duration_minutes": int(svc.get("duration_minutes", 60)),
            "created_at": now,
        }
        await db.services.insert_one(s.copy())

    await db.users.update_one({"id": user_id}, {"$set": {"onboarded": True}})

    if body.seed_demo:
        await _seed_demo_data(user_id)

    return {"ok": True}


# ---------- Business profile ----------
@api.get("/profile")
async def get_profile(user=Depends(current_user)):
    p = await db.business_profiles.find_one({"user_id": user["id"]})
    return clean(p) or {}


# ---------- Services ----------
@api.get("/services")
async def list_services(user=Depends(current_user)):
    items = await db.services.find(
        {"user_id": user["id"], "deleted_at": {"$exists": False}}
    ).to_list(500)
    return [clean(x) for x in items]


@api.post("/services")
async def create_service(body: ServiceIn, user=Depends(current_user)):
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        "name": body.name,
        "price": body.price,
        "duration_minutes": body.duration_minutes,
        "created_at": now_utc(),
    }
    await db.services.insert_one(doc.copy())
    return clean(doc)


@api.put("/services/{sid}")
async def update_service(sid: str, body: ServiceIn, user=Depends(current_user)):
    r = await db.services.update_one(
        {"id": sid, "user_id": user["id"]},
        {"$set": {"name": body.name, "price": body.price, "duration_minutes": body.duration_minutes}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.delete("/services/{sid}")
async def delete_service(sid: str, user=Depends(current_user)):
    await db.services.update_one(
        {"id": sid, "user_id": user["id"]}, {"$set": {"deleted_at": now_utc()}}
    )
    return {"ok": True}


# ---------- Customers ----------
@api.get("/customers")
async def list_customers(user=Depends(current_user)):
    items = await db.customers.find(
        {"user_id": user["id"], "deleted_at": {"$exists": False}}
    ).sort("name", 1).to_list(1000)
    results = []
    for c in items:
        c = clean(c)
        pets = await db.pets.find({"user_id": user["id"], "customer_id": c["id"], "deleted_at": {"$exists": False}}).to_list(100)
        c["pets"] = [clean(p) for p in pets]
        results.append(c)
    return results


@api.get("/customers/{cid}")
async def get_customer(cid: str, user=Depends(current_user)):
    c = await db.customers.find_one({"id": cid, "user_id": user["id"]})
    if not c:
        raise HTTPException(404, "Not found")
    c = clean(c)
    pets = await db.pets.find({"user_id": user["id"], "customer_id": cid, "deleted_at": {"$exists": False}}).to_list(100)
    c["pets"] = [clean(p) for p in pets]
    # history
    bookings = await db.bookings.find({"user_id": user["id"], "customer_id": cid}).sort("start_at", -1).to_list(500)
    c["bookings"] = [clean(b) for b in bookings]
    payments = await db.payments.find({"user_id": user["id"], "customer_id": cid}).sort("paid_at", -1).to_list(500)
    c["payments"] = [clean(p) for p in payments]
    return c


@api.post("/customers")
async def create_customer(body: CustomerIn, user=Depends(current_user)):
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        **body.dict(),
        "created_at": now_utc(),
    }
    await db.customers.insert_one(doc.copy())
    return clean(doc)


@api.put("/customers/{cid}")
async def update_customer(cid: str, body: CustomerIn, user=Depends(current_user)):
    r = await db.customers.update_one(
        {"id": cid, "user_id": user["id"]}, {"$set": body.dict()}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.delete("/customers/{cid}")
async def delete_customer(cid: str, user=Depends(current_user)):
    await db.customers.update_one(
        {"id": cid, "user_id": user["id"]}, {"$set": {"deleted_at": now_utc()}}
    )
    return {"ok": True}


# ---------- Pets ----------
@api.get("/pets")
async def list_pets(user=Depends(current_user), customer_id: Optional[str] = None):
    q: Dict[str, Any] = {"user_id": user["id"], "deleted_at": {"$exists": False}}
    if customer_id:
        q["customer_id"] = customer_id
    items = await db.pets.find(q).sort("name", 1).to_list(1000)
    results = []
    for p in items:
        p = clean(p)
        cust = await db.customers.find_one({"id": p["customer_id"], "user_id": user["id"]})
        p["customer_name"] = cust["name"] if cust else ""
        results.append(p)
    return results


@api.get("/pets/{pid}")
async def get_pet(pid: str, user=Depends(current_user)):
    p = await db.pets.find_one({"id": pid, "user_id": user["id"]})
    if not p:
        raise HTTPException(404, "Not found")
    p = clean(p)
    cust = await db.customers.find_one({"id": p["customer_id"], "user_id": user["id"]})
    p["customer"] = clean(cust) if cust else None
    bookings = await db.bookings.find({"user_id": user["id"], "pet_id": pid}).sort("start_at", -1).to_list(500)
    p["bookings"] = [clean(b) for b in bookings]
    # Payments for this pet (via booking lookup)
    booking_ids = [b["id"] for b in p["bookings"]]
    payments = await db.payments.find({"user_id": user["id"], "booking_id": {"$in": booking_ids}}).sort("paid_at", -1).to_list(500)
    p["payments"] = [clean(x) for x in payments]
    # last / next
    completed = [b for b in p["bookings"] if b.get("status") == "completed"]
    p["last_appointment"] = completed[0]["start_at"] if completed else None
    upcoming = [b for b in p["bookings"] if b.get("status") == "confirmed" and b.get("start_at", "") >= now_utc().isoformat()]
    upcoming.sort(key=lambda x: x.get("start_at", ""))
    p["next_appointment"] = upcoming[0]["start_at"] if upcoming else None
    return p


@api.post("/pets")
async def create_pet(body: PetIn, user=Depends(current_user)):
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        **body.dict(),
        "created_at": now_utc(),
    }
    await db.pets.insert_one(doc.copy())
    return clean(doc)


@api.put("/pets/{pid}")
async def update_pet(pid: str, body: PetIn, user=Depends(current_user)):
    r = await db.pets.update_one(
        {"id": pid, "user_id": user["id"]}, {"$set": body.dict()}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.delete("/pets/{pid}")
async def delete_pet(pid: str, user=Depends(current_user)):
    await db.pets.update_one(
        {"id": pid, "user_id": user["id"]}, {"$set": {"deleted_at": now_utc()}}
    )
    return {"ok": True}


# ---------- Bookings ----------
@api.get("/bookings")
async def list_bookings(
    user=Depends(current_user),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    q: Dict[str, Any] = {"user_id": user["id"]}
    if date_from or date_to:
        q["start_at"] = {}
        if date_from:
            q["start_at"]["$gte"] = date_from
        if date_to:
            q["start_at"]["$lte"] = date_to
    items = await db.bookings.find(q).sort("start_at", 1).to_list(2000)
    out = []
    for b in items:
        b = clean(b)
        cust = await db.customers.find_one({"id": b["customer_id"], "user_id": user["id"]})
        pet = await db.pets.find_one({"id": b["pet_id"], "user_id": user["id"]})
        svc = await db.services.find_one({"id": b["service_id"], "user_id": user["id"]})
        b["customer_name"] = cust["name"] if cust else ""
        b["pet_name"] = pet["name"] if pet else ""
        b["pet_photo_path"] = pet.get("photo_path", "") if pet else ""
        b["service_name"] = svc["name"] if svc else ""
        out.append(b)
    return out


async def _enrich_booking(b: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    cust = await db.customers.find_one({"id": b["customer_id"], "user_id": user_id})
    pet = await db.pets.find_one({"id": b["pet_id"], "user_id": user_id})
    svc = await db.services.find_one({"id": b["service_id"], "user_id": user_id})
    b["customer_name"] = cust["name"] if cust else ""
    b["pet_name"] = pet["name"] if pet else ""
    b["pet_photo_path"] = pet.get("photo_path", "") if pet else ""
    b["service_name"] = svc["name"] if svc else ""
    # Payment totals
    payments = await db.payments.find({"user_id": user_id, "booking_id": b["id"]}).sort("paid_at", -1).to_list(500)
    paid_total = sum(float(p.get("amount", 0)) for p in payments)
    b["paid_total"] = round(paid_total, 2)
    b["outstanding"] = round(max(0.0, float(b.get("price", 0)) - paid_total), 2)
    b["payments"] = [clean(p) for p in payments]
    return b


@api.get("/bookings/{bid}")
async def get_booking(bid: str, user=Depends(current_user)):
    b = await db.bookings.find_one({"id": bid, "user_id": user["id"]})
    if not b:
        raise HTTPException(404, "Not found")
    b = clean(b)
    return await _enrich_booking(b, user["id"])


@api.post("/bookings")
async def create_booking(body: BookingIn, user=Depends(current_user)):
    svc = await db.services.find_one({"id": body.service_id, "user_id": user["id"]})
    if not svc:
        raise HTTPException(400, "Service not found")
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        "customer_id": body.customer_id,
        "pet_id": body.pet_id,
        "service_id": body.service_id,
        "start_at": body.start_at,
        "duration_minutes": body.duration_minutes if body.duration_minutes is not None else svc["duration_minutes"],
        "price": body.price if body.price is not None else svc["price"],
        "notes": body.notes or "",
        "status": body.status or "confirmed",
        "created_at": now_utc(),
    }
    await db.bookings.insert_one(doc.copy())
    return clean(doc)


@api.put("/bookings/{bid}")
async def update_booking(bid: str, body: BookingIn, user=Depends(current_user)):
    svc = await db.services.find_one({"id": body.service_id, "user_id": user["id"]})
    if not svc:
        raise HTTPException(400, "Service not found")
    update = {
        "customer_id": body.customer_id,
        "pet_id": body.pet_id,
        "service_id": body.service_id,
        "start_at": body.start_at,
        "duration_minutes": body.duration_minutes if body.duration_minutes is not None else svc["duration_minutes"],
        "price": body.price if body.price is not None else svc["price"],
        "notes": body.notes or "",
        "status": body.status or "confirmed",
    }
    r = await db.bookings.update_one({"id": bid, "user_id": user["id"]}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.post("/bookings/{bid}/status")
async def set_booking_status(bid: str, body: Dict[str, str], user=Depends(current_user)):
    status = body.get("status", "")
    if status not in {"confirmed", "completed", "cancelled", "no_show"}:
        raise HTTPException(400, "Invalid status")
    r = await db.bookings.update_one({"id": bid, "user_id": user["id"]}, {"$set": {"status": status}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.delete("/bookings/{bid}")
async def delete_booking(bid: str, user=Depends(current_user)):
    await db.bookings.update_one({"id": bid, "user_id": user["id"]}, {"$set": {"deleted_at": now_utc(), "status": "cancelled"}})
    return {"ok": True}


# ---------- Payments ----------
@api.get("/payments")
async def list_payments(user=Depends(current_user)):
    items = await db.payments.find({"user_id": user["id"]}).sort("paid_at", -1).to_list(2000)
    return [clean(x) for x in items]


@api.post("/payments")
async def create_payment(body: PaymentIn, user=Depends(current_user)):
    booking = await db.bookings.find_one({"id": body.booking_id, "user_id": user["id"]})
    if not booking:
        raise HTTPException(400, "Booking not found")
    doc = {
        "id": new_id(),
        "user_id": user["id"],
        "booking_id": body.booking_id,
        "customer_id": booking.get("customer_id"),
        "amount": body.amount,
        "method": body.method,
        "paid_at": body.paid_at or now_utc().isoformat(),
        "created_at": now_utc(),
    }
    await db.payments.insert_one(doc.copy())
    return clean(doc)


# ---------- Dashboard ----------
@api.get("/dashboard")
async def dashboard(user=Depends(current_user)):
    user_id = user["id"]
    today = datetime.now().date()
    today_start = datetime.combine(today, datetime.min.time()).isoformat()
    today_end = datetime.combine(today, datetime.max.time()).isoformat()
    week_end = (datetime.combine(today, datetime.max.time()) + timedelta(days=7)).isoformat()

    # Today's appointments
    today_appts_raw = await db.bookings.find(
        {"user_id": user_id, "start_at": {"$gte": today_start, "$lte": today_end}}
    ).sort("start_at", 1).to_list(500)
    today_appts = []
    today_revenue = 0.0
    for b in today_appts_raw:
        b = clean(b)
        cust = await db.customers.find_one({"id": b["customer_id"], "user_id": user_id})
        pet = await db.pets.find_one({"id": b["pet_id"], "user_id": user_id})
        svc = await db.services.find_one({"id": b["service_id"], "user_id": user_id})
        b["customer_name"] = cust["name"] if cust else ""
        b["pet_name"] = pet["name"] if pet else ""
        b["pet_photo_path"] = pet.get("photo_path", "") if pet else ""
        b["service_name"] = svc["name"] if svc else ""
        today_appts.append(b)
        if b.get("status") != "cancelled":
            today_revenue += float(b.get("price", 0))

    # Upcoming (next 7 days, excluding today)
    tomorrow_start = (datetime.combine(today, datetime.min.time()) + timedelta(days=1)).isoformat()
    upcoming_raw = await db.bookings.find(
        {"user_id": user_id, "start_at": {"$gte": tomorrow_start, "$lte": week_end}, "status": {"$ne": "cancelled"}}
    ).sort("start_at", 1).to_list(50)
    upcoming = []
    for b in upcoming_raw:
        b = clean(b)
        pet = await db.pets.find_one({"id": b["pet_id"], "user_id": user_id})
        cust = await db.customers.find_one({"id": b["customer_id"], "user_id": user_id})
        svc = await db.services.find_one({"id": b["service_id"], "user_id": user_id})
        b["pet_name"] = pet["name"] if pet else ""
        b["pet_photo_path"] = pet.get("photo_path", "") if pet else ""
        b["customer_name"] = cust["name"] if cust else ""
        b["service_name"] = svc["name"] if svc else ""
        upcoming.append(b)

    # Outstanding payments: all non-cancelled bookings where paid < price.
    # Status is NEVER changed automatically — the business keeps full control.
    billable = await db.bookings.find({
        "user_id": user_id,
        "status": {"$nin": ["cancelled"]},
        "deleted_at": {"$exists": False},
    }).to_list(5000)
    outstanding_total = 0.0
    outstanding_count = 0
    for b in billable:
        paid = await db.payments.aggregate([
            {"$match": {"user_id": user_id, "booking_id": b["id"]}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]).to_list(1)
        total_paid = paid[0]["total"] if paid else 0.0
        due = float(b.get("price", 0)) - total_paid
        if due > 0.01:
            outstanding_total += due
            outstanding_count += 1

    # Pets due for rebooking: next_recommended_at <= today + 7
    cutoff = (today + timedelta(days=7)).isoformat()
    pets_due_raw = await db.pets.find({
        "user_id": user_id,
        "deleted_at": {"$exists": False},
        "next_recommended_at": {"$ne": "", "$lte": cutoff},
    }).to_list(50)
    pets_due = []
    for p in pets_due_raw:
        p = clean(p)
        cust = await db.customers.find_one({"id": p["customer_id"], "user_id": user_id})
        p["customer_name"] = cust["name"] if cust else ""
        p["customer_phone"] = cust.get("phone", "") if cust else ""
        pets_due.append(p)

    return {
        "today_appointments": today_appts,
        "today_revenue": round(today_revenue, 2),
        "upcoming_appointments": upcoming,
        "outstanding_total": round(outstanding_total, 2),
        "outstanding_count": outstanding_count,
        "pets_due": pets_due,
    }


# ---------- Rebooking message ----------
@api.get("/rebooking/message")
async def rebooking_message(pet_id: str, user=Depends(current_user)):
    pet = await db.pets.find_one({"id": pet_id, "user_id": user["id"]})
    if not pet:
        raise HTTPException(404, "Pet not found")
    cust = await db.customers.find_one({"id": pet["customer_id"], "user_id": user["id"]})
    profile = await db.business_profiles.find_one({"user_id": user["id"]})
    biz = profile["business_name"] if profile else "us"
    msg = (
        f"Hi {cust['name'] if cust else 'there'}, {pet['name']} may be due for their next "
        f"appointment with {biz}. Would you like me to get you booked in?"
    )
    return {"message": msg, "customer_phone": cust.get("phone", "") if cust else ""}


# ---------- Upload ----------
@api.post("/upload")
async def upload(file: UploadFile = File(...), user=Depends(current_user)):
    ext = (file.filename or "").split(".")[-1].lower() or "bin"
    path = f"{APP_NAME}/uploads/{user['id']}/{new_id()}.{ext}"
    data = await file.read()
    content_type = file.content_type or "application/octet-stream"
    try:
        result = await run_in_threadpool(_put_object_sync, path, data, content_type)
    except requests.HTTPError as e:
        log.error("Upload failed: %s", e)
        raise HTTPException(status_code=502, detail="Upload failed")
    return {"path": result["path"], "size": result.get("size")}


@api.get("/files/{path:path}")
async def get_file(path: str, request: Request, token: Optional[str] = Query(None)):
    # Auth via Authorization header OR ?token=
    auth_header = request.headers.get("Authorization", "")
    jwt_token = None
    if auth_header.lower().startswith("bearer "):
        jwt_token = auth_header.split(" ", 1)[1]
    elif token:
        jwt_token = token
    if not jwt_token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(jwt_token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except Exception:
        raise HTTPException(401, "Invalid token")
    # Ownership: path must start with APP_NAME/uploads/{user_id}/
    expected_prefix = f"{APP_NAME}/uploads/{user_id}/"
    if not path.startswith(expected_prefix):
        raise HTTPException(403, "Forbidden")
    try:
        content, ctype = await run_in_threadpool(_get_object_sync, path)
    except requests.HTTPError:
        raise HTTPException(404, "File not found")
    return Response(content=content, media_type=ctype)


# ---------- Demo data seeder ----------
DEMO_PETS = [
    {"name": "Fozzie", "breed": "Golden Retriever", "species": "Dog", "weight": "28kg", "behaviour_notes": "Friendly, loves treats", "allergies": "None known", "vaccinations": "Up to date (2026)"},
    {"name": "Luna", "breed": "French Bulldog", "species": "Dog", "weight": "11kg", "behaviour_notes": "Shy at first, warms up quickly", "allergies": "Chicken", "vaccinations": "Due April 2026"},
    {"name": "Milo", "breed": "Cockapoo", "species": "Dog", "weight": "9kg", "behaviour_notes": "Energetic puppy", "allergies": "None", "vaccinations": "Up to date"},
    {"name": "Bella", "breed": "Shih Tzu", "species": "Dog", "weight": "6kg", "behaviour_notes": "Gentle, nervous of clippers", "allergies": "None", "vaccinations": "Up to date"},
    {"name": "Rocky", "breed": "Border Collie", "species": "Dog", "weight": "22kg", "behaviour_notes": "Working dog, well-trained", "allergies": "None", "vaccinations": "Up to date"},
]


async def _seed_demo_data(user_id: str) -> None:
    """Seed demo customers, pets and bookings so the dashboard looks alive."""
    existing = await db.customers.count_documents({"user_id": user_id})
    if existing > 0:
        return
    # Ensure services exist
    svc_count = await db.services.count_documents({"user_id": user_id})
    if svc_count == 0:
        base_services = [
            {"name": "Full Groom", "price": 55.0, "duration_minutes": 120},
            {"name": "Nail Trim", "price": 10.0, "duration_minutes": 15},
            {"name": "Bath & Brush", "price": 30.0, "duration_minutes": 60},
            {"name": "Dog Walk", "price": 15.0, "duration_minutes": 60},
        ]
        for s in base_services:
            await db.services.insert_one({"id": new_id(), "user_id": user_id, **s, "created_at": now_utc()})
    services = await db.services.find({"user_id": user_id}).to_list(100)

    demo_customers = [
        {"name": "Sarah Thompson", "phone": "07700 900101", "email": "sarah.t@example.com", "address": "12 Oak Lane, Bristol", "notes": "Prefers Tuesdays"},
        {"name": "James Walker", "phone": "07700 900102", "email": "james.w@example.com", "address": "4 Elm Court, Bristol", "notes": ""},
        {"name": "Priya Patel", "phone": "07700 900103", "email": "priya.p@example.com", "address": "88 Hill Road, Bath", "notes": "Dog is nervous around other dogs"},
        {"name": "Michael Chen", "phone": "07700 900104", "email": "m.chen@example.com", "address": "6 Riverside, Bristol", "notes": ""},
        {"name": "Emily Davies", "phone": "07700 900105", "email": "emily.d@example.com", "address": "27 Beech Close, Bristol", "notes": "Pays by card only"},
    ]

    today = datetime.now()
    customer_ids = []
    for i, c in enumerate(demo_customers):
        cid = new_id()
        customer_ids.append(cid)
        await db.customers.insert_one({
            "id": cid, "user_id": user_id, **c, "created_at": now_utc(),
        })
        pet = DEMO_PETS[i]
        pid = new_id()
        next_rec = (today + timedelta(days=(i - 2) * 4)).date().isoformat()  # some overdue, some upcoming
        await db.pets.insert_one({
            "id": pid, "user_id": user_id, "customer_id": cid,
            **pet,
            "date_of_birth": "", "medical_notes": "", "special_requirements": "",
            "photo_path": "", "next_recommended_at": next_rec,
            "created_at": now_utc(),
        })

        # Create bookings: one today, one upcoming, one past completed
        svc = services[i % len(services)]
        today_time = today.replace(hour=9 + i * 2, minute=0, second=0, microsecond=0)
        await db.bookings.insert_one({
            "id": new_id(), "user_id": user_id,
            "customer_id": cid, "pet_id": pid, "service_id": svc["id"],
            "start_at": today_time.isoformat(),
            "duration_minutes": svc["duration_minutes"],
            "price": svc["price"],
            "notes": "", "status": "confirmed",
            "created_at": now_utc(),
        })
        upcoming_time = today + timedelta(days=i + 2, hours=10 - today.hour)
        await db.bookings.insert_one({
            "id": new_id(), "user_id": user_id,
            "customer_id": cid, "pet_id": pid, "service_id": svc["id"],
            "start_at": upcoming_time.replace(minute=0, second=0, microsecond=0).isoformat(),
            "duration_minutes": svc["duration_minutes"],
            "price": svc["price"],
            "notes": "", "status": "confirmed",
            "created_at": now_utc(),
        })
        past_booking_id = new_id()
        past_time = today - timedelta(days=28 - i)
        await db.bookings.insert_one({
            "id": past_booking_id, "user_id": user_id,
            "customer_id": cid, "pet_id": pid, "service_id": svc["id"],
            "start_at": past_time.replace(hour=11, minute=0, second=0, microsecond=0).isoformat(),
            "duration_minutes": svc["duration_minutes"],
            "price": svc["price"],
            "notes": "", "status": "completed",
            "created_at": now_utc(),
        })
        # Payment for past booking (some unpaid to create outstanding)
        if i % 2 == 0:
            await db.payments.insert_one({
                "id": new_id(), "user_id": user_id,
                "booking_id": past_booking_id, "customer_id": cid,
                "amount": svc["price"], "method": "card",
                "paid_at": past_time.isoformat(), "created_at": now_utc(),
            })


@api.post("/seed-demo")
async def seed_demo(user=Depends(current_user)):
    await _seed_demo_data(user["id"])
    return {"ok": True}


# ---------- Health ----------
@api.get("/")
async def root():
    return {"service": "petadmin", "status": "ok"}


# Mount router + CORS
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("id", unique=True)
        for col in ["customers", "pets", "services", "bookings", "payments"]:
            await db[col].create_index("id", unique=True)
            await db[col].create_index("user_id")
    except Exception as e:
        log.warning("Index creation issue: %s", e)
    try:
        if EMERGENT_LLM_KEY:
            await run_in_threadpool(_init_storage_sync)
    except Exception as e:
        log.warning("Storage init failed (will retry on demand): %s", e)


@app.on_event("shutdown")
async def _shutdown():
    client.close()
