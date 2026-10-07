"""PetAdmin backend API — multi-tenant (business scoped)."""
import os
import uuid
import secrets
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Any, Dict, Tuple

import bcrypt
import jwt
import stripe
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

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "petadmin"
_storage_key: Optional[str] = None

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_AMOUNT_GBP = int(os.environ.get("STRIPE_PRICE_AMOUNT_GBP", "1299"))
STRIPE_TRIAL_DAYS = int(os.environ.get("STRIPE_TRIAL_DAYS", "14"))
stripe.api_key = STRIPE_API_KEY
if "sk_test_emergent" in STRIPE_API_KEY:
    stripe.api_base = "https://integrations.emergentagent.com/stripe"

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


async def _user_from_token(creds: Optional[HTTPAuthorizationCredentials]) -> Dict[str, Any]:
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


async def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> Dict[str, Any]:
    """Returns the authenticated user, no business scope. Used for pre-onboarding endpoints."""
    return await _user_from_token(creds)


class Member(BaseModel):
    user_id: str
    email: str
    business_id: str
    role: str  # owner | admin | staff
    membership_id: str


async def _resolve_active_membership(user: Dict[str, Any]) -> Dict[str, Any]:
    """Find the user's active membership. Prefers the one stored on the user doc; otherwise first active."""
    preferred = user.get("active_business_id")
    q: Dict[str, Any] = {"user_id": user["id"], "status": "active"}
    if preferred:
        m = await db.memberships.find_one({**q, "business_id": preferred})
        if m:
            return clean(m)
    m = await db.memberships.find_one(q)
    if m:
        return clean(m)
    return None  # no business yet


async def current_member(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> Member:
    """Authenticated user who BELONGS to an active business. Raises 403 if not."""
    user = await _user_from_token(creds)
    m = await _resolve_active_membership(user)
    if not m:
        raise HTTPException(status_code=403, detail="You are not a member of any business yet. Create or join one.")
    return Member(
        user_id=user["id"], email=user["email"],
        business_id=m["business_id"], role=m.get("role", "staff"), membership_id=m["id"],
    )


async def require_owner(member: Member = Depends(current_member)) -> Member:
    if member.role != "owner":
        raise HTTPException(status_code=403, detail="Only the business owner can perform this action.")
    return member


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
    name: Optional[str] = ""


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: Optional[str] = ""
    onboarded: bool = False
    created_at: str
    business_id: Optional[str] = None
    role: Optional[str] = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class OnboardingIn(BaseModel):
    business_name: str
    business_type: str
    owner_name: str
    phone: str = ""
    opening_hours: Dict[str, str] = Field(default_factory=dict)
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
    date_of_birth: Optional[str] = ""
    weight: Optional[str] = ""
    allergies: Optional[str] = ""
    medical_notes: Optional[str] = ""
    behaviour_notes: Optional[str] = ""
    special_requirements: Optional[str] = ""
    vaccinations: Optional[str] = ""
    photo_path: Optional[str] = ""
    next_recommended_at: Optional[str] = ""


class ServiceIn(BaseModel):
    name: str
    price: float
    duration_minutes: int


class BookingIn(BaseModel):
    customer_id: str
    pet_id: str
    service_id: str
    start_at: str
    duration_minutes: Optional[int] = None
    price: Optional[float] = None
    notes: Optional[str] = ""
    status: str = "confirmed"


class PaymentIn(BaseModel):
    booking_id: str
    amount: float
    method: str = "cash"
    paid_at: Optional[str] = None


class InviteIn(BaseModel):
    email: EmailStr
    role: str = "staff"  # staff | admin


class AcceptInviteIn(BaseModel):
    token: str
    password: str = Field(min_length=6, max_length=128)
    name: Optional[str] = ""


# ---------- Business utilities ----------
async def _get_business(business_id: str) -> Optional[Dict[str, Any]]:
    b = await db.businesses.find_one({"id": business_id})
    return clean(b)


async def _user_summary(user: Dict[str, Any]) -> UserOut:
    m = await _resolve_active_membership(user)
    return UserOut(
        id=user["id"],
        email=user["email"],
        name=user.get("name", ""),
        onboarded=bool(m),
        created_at=user["created_at"] if isinstance(user["created_at"], str) else user["created_at"].isoformat(),
        business_id=m["business_id"] if m else None,
        role=m["role"] if m else None,
    )


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
        "name": (body.name or "").strip(),
        "password_hash": hash_password(body.password),
        "created_at": now,
    }
    await db.users.insert_one(user_doc.copy())
    token = make_token(user_doc["id"])
    out = await _user_summary(user_doc)
    return TokenOut(access_token=token, user=out)


@api.post("/auth/login", response_model=TokenOut)
async def login(body: LoginIn):
    email = body.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    # Block login if the user has memberships but all are deactivated
    memberships = await db.memberships.find({"user_id": user["id"]}).to_list(50)
    if memberships and not any(m.get("status") == "active" for m in memberships):
        raise HTTPException(status_code=403, detail="Your access to this business has been removed. Please contact the business owner.")
    token = make_token(user["id"])
    out = await _user_summary(clean(user))
    return TokenOut(access_token=token, user=out)


@api.get("/auth/me", response_model=UserOut)
async def me(user=Depends(current_user)):
    return await _user_summary(user)


# ---------- Onboarding (creates a business + owner membership) ----------
@api.post("/onboarding")
async def onboarding(body: OnboardingIn, user=Depends(current_user)):
    existing = await _resolve_active_membership(user)
    if existing:
        # Already belongs to a business — update profile only (owner permission).
        if existing["role"] != "owner":
            raise HTTPException(403, "Only the business owner can edit the business profile.")
        await db.businesses.update_one(
            {"id": existing["business_id"]},
            {"$set": {
                "name": body.business_name,
                "type": body.business_type,
                "owner_name": body.owner_name,
                "phone": body.phone,
                "opening_hours": body.opening_hours,
                "updated_at": now_utc(),
            }},
        )
        return {"ok": True, "business_id": existing["business_id"]}

    now = now_utc()
    biz_id = new_id()
    biz_doc = {
        "id": biz_id,
        "name": body.business_name,
        "type": body.business_type,
        "owner_name": body.owner_name,
        "phone": body.phone,
        "opening_hours": body.opening_hours,
        "owner_user_id": user["id"],
        "subscription_status": "trial",
        "trial_ends_at": now + timedelta(days=STRIPE_TRIAL_DAYS),
        "created_at": now,
    }
    await db.businesses.insert_one(biz_doc.copy())
    await db.memberships.insert_one({
        "id": new_id(),
        "user_id": user["id"],
        "business_id": biz_id,
        "role": "owner",
        "status": "active",
        "invited_at": now,
        "joined_at": now,
    })
    await db.users.update_one({"id": user["id"]}, {"$set": {"active_business_id": biz_id, "name": body.owner_name or user.get("name", "")}})

    for svc in body.services:
        s = {
            "id": new_id(),
            "business_id": biz_id,
            "name": svc.get("name", "Service"),
            "price": float(svc.get("price", 0)),
            "duration_minutes": int(svc.get("duration_minutes", 60)),
            "created_at": now,
        }
        await db.services.insert_one(s.copy())

    if body.seed_demo:
        await _seed_demo_data(biz_id)

    return {"ok": True, "business_id": biz_id}


# ---------- Business profile ----------
@api.get("/profile")
async def get_profile(member: Member = Depends(current_member)):
    b = await _get_business(member.business_id)
    if not b:
        return {}
    return {
        "business_id": b["id"],
        "business_name": b.get("name", ""),
        "business_type": b.get("type", ""),
        "owner_name": b.get("owner_name", ""),
        "phone": b.get("phone", ""),
        "opening_hours": b.get("opening_hours", {}),
    }


# ---------- Services ----------
@api.get("/services")
async def list_services(member: Member = Depends(current_member)):
    items = await db.services.find({"business_id": member.business_id, "deleted_at": {"$exists": False}}).to_list(500)
    return [clean(x) for x in items]


@api.post("/services")
async def create_service(body: ServiceIn, member: Member = Depends(current_member)):
    doc = {
        "id": new_id(),
        "business_id": member.business_id,
        "name": body.name,
        "price": body.price,
        "duration_minutes": body.duration_minutes,
        "created_at": now_utc(),
    }
    await db.services.insert_one(doc.copy())
    return clean(doc)


@api.put("/services/{sid}")
async def update_service(sid: str, body: ServiceIn, member: Member = Depends(current_member)):
    r = await db.services.update_one(
        {"id": sid, "business_id": member.business_id},
        {"$set": {"name": body.name, "price": body.price, "duration_minutes": body.duration_minutes}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.delete("/services/{sid}")
async def delete_service(sid: str, member: Member = Depends(current_member)):
    await db.services.update_one(
        {"id": sid, "business_id": member.business_id}, {"$set": {"deleted_at": now_utc()}}
    )
    return {"ok": True}


# ---------- Customers ----------
@api.get("/customers")
async def list_customers(member: Member = Depends(current_member)):
    items = await db.customers.find(
        {"business_id": member.business_id, "deleted_at": {"$exists": False}}
    ).sort("name", 1).to_list(1000)
    results = []
    for c in items:
        c = clean(c)
        pets = await db.pets.find({"business_id": member.business_id, "customer_id": c["id"], "deleted_at": {"$exists": False}}).to_list(100)
        c["pets"] = [clean(p) for p in pets]
        results.append(c)
    return results


@api.get("/customers/{cid}")
async def get_customer(cid: str, member: Member = Depends(current_member)):
    c = await db.customers.find_one({"id": cid, "business_id": member.business_id})
    if not c:
        raise HTTPException(404, "Not found")
    c = clean(c)
    pets = await db.pets.find({"business_id": member.business_id, "customer_id": cid, "deleted_at": {"$exists": False}}).to_list(100)
    c["pets"] = [clean(p) for p in pets]
    bookings = await db.bookings.find({"business_id": member.business_id, "customer_id": cid}).sort("start_at", -1).to_list(500)
    c["bookings"] = [clean(b) for b in bookings]
    payments = await db.payments.find({"business_id": member.business_id, "customer_id": cid}).sort("paid_at", -1).to_list(500)
    c["payments"] = [clean(p) for p in payments]
    return c


@api.post("/customers")
async def create_customer(body: CustomerIn, member: Member = Depends(current_member)):
    doc = {
        "id": new_id(),
        "business_id": member.business_id,
        **body.dict(),
        "created_at": now_utc(),
    }
    await db.customers.insert_one(doc.copy())
    return clean(doc)


@api.put("/customers/{cid}")
async def update_customer(cid: str, body: CustomerIn, member: Member = Depends(current_member)):
    r = await db.customers.update_one(
        {"id": cid, "business_id": member.business_id}, {"$set": body.dict()}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.delete("/customers/{cid}")
async def delete_customer(cid: str, member: Member = Depends(current_member)):
    r = await db.customers.update_one(
        {"id": cid, "business_id": member.business_id}, {"$set": {"deleted_at": now_utc()}}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---------- Pets ----------
@api.get("/pets")
async def list_pets(member: Member = Depends(current_member), customer_id: Optional[str] = None):
    q: Dict[str, Any] = {"business_id": member.business_id, "deleted_at": {"$exists": False}}
    if customer_id:
        q["customer_id"] = customer_id
    items = await db.pets.find(q).sort("name", 1).to_list(1000)
    results = []
    for p in items:
        p = clean(p)
        cust = await db.customers.find_one({"id": p["customer_id"], "business_id": member.business_id})
        p["customer_name"] = cust["name"] if cust else ""
        results.append(p)
    return results


@api.get("/pets/{pid}")
async def get_pet(pid: str, member: Member = Depends(current_member)):
    p = await db.pets.find_one({"id": pid, "business_id": member.business_id})
    if not p:
        raise HTTPException(404, "Not found")
    p = clean(p)
    cust = await db.customers.find_one({"id": p["customer_id"], "business_id": member.business_id})
    p["customer"] = clean(cust) if cust else None
    bookings = await db.bookings.find({"business_id": member.business_id, "pet_id": pid}).sort("start_at", -1).to_list(500)
    p["bookings"] = [clean(b) for b in bookings]
    booking_ids = [b["id"] for b in p["bookings"]]
    payments = await db.payments.find({"business_id": member.business_id, "booking_id": {"$in": booking_ids}}).sort("paid_at", -1).to_list(500)
    p["payments"] = [clean(x) for x in payments]
    completed = [b for b in p["bookings"] if b.get("status") == "completed"]
    p["last_appointment"] = completed[0]["start_at"] if completed else None
    upcoming = [b for b in p["bookings"] if b.get("status") == "confirmed" and b.get("start_at", "") >= now_utc().isoformat()]
    upcoming.sort(key=lambda x: x.get("start_at", ""))
    p["next_appointment"] = upcoming[0]["start_at"] if upcoming else None
    return p


@api.post("/pets")
async def create_pet(body: PetIn, member: Member = Depends(current_member)):
    # Ensure customer belongs to this business
    owner = await db.customers.find_one({"id": body.customer_id, "business_id": member.business_id})
    if not owner:
        raise HTTPException(400, "Customer not found in your business")
    doc = {
        "id": new_id(),
        "business_id": member.business_id,
        **body.dict(),
        "created_at": now_utc(),
    }
    await db.pets.insert_one(doc.copy())
    return clean(doc)


@api.put("/pets/{pid}")
async def update_pet(pid: str, body: PetIn, member: Member = Depends(current_member)):
    owner = await db.customers.find_one({"id": body.customer_id, "business_id": member.business_id})
    if not owner:
        raise HTTPException(400, "Customer not found in your business")
    r = await db.pets.update_one(
        {"id": pid, "business_id": member.business_id}, {"$set": body.dict()}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.delete("/pets/{pid}")
async def delete_pet(pid: str, member: Member = Depends(current_member)):
    r = await db.pets.update_one(
        {"id": pid, "business_id": member.business_id}, {"$set": {"deleted_at": now_utc()}}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---------- Bookings ----------
@api.get("/bookings")
async def list_bookings(
    member: Member = Depends(current_member),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    q: Dict[str, Any] = {"business_id": member.business_id}
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
        cust = await db.customers.find_one({"id": b["customer_id"], "business_id": member.business_id})
        pet = await db.pets.find_one({"id": b["pet_id"], "business_id": member.business_id})
        svc = await db.services.find_one({"id": b["service_id"], "business_id": member.business_id})
        b["customer_name"] = cust["name"] if cust else ""
        b["pet_name"] = pet["name"] if pet else ""
        b["pet_photo_path"] = pet.get("photo_path", "") if pet else ""
        b["service_name"] = svc["name"] if svc else ""
        out.append(b)
    return out


async def _enrich_booking(b: Dict[str, Any], business_id: str) -> Dict[str, Any]:
    cust = await db.customers.find_one({"id": b["customer_id"], "business_id": business_id})
    pet = await db.pets.find_one({"id": b["pet_id"], "business_id": business_id})
    svc = await db.services.find_one({"id": b["service_id"], "business_id": business_id})
    b["customer_name"] = cust["name"] if cust else ""
    b["pet_name"] = pet["name"] if pet else ""
    b["pet_photo_path"] = pet.get("photo_path", "") if pet else ""
    b["service_name"] = svc["name"] if svc else ""
    payments = await db.payments.find({"business_id": business_id, "booking_id": b["id"]}).sort("paid_at", -1).to_list(500)
    paid_total = sum(float(p.get("amount", 0)) for p in payments)
    b["paid_total"] = round(paid_total, 2)
    b["outstanding"] = round(max(0.0, float(b.get("price", 0)) - paid_total), 2)
    b["payments"] = [clean(p) for p in payments]
    return b


@api.get("/bookings/{bid}")
async def get_booking(bid: str, member: Member = Depends(current_member)):
    b = await db.bookings.find_one({"id": bid, "business_id": member.business_id})
    if not b:
        raise HTTPException(404, "Not found")
    b = clean(b)
    return await _enrich_booking(b, member.business_id)


async def _validate_booking_refs(member: Member, customer_id: str, pet_id: str, service_id: str) -> Dict[str, Any]:
    cust = await db.customers.find_one({"id": customer_id, "business_id": member.business_id})
    pet = await db.pets.find_one({"id": pet_id, "business_id": member.business_id})
    svc = await db.services.find_one({"id": service_id, "business_id": member.business_id})
    if not cust or not pet or not svc:
        raise HTTPException(400, "Customer, pet or service not found in your business")
    if pet.get("customer_id") != customer_id:
        raise HTTPException(400, "Pet does not belong to this customer")
    return svc


@api.post("/bookings")
async def create_booking(body: BookingIn, member: Member = Depends(current_member)):
    svc = await _validate_booking_refs(member, body.customer_id, body.pet_id, body.service_id)
    doc = {
        "id": new_id(),
        "business_id": member.business_id,
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
async def update_booking(bid: str, body: BookingIn, member: Member = Depends(current_member)):
    svc = await _validate_booking_refs(member, body.customer_id, body.pet_id, body.service_id)
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
    r = await db.bookings.update_one({"id": bid, "business_id": member.business_id}, {"$set": update})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.post("/bookings/{bid}/status")
async def set_booking_status(bid: str, body: Dict[str, str], member: Member = Depends(current_member)):
    status = body.get("status", "")
    if status not in {"confirmed", "completed", "cancelled", "no_show"}:
        raise HTTPException(400, "Invalid status")
    r = await db.bookings.update_one({"id": bid, "business_id": member.business_id}, {"$set": {"status": status}})
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


@api.delete("/bookings/{bid}")
async def delete_booking(bid: str, member: Member = Depends(current_member)):
    r = await db.bookings.update_one(
        {"id": bid, "business_id": member.business_id},
        {"$set": {"deleted_at": now_utc(), "status": "cancelled"}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---------- Payments ----------
@api.get("/payments")
async def list_payments(member: Member = Depends(current_member)):
    items = await db.payments.find({"business_id": member.business_id}).sort("paid_at", -1).to_list(2000)
    return [clean(x) for x in items]


@api.post("/payments")
async def create_payment(body: PaymentIn, member: Member = Depends(current_member)):
    booking = await db.bookings.find_one({"id": body.booking_id, "business_id": member.business_id})
    if not booking:
        raise HTTPException(400, "Booking not found")
    doc = {
        "id": new_id(),
        "business_id": member.business_id,
        "booking_id": body.booking_id,
        "customer_id": booking.get("customer_id"),
        "amount": body.amount,
        "method": body.method,
        "paid_at": body.paid_at or now_utc().isoformat(),
        "recorded_by_user_id": member.user_id,
        "created_at": now_utc(),
    }
    await db.payments.insert_one(doc.copy())
    return clean(doc)


# ---------- Dashboard ----------
@api.get("/dashboard")
async def dashboard(member: Member = Depends(current_member)):
    business_id = member.business_id
    today = datetime.now().date()
    today_start = datetime.combine(today, datetime.min.time()).isoformat()
    today_end = datetime.combine(today, datetime.max.time()).isoformat()
    week_end = (datetime.combine(today, datetime.max.time()) + timedelta(days=7)).isoformat()

    today_appts_raw = await db.bookings.find(
        {"business_id": business_id, "start_at": {"$gte": today_start, "$lte": today_end}}
    ).sort("start_at", 1).to_list(500)
    today_appts = []
    today_revenue = 0.0
    for b in today_appts_raw:
        b = clean(b)
        cust = await db.customers.find_one({"id": b["customer_id"], "business_id": business_id})
        pet = await db.pets.find_one({"id": b["pet_id"], "business_id": business_id})
        svc = await db.services.find_one({"id": b["service_id"], "business_id": business_id})
        b["customer_name"] = cust["name"] if cust else ""
        b["pet_name"] = pet["name"] if pet else ""
        b["pet_photo_path"] = pet.get("photo_path", "") if pet else ""
        b["service_name"] = svc["name"] if svc else ""
        today_appts.append(b)
        if b.get("status") != "cancelled":
            today_revenue += float(b.get("price", 0))

    tomorrow_start = (datetime.combine(today, datetime.min.time()) + timedelta(days=1)).isoformat()
    upcoming_raw = await db.bookings.find(
        {"business_id": business_id, "start_at": {"$gte": tomorrow_start, "$lte": week_end}, "status": {"$ne": "cancelled"}}
    ).sort("start_at", 1).to_list(50)
    upcoming = []
    for b in upcoming_raw:
        b = clean(b)
        pet = await db.pets.find_one({"id": b["pet_id"], "business_id": business_id})
        cust = await db.customers.find_one({"id": b["customer_id"], "business_id": business_id})
        svc = await db.services.find_one({"id": b["service_id"], "business_id": business_id})
        b["pet_name"] = pet["name"] if pet else ""
        b["pet_photo_path"] = pet.get("photo_path", "") if pet else ""
        b["customer_name"] = cust["name"] if cust else ""
        b["service_name"] = svc["name"] if svc else ""
        upcoming.append(b)

    billable = await db.bookings.find({
        "business_id": business_id,
        "status": {"$nin": ["cancelled"]},
        "deleted_at": {"$exists": False},
    }).to_list(5000)
    outstanding_total = 0.0
    outstanding_count = 0
    for b in billable:
        paid = await db.payments.aggregate([
            {"$match": {"business_id": business_id, "booking_id": b["id"]}},
            {"$group": {"_id": None, "total": {"$sum": "$amount"}}},
        ]).to_list(1)
        total_paid = paid[0]["total"] if paid else 0.0
        due = float(b.get("price", 0)) - total_paid
        if due > 0.01:
            outstanding_total += due
            outstanding_count += 1

    cutoff = (today + timedelta(days=7)).isoformat()
    pets_due_raw = await db.pets.find({
        "business_id": business_id,
        "deleted_at": {"$exists": False},
        "next_recommended_at": {"$ne": "", "$lte": cutoff},
    }).to_list(50)
    pets_due = []
    for p in pets_due_raw:
        p = clean(p)
        cust = await db.customers.find_one({"id": p["customer_id"], "business_id": business_id})
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
async def rebooking_message(pet_id: str, member: Member = Depends(current_member)):
    pet = await db.pets.find_one({"id": pet_id, "business_id": member.business_id})
    if not pet:
        raise HTTPException(404, "Pet not found")
    cust = await db.customers.find_one({"id": pet["customer_id"], "business_id": member.business_id})
    biz = await _get_business(member.business_id)
    biz_name = biz.get("name", "us") if biz else "us"
    msg = (
        f"Hi {cust['name'] if cust else 'there'}, {pet['name']} may be due for their next "
        f"appointment with {biz_name}. Would you like me to get you booked in?"
    )
    return {"message": msg, "customer_phone": cust.get("phone", "") if cust else ""}


# ---------- Upload ----------
@api.post("/upload")
async def upload(file: UploadFile = File(...), member: Member = Depends(current_member)):
    ext = (file.filename or "").split(".")[-1].lower() or "bin"
    path = f"{APP_NAME}/uploads/{member.business_id}/{new_id()}.{ext}"
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
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(401, "User not found")
    m = await _resolve_active_membership(clean(user))
    if not m:
        raise HTTPException(403, "Forbidden")
    biz_id = m["business_id"]
    biz = await _get_business(biz_id)
    allowed_prefixes = [f"{APP_NAME}/uploads/{biz_id}/"]
    if biz and biz.get("legacy_owner_user_id"):
        allowed_prefixes.append(f"{APP_NAME}/uploads/{biz['legacy_owner_user_id']}/")
    if not any(path.startswith(p) for p in allowed_prefixes):
        raise HTTPException(403, "Forbidden")
    try:
        content, ctype = await run_in_threadpool(_get_object_sync, path)
    except requests.HTTPError:
        raise HTTPException(404, "File not found")
    return Response(content=content, media_type=ctype)


# ---------- Staff management ----------
@api.get("/staff")
async def list_staff(member: Member = Depends(current_member)):
    memberships = await db.memberships.find({"business_id": member.business_id}).to_list(500)
    out = []
    for m in memberships:
        u = await db.users.find_one({"id": m["user_id"]})
        out.append({
            "membership_id": m["id"],
            "user_id": m["user_id"],
            "email": u["email"] if u else "",
            "name": (u or {}).get("name", ""),
            "role": m.get("role", "staff"),
            "status": m.get("status", "active"),
            "joined_at": m.get("joined_at").isoformat() if isinstance(m.get("joined_at"), datetime) else m.get("joined_at"),
            "is_you": m["user_id"] == member.user_id,
        })
    # Pending invites
    invites = await db.invites.find({"business_id": member.business_id, "status": "pending"}).to_list(200)
    pending = [{
        "invite_id": i["id"],
        "email": i["email"],
        "role": i.get("role", "staff"),
        "status": "invited",
        "invited_at": i["created_at"].isoformat() if isinstance(i["created_at"], datetime) else i["created_at"],
    } for i in invites]
    return {"members": out, "invites": pending}


@api.post("/staff/invite")
async def invite_staff(body: InviteIn, owner: Member = Depends(require_owner), request: Request = None):
    email = body.email.lower().strip()
    role = body.role if body.role in {"staff", "admin"} else "staff"
    # Already a member?
    existing_user = await db.users.find_one({"email": email})
    if existing_user:
        existing_m = await db.memberships.find_one({"user_id": existing_user["id"], "business_id": owner.business_id})
        if existing_m:
            raise HTTPException(409, "That person is already in this business")
    # Existing pending invite?
    existing_invite = await db.invites.find_one({"business_id": owner.business_id, "email": email, "status": "pending"})
    token = existing_invite["token"] if existing_invite else secrets.token_urlsafe(24)
    now = now_utc()
    doc = {
        "id": existing_invite["id"] if existing_invite else new_id(),
        "business_id": owner.business_id,
        "email": email,
        "role": role,
        "token": token,
        "status": "pending",
        "invited_by": owner.user_id,
        "created_at": now,
        "expires_at": now + timedelta(days=14),
    }
    await db.invites.update_one({"id": doc["id"]}, {"$set": doc}, upsert=True)

    origin = ""
    if request is not None:
        origin = request.headers.get("origin") or request.headers.get("referer") or ""
        origin = origin.rstrip("/").split("?")[0]
    invite_link = f"{origin}/invite/{token}" if origin else f"/invite/{token}"
    # Email provider not yet configured — log the link so the owner can share it.
    log.info("Invite created for %s → %s", email, invite_link)
    return {"ok": True, "invite_link": invite_link, "token": token}


@api.get("/invites/{token}")
async def get_invite(token: str):
    inv = await db.invites.find_one({"token": token, "status": "pending"})
    if not inv:
        raise HTTPException(404, "Invite not found or already used")
    biz = await _get_business(inv["business_id"])
    if not biz:
        raise HTTPException(404, "Business not found")
    expires_at = inv.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now_utc():
            raise HTTPException(410, "This invite has expired")
    return {
        "email": inv["email"],
        "business_name": biz.get("name", ""),
        "role": inv.get("role", "staff"),
        "invited_by": inv.get("invited_by"),
    }


@api.post("/invites/accept", response_model=TokenOut)
async def accept_invite(body: AcceptInviteIn):
    inv = await db.invites.find_one({"token": body.token, "status": "pending"})
    if not inv:
        raise HTTPException(404, "Invite not found or already used")
    expires_at = inv.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now_utc():
            raise HTTPException(410, "This invite has expired")
    email = inv["email"]
    business_id = inv["business_id"]
    now = now_utc()

    user = await db.users.find_one({"email": email})
    if user:
        # Existing user — verify password
        if not verify_password(body.password, user["password_hash"]):
            raise HTTPException(401, "This email already has an account — please use its password to accept the invite.")
    else:
        user_doc = {
            "id": new_id(),
            "email": email,
            "name": (body.name or "").strip(),
            "password_hash": hash_password(body.password),
            "created_at": now,
        }
        await db.users.insert_one(user_doc.copy())
        user = user_doc

    # Idempotent membership
    existing_m = await db.memberships.find_one({"user_id": user["id"], "business_id": business_id})
    if existing_m:
        if existing_m.get("status") != "active":
            await db.memberships.update_one({"id": existing_m["id"]}, {"$set": {"status": "active", "joined_at": now}})
    else:
        await db.memberships.insert_one({
            "id": new_id(),
            "user_id": user["id"],
            "business_id": business_id,
            "role": inv.get("role", "staff"),
            "status": "active",
            "invited_at": inv.get("created_at", now),
            "joined_at": now,
        })

    await db.users.update_one({"id": user["id"]}, {"$set": {"active_business_id": business_id}})
    await db.invites.update_one({"id": inv["id"]}, {"$set": {"status": "accepted", "accepted_at": now}})

    token = make_token(user["id"])
    out = await _user_summary(clean(user))
    return TokenOut(access_token=token, user=out)


@api.post("/staff/{membership_id}/deactivate")
async def deactivate_staff(membership_id: str, owner: Member = Depends(require_owner)):
    m = await db.memberships.find_one({"id": membership_id, "business_id": owner.business_id})
    if not m:
        raise HTTPException(404, "Member not found")
    if m.get("role") == "owner":
        raise HTTPException(400, "You cannot deactivate the business owner")
    await db.memberships.update_one({"id": membership_id}, {"$set": {"status": "deactivated", "deactivated_at": now_utc()}})
    return {"ok": True}


@api.post("/staff/{membership_id}/reactivate")
async def reactivate_staff(membership_id: str, owner: Member = Depends(require_owner)):
    m = await db.memberships.find_one({"id": membership_id, "business_id": owner.business_id})
    if not m:
        raise HTTPException(404, "Member not found")
    await db.memberships.update_one({"id": membership_id}, {"$set": {"status": "active"}})
    return {"ok": True}


@api.delete("/staff/{membership_id}")
async def remove_staff(membership_id: str, owner: Member = Depends(require_owner)):
    m = await db.memberships.find_one({"id": membership_id, "business_id": owner.business_id})
    if not m:
        raise HTTPException(404, "Member not found")
    if m.get("role") == "owner":
        raise HTTPException(400, "You cannot remove the business owner")
    await db.memberships.delete_one({"id": membership_id})
    return {"ok": True}


@api.delete("/invites/{invite_id}")
async def cancel_invite(invite_id: str, owner: Member = Depends(require_owner)):
    r = await db.invites.update_one(
        {"id": invite_id, "business_id": owner.business_id, "status": "pending"},
        {"$set": {"status": "cancelled"}},
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Invite not found")
    return {"ok": True}


# ---------- Billing (per business, owner-only) ----------
class CheckoutIn(BaseModel):
    origin: str


def _subscription_summary(biz: Dict[str, Any]) -> Dict[str, Any]:
    status = biz.get("subscription_status", "trial")
    trial_ends_at = biz.get("trial_ends_at")
    trial_ends_iso = trial_ends_at.isoformat() if isinstance(trial_ends_at, datetime) else trial_ends_at
    days_left = 0
    if trial_ends_iso:
        try:
            end = datetime.fromisoformat(str(trial_ends_iso).replace("Z", "+00:00"))
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            delta = (end - now_utc()).days
            days_left = max(0, delta)
        except (TypeError, ValueError):
            days_left = 0
    entitled = status in {"trialing", "active"} or (status == "trial" and days_left > 0)
    return {
        "status": status,
        "entitled": entitled,
        "trial_ends_at": trial_ends_iso,
        "trial_days_left": days_left,
        "cancel_at_period_end": bool(biz.get("cancel_at_period_end", False)),
        "current_period_end": biz.get("current_period_end"),
        "has_stripe_customer": bool(biz.get("stripe_customer_id")),
    }


@api.get("/billing/status")
async def billing_status(member: Member = Depends(current_member)):
    biz = await _get_business(member.business_id)
    return _subscription_summary(biz or {})


@api.post("/billing/checkout")
async def create_checkout(body: CheckoutIn, owner: Member = Depends(require_owner)):
    if not STRIPE_API_KEY:
        raise HTTPException(500, "Stripe not configured")
    biz = await _get_business(owner.business_id)
    if not biz:
        raise HTTPException(404, "Business not found")
    user = await db.users.find_one({"id": owner.user_id})
    origin = body.origin.rstrip("/")
    try:
        kwargs: Dict[str, Any] = {
            "mode": "subscription",
            "line_items": [{
                "price_data": {
                    "currency": "gbp",
                    "product_data": {"name": "PetAdmin Pro"},
                    "recurring": {"interval": "month"},
                    "unit_amount": STRIPE_PRICE_AMOUNT_GBP,
                },
                "quantity": 1,
            }],
            "subscription_data": {
                "trial_period_days": STRIPE_TRIAL_DAYS,
                "metadata": {"business_id": owner.business_id, "user_id": owner.user_id},
            },
            "success_url": f"{origin}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
            "cancel_url": f"{origin}/billing/cancelled",
            "metadata": {"business_id": owner.business_id, "user_id": owner.user_id},
            "customer_email": user["email"] if user else owner.email,
        }
        session = await run_in_threadpool(stripe.checkout.Session.create, **kwargs)
    except stripe.error.StripeError as e:
        log.error("Stripe checkout error: %s", e)
        raise HTTPException(502, f"Stripe error: {getattr(e, 'user_message', None) or str(e)}")
    await db.checkout_sessions.update_one(
        {"session_id": session["id"]},
        {"$set": {
            "session_id": session["id"],
            "business_id": owner.business_id,
            "user_id": owner.user_id,
            "status": "created",
            "created_at": now_utc(),
        }},
        upsert=True,
    )
    return {"url": session["url"], "session_id": session["id"]}


@api.post("/billing/portal")
async def create_portal(body: CheckoutIn, owner: Member = Depends(require_owner)):
    if not STRIPE_API_KEY:
        raise HTTPException(500, "Stripe not configured")
    biz = await _get_business(owner.business_id)
    customer_id = (biz or {}).get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(400, "No active subscription — please subscribe first.")
    origin = body.origin.rstrip("/")
    try:
        portal = await run_in_threadpool(
            stripe.billing_portal.Session.create,
            customer=customer_id,
            return_url=f"{origin}/",
        )
    except stripe.error.StripeError as e:
        log.error("Stripe portal error: %s", e)
        raise HTTPException(502, "Managing your subscription from inside the app isn't available on this preview environment yet.")
    return {"url": portal["url"]}


async def _activate_business_from_subscription(business_id: str, sub: Dict[str, Any]) -> None:
    update = {
        "subscription_status": sub.get("status", "trialing"),
        "stripe_subscription_id": sub.get("id"),
        "cancel_at_period_end": bool(sub.get("cancel_at_period_end")),
        "current_period_end": sub.get("current_period_end"),
        "subscription_updated_at": now_utc(),
    }
    await db.businesses.update_one({"id": business_id}, {"$set": update})


@api.get("/billing/verify")
async def verify_checkout(session_id: str, owner: Member = Depends(require_owner)):
    if not STRIPE_API_KEY:
        raise HTTPException(500, "Stripe not configured")
    try:
        session = await run_in_threadpool(
            stripe.checkout.Session.retrieve, session_id, expand=["subscription"],
        )
    except stripe.error.StripeError as e:
        raise HTTPException(502, f"Stripe error: {str(e)}")
    meta_biz = (session.get("metadata") or {}).get("business_id")
    if meta_biz and meta_biz != owner.business_id:
        raise HTTPException(403, "Session does not belong to this business")

    customer = session.get("customer")
    if isinstance(customer, str) and customer:
        await db.businesses.update_one({"id": owner.business_id}, {"$set": {"stripe_customer_id": customer}})

    sub = session.get("subscription")
    if isinstance(sub, dict):
        await _activate_business_from_subscription(owner.business_id, sub)

    await db.checkout_sessions.update_one(
        {"session_id": session_id, "business_id": owner.business_id},
        {"$set": {"status": session.get("status", "unknown"), "updated_at": now_utc()}},
    )
    biz = await _get_business(owner.business_id)
    return _subscription_summary(biz or {})


@app.post("/api/stripe/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    event: Optional[Dict[str, Any]] = None
    if STRIPE_WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(payload, signature, STRIPE_WEBHOOK_SECRET)
        except Exception:
            raise HTTPException(400, "Invalid webhook signature")
    else:
        import json as _json
        try:
            event = _json.loads(payload.decode("utf-8"))
        except Exception:
            raise HTTPException(400, "Invalid payload")

    event_id = event.get("id")
    if event_id:
        existing = await db.stripe_events.find_one({"id": event_id})
        if existing:
            return {"received": True, "duplicate": True}
        await db.stripe_events.insert_one({"id": event_id, "type": event.get("type"), "received_at": now_utc()})

    etype = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}

    if etype in {"customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"}:
        business_id = (obj.get("metadata") or {}).get("business_id")
        if not business_id:
            customer_id = obj.get("customer")
            if customer_id:
                biz = await db.businesses.find_one({"stripe_customer_id": customer_id})
                business_id = (biz or {}).get("id")
        if business_id:
            await _activate_business_from_subscription(business_id, obj)
    return {"received": True}


# ---------- Demo data seeder ----------
DEMO_PETS = [
    {"name": "Fozzie", "breed": "Golden Retriever", "species": "Dog", "weight": "28kg", "behaviour_notes": "Friendly, loves treats", "allergies": "None known", "vaccinations": "Up to date (2026)"},
    {"name": "Luna", "breed": "French Bulldog", "species": "Dog", "weight": "11kg", "behaviour_notes": "Shy at first, warms up quickly", "allergies": "Chicken", "vaccinations": "Due April 2026"},
    {"name": "Milo", "breed": "Cockapoo", "species": "Dog", "weight": "9kg", "behaviour_notes": "Energetic puppy", "allergies": "None", "vaccinations": "Up to date"},
    {"name": "Bella", "breed": "Shih Tzu", "species": "Dog", "weight": "6kg", "behaviour_notes": "Gentle, nervous of clippers", "allergies": "None", "vaccinations": "Up to date"},
    {"name": "Rocky", "breed": "Border Collie", "species": "Dog", "weight": "22kg", "behaviour_notes": "Working dog, well-trained", "allergies": "None", "vaccinations": "Up to date"},
]


async def _seed_demo_data(business_id: str) -> None:
    existing = await db.customers.count_documents({"business_id": business_id})
    if existing > 0:
        return
    svc_count = await db.services.count_documents({"business_id": business_id})
    if svc_count == 0:
        base_services = [
            {"name": "Full Groom", "price": 55.0, "duration_minutes": 120},
            {"name": "Nail Trim", "price": 10.0, "duration_minutes": 15},
            {"name": "Bath & Brush", "price": 30.0, "duration_minutes": 60},
            {"name": "Dog Walk", "price": 15.0, "duration_minutes": 60},
        ]
        for s in base_services:
            await db.services.insert_one({"id": new_id(), "business_id": business_id, **s, "created_at": now_utc()})
    services = await db.services.find({"business_id": business_id}).to_list(100)

    demo_customers = [
        {"name": "Sarah Thompson", "phone": "07700 900101", "email": "sarah.t@example.com", "address": "12 Oak Lane, Bristol", "notes": "Prefers Tuesdays"},
        {"name": "James Walker", "phone": "07700 900102", "email": "james.w@example.com", "address": "4 Elm Court, Bristol", "notes": ""},
        {"name": "Priya Patel", "phone": "07700 900103", "email": "priya.p@example.com", "address": "88 Hill Road, Bath", "notes": "Dog is nervous around other dogs"},
        {"name": "Michael Chen", "phone": "07700 900104", "email": "m.chen@example.com", "address": "6 Riverside, Bristol", "notes": ""},
        {"name": "Emily Davies", "phone": "07700 900105", "email": "emily.d@example.com", "address": "27 Beech Close, Bristol", "notes": "Pays by card only"},
    ]
    today = datetime.now()
    for i, c in enumerate(demo_customers):
        cid = new_id()
        await db.customers.insert_one({"id": cid, "business_id": business_id, **c, "created_at": now_utc()})
        pet = DEMO_PETS[i]
        pid = new_id()
        next_rec = (today + timedelta(days=(i - 2) * 4)).date().isoformat()
        await db.pets.insert_one({
            "id": pid, "business_id": business_id, "customer_id": cid,
            **pet, "date_of_birth": "", "medical_notes": "", "special_requirements": "",
            "photo_path": "", "next_recommended_at": next_rec, "created_at": now_utc(),
        })
        svc = services[i % len(services)]
        today_time = today.replace(hour=9 + i * 2, minute=0, second=0, microsecond=0)
        await db.bookings.insert_one({
            "id": new_id(), "business_id": business_id,
            "customer_id": cid, "pet_id": pid, "service_id": svc["id"],
            "start_at": today_time.isoformat(),
            "duration_minutes": svc["duration_minutes"],
            "price": svc["price"],
            "notes": "", "status": "confirmed",
            "created_at": now_utc(),
        })
        upcoming_time = today + timedelta(days=i + 2, hours=10 - today.hour)
        await db.bookings.insert_one({
            "id": new_id(), "business_id": business_id,
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
            "id": past_booking_id, "business_id": business_id,
            "customer_id": cid, "pet_id": pid, "service_id": svc["id"],
            "start_at": past_time.replace(hour=11, minute=0, second=0, microsecond=0).isoformat(),
            "duration_minutes": svc["duration_minutes"],
            "price": svc["price"],
            "notes": "", "status": "completed",
            "created_at": now_utc(),
        })
        if i % 2 == 0:
            await db.payments.insert_one({
                "id": new_id(), "business_id": business_id,
                "booking_id": past_booking_id, "customer_id": cid,
                "amount": svc["price"], "method": "card",
                "paid_at": past_time.isoformat(), "created_at": now_utc(),
            })


@api.post("/seed-demo")
async def seed_demo(member: Member = Depends(current_member)):
    await _seed_demo_data(member.business_id)
    return {"ok": True}


# ---------- CSV export ----------
def _csv_escape(v: Any) -> str:
    s = "" if v is None else str(v)
    if any(c in s for c in [",", "\"", "\n", "\r"]):
        s = "\"" + s.replace("\"", "\"\"") + "\""
    return s


async def _resolve_business_from_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        user_id = payload.get("sub")
    except Exception:
        return None
    user = await db.users.find_one({"id": user_id})
    if not user:
        return None
    m = await _resolve_active_membership(clean(user))
    if not m:
        return None
    return {"user_id": user_id, "business_id": m["business_id"], "role": m.get("role", "staff")}


@app.get("/api/export/weekly.csv")
async def export_weekly_csv(request: Request, token: Optional[str] = Query(None)):
    """Export this week's bookings + payments as CSV. Accepts auth via header or ?token=."""
    jwt_token: Optional[str] = None
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        jwt_token = auth_header.split(" ", 1)[1]
    elif token:
        jwt_token = token
    if not jwt_token:
        raise HTTPException(401, "Not authenticated")
    ctx = await _resolve_business_from_token(jwt_token)
    if not ctx:
        raise HTTPException(403, "Not a member of any business")
    business_id = ctx["business_id"]

    today = datetime.now().date()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    start_iso = datetime.combine(week_start, datetime.min.time()).isoformat()
    end_iso = datetime.combine(week_end, datetime.max.time()).isoformat()

    bookings = await db.bookings.find({
        "business_id": business_id,
        "start_at": {"$gte": start_iso, "$lte": end_iso},
        "deleted_at": {"$exists": False},
    }).sort("start_at", 1).to_list(5000)

    pay_lookup: Dict[str, float] = {}
    agg = db.payments.aggregate([
        {"$match": {"business_id": business_id, "paid_at": {"$gte": start_iso, "$lte": end_iso}}},
        {"$group": {"_id": "$booking_id", "total": {"$sum": "$amount"}}},
    ])
    async for row in agg:
        pay_lookup[row["_id"]] = row["total"]

    payments = await db.payments.find({
        "business_id": business_id,
        "paid_at": {"$gte": start_iso, "$lte": end_iso},
    }).sort("paid_at", 1).to_list(5000)

    biz = await _get_business(business_id)
    biz_name = (biz or {}).get("name", "PetAdmin")

    lines: List[str] = []
    lines.append(f"PetAdmin weekly export — {biz_name}")
    lines.append(f"Week: {week_start.isoformat()} to {week_end.isoformat()}")
    lines.append("")
    lines.append("Bookings")
    lines.append(",".join(["Date", "Time", "Customer", "Pet", "Service", "Duration (min)", "Status", "Price (GBP)", "Paid (GBP)", "Outstanding (GBP)", "Notes"]))
    total_booked = 0.0
    total_paid = 0.0
    for b in bookings:
        cust = await db.customers.find_one({"id": b["customer_id"], "business_id": business_id})
        pet = await db.pets.find_one({"id": b["pet_id"], "business_id": business_id})
        svc = await db.services.find_one({"id": b["service_id"], "business_id": business_id})
        start_at = b.get("start_at", "")
        date_part, _, time_part = start_at.partition("T")
        time_hhmm = time_part[:5] if time_part else ""
        price = float(b.get("price", 0))
        paid = float(pay_lookup.get(b["id"], 0.0))
        outstanding = max(0.0, price - paid) if b.get("status") != "cancelled" else 0.0
        if b.get("status") != "cancelled":
            total_booked += price
            total_paid += paid
        lines.append(",".join([
            _csv_escape(date_part),
            _csv_escape(time_hhmm),
            _csv_escape(cust["name"] if cust else ""),
            _csv_escape(pet["name"] if pet else ""),
            _csv_escape(svc["name"] if svc else ""),
            _csv_escape(b.get("duration_minutes", "")),
            _csv_escape(b.get("status", "")),
            _csv_escape(f"{price:.2f}"),
            _csv_escape(f"{paid:.2f}"),
            _csv_escape(f"{outstanding:.2f}"),
            _csv_escape(b.get("notes", "") or ""),
        ]))
    lines.append("")
    lines.append(f"Totals (excl. cancelled),,,,,,,{total_booked:.2f},{total_paid:.2f},{max(0.0, total_booked - total_paid):.2f}")

    lines.append("")
    lines.append("Payments")
    lines.append(",".join(["Paid at", "Customer", "Pet", "Amount (GBP)", "Method"]))
    for p in payments:
        booking = await db.bookings.find_one({"id": p.get("booking_id"), "business_id": business_id})
        cust = await db.customers.find_one({"id": p.get("customer_id"), "business_id": business_id})
        pet = None
        if booking:
            pet = await db.pets.find_one({"id": booking["pet_id"], "business_id": business_id})
        paid_at = p.get("paid_at", "")
        lines.append(",".join([
            _csv_escape(paid_at),
            _csv_escape(cust["name"] if cust else ""),
            _csv_escape(pet["name"] if pet else ""),
            _csv_escape(f"{float(p.get('amount', 0)):.2f}"),
            _csv_escape(p.get("method", "")),
        ]))

    body = "\r\n".join(lines) + "\r\n"
    filename = f"petadmin-{week_start.isoformat()}.csv"
    return Response(
        content=body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=\"{filename}\""},
    )


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


async def _migrate_v2_single_tenant_to_business() -> None:
    """Idempotent: migrate pre-business-multi-tenant data to the new business model.

    Each pre-existing user with onboarding data (business_profiles row OR owned data)
    gets a dedicated business whose id = user_id (so existing data documents whose
    `user_id` field is the owning scope continue to resolve by renaming to `business_id`).
    """
    marker = await db.migrations.find_one({"id": "v2_businesses_memberships"})
    if marker:
        return
    log.info("Running v2 migration — introducing businesses + memberships")

    # Business profiles → businesses + memberships
    profiles = await db.business_profiles.find({}).to_list(10000)
    for p in profiles:
        user_id = p.get("user_id")
        if not user_id:
            continue
        existing_biz = await db.businesses.find_one({"id": user_id})
        if existing_biz:
            continue
        user = await db.users.find_one({"id": user_id})
        if not user:
            continue
        trial_ends = user.get("trial_ends_at")
        biz_doc = {
            "id": user_id,  # keep as user_id for data compatibility
            "name": p.get("business_name", ""),
            "type": p.get("business_type", ""),
            "owner_name": p.get("owner_name", ""),
            "phone": p.get("phone", ""),
            "opening_hours": p.get("opening_hours", {}),
            "owner_user_id": user_id,
            "legacy_owner_user_id": user_id,
            "subscription_status": user.get("subscription_status", "trial"),
            "trial_ends_at": trial_ends,
            "stripe_customer_id": user.get("stripe_customer_id"),
            "stripe_subscription_id": user.get("stripe_subscription_id"),
            "cancel_at_period_end": user.get("cancel_at_period_end", False),
            "current_period_end": user.get("current_period_end"),
            "created_at": user.get("created_at", now_utc()),
        }
        await db.businesses.insert_one(biz_doc)
        await db.memberships.insert_one({
            "id": new_id(),
            "user_id": user_id,
            "business_id": user_id,
            "role": "owner",
            "status": "active",
            "invited_at": user.get("created_at", now_utc()),
            "joined_at": user.get("created_at", now_utc()),
        })
        await db.users.update_one({"id": user_id}, {"$set": {"active_business_id": user_id}})

    # Rename user_id → business_id on all data collections (where business_id missing).
    for col in ["customers", "pets", "services", "bookings", "payments"]:
        docs = db[col].find({"business_id": {"$exists": False}, "user_id": {"$exists": True}})
        async for d in docs:
            await db[col].update_one(
                {"_id": d["_id"]},
                {"$set": {"business_id": d["user_id"]}, "$unset": {"user_id": ""}},
            )

    await db.migrations.insert_one({"id": "v2_businesses_memberships", "applied_at": now_utc()})
    log.info("v2 migration complete")


@app.on_event("startup")
async def _startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("id", unique=True)
        await db.businesses.create_index("id", unique=True)
        await db.memberships.create_index([("user_id", 1), ("business_id", 1)], unique=True)
        await db.memberships.create_index("business_id")
        await db.invites.create_index("token", unique=True)
        await db.invites.create_index("business_id")
        for col in ["customers", "pets", "services", "bookings", "payments"]:
            await db[col].create_index("id", unique=True)
            await db[col].create_index("business_id")
    except Exception as e:
        log.warning("Index creation issue: %s", e)
    try:
        await _migrate_v2_single_tenant_to_business()
    except Exception as e:
        log.exception("Migration v2 failed: %s", e)
    try:
        if EMERGENT_LLM_KEY:
            await run_in_threadpool(_init_storage_sync)
    except Exception as e:
        log.warning("Storage init failed (will retry on demand): %s", e)


@app.on_event("shutdown")
async def _shutdown():
    client.close()
